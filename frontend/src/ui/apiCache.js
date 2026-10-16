/**
 * Tiny in-memory GET cache used by useApi (stale-while-revalidate).
 *
 *   cachedGet(key, fetcher)   → Promise<data>
 *     • fresh  (< FRESH_MS)       → cached copy, no request
 *     • stale  (< MAX_STALE_MS)   → cached copy now + background revalidation
 *     • older / missing           → request (concurrent callers share it)
 *   invalidateAll()              → after any write (POST/PUT/PATCH/DELETE)
 *   subscribe(key, fn)           → called when a revalidation brought new data
 *   collectKeys(fn, {force})     → run fn, return the cache keys it read
 *
 * Every read returns a deep copy so a page mutating its data can never
 * corrupt what another page sees. Pure module (no React) so it is unit-tested.
 */
export const FRESH_MS = 10_000
export const MAX_STALE_MS = 10 * 60_000
const MAX_ENTRIES = 150

const entries = new Map() // key -> { data, json, at, version, promise }
const listeners = new Map() // key -> Set<fn>
let generation = 0
let collector = null
let forcing = false

const clone = (v) => {
  if (v == null || typeof v !== 'object') return v
  try { return typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)) } catch { return JSON.parse(JSON.stringify(v)) }
}

function store(key, data) {
  const json = safeJson(data)
  const prev = entries.get(key)
  const changed = !prev || prev.json !== json
  entries.set(key, { data, json, at: Date.now(), version: changed ? (prev?.version || 0) + 1 : prev.version, promise: null })
  if (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value) // oldest first (Map keeps insertion order)
  return changed
}

function safeJson(v) {
  try { return JSON.stringify(v) } catch { return String(Math.random()) }
}

function load(key, fetcher) {
  const gen = generation
  const cur = entries.get(key)
  const p = Promise.resolve().then(fetcher).then(
    (data) => {
      if (gen === generation) {
        const changed = store(key, data)
        if (changed && cur && cur.data !== undefined) notify(key)
      } else {
        const e = entries.get(key)
        if (e && e.promise === p) e.promise = null
      }
      return clone(data)
    },
    (err) => {
      const e = entries.get(key)
      if (e && e.promise === p) {
        e.promise = null
        if (e.data === undefined) entries.delete(key)
      }
      throw err
    },
  )
  entries.set(key, { ...(cur || { data: undefined, json: undefined, at: 0, version: 0 }), promise: p })
  return p
}

export function cachedGet(key, fetcher, { force = false, fresh = FRESH_MS } = {}) {
  if (collector) collector.add(key)
  const e = entries.get(key)
  const now = Date.now()
  if (!(force || forcing) && e && e.data !== undefined) {
    const age = now - e.at
    if (age < fresh) return Promise.resolve(clone(e.data))
    if (age < MAX_STALE_MS) {
      if (!e.promise) load(key, fetcher).catch(() => {})
      return Promise.resolve(clone(e.data))
    }
  }
  if (e?.promise && !(force || forcing)) return e.promise.then(clone)
  return load(key, fetcher)
}

/** Synchronous peek used to render cached data on mount (no flash of skeleton). */
export function peek(key) {
  const e = entries.get(key)
  if (!e || e.data === undefined || Date.now() - e.at > MAX_STALE_MS) return undefined
  return { data: clone(e.data), version: e.version }
}

export function versionOf(key) {
  const e = entries.get(key)
  return e && e.data !== undefined && Date.now() - e.at <= MAX_STALE_MS ? e.version : undefined
}

export function invalidateAll() {
  generation += 1
  entries.clear()
}

export function subscribe(key, fn) {
  if (!listeners.has(key)) listeners.set(key, new Set())
  listeners.get(key).add(fn)
  return () => {
    const s = listeners.get(key)
    if (s) { s.delete(fn); if (!s.size) listeners.delete(key) }
  }
}

function notify(key) {
  const s = listeners.get(key)
  if (s) [...s].forEach((fn) => { try { fn() } catch { /* listener errors must not break others */ } })
}

/** Run `fn` and record every cache key it reads synchronously. */
export function collectKeys(fn, { force = false } = {}) {
  const prev = collector
  const prevForce = forcing
  const keys = new Set()
  collector = keys
  forcing = force
  let result
  try { result = fn() } finally { collector = prev; forcing = prevForce }
  return { result, keys: [...keys] }
}

export function _resetForTests() {
  entries.clear()
  listeners.clear()
  generation = 0
}
