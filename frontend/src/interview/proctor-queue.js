/**
 * Durable proctoring queues (IndexedDB via idb-keyval) with recovery:
 * - corrupted records are dropped on load (and counted), never sent forever;
 * - storage failures (quota, private mode, blocked IDB) fall back to memory and
 *   are reported through queueHealth() so the summary can say evidence is at risk;
 * - "waiting for snapshot" flags are reset after a reload so events can't get stuck.
 */
import { get, set } from 'idb-keyval'

const key = (sessionId) => `proctor-queue:${sessionId}`
const snapshotKey = (sessionId) => `proctor-snapshots:${sessionId}`
const memory = new Map()
const CLIENT_ID_RE = /^[A-Za-z0-9._:-]{1,100}$/
const TYPE_RE = /^[a-z][a-z0-9_]{1,39}$/
export const MAX_QUEUED_EVENTS = 600

const health = { mode: 'indexeddb', readErrors: 0, writeErrors: 0, quotaErrors: 0, corruptDropped: 0, trimmed: 0, lastError: null }

export function queueHealth() { return { ...health } }
export function _resetQueueHealthForTests() {
  Object.assign(health, { mode: 'indexeddb', readErrors: 0, writeErrors: 0, quotaErrors: 0, corruptDropped: 0, trimmed: 0, lastError: null })
  memory.clear()
}

function noteError(kind, err) {
  health[kind] += 1
  health.mode = 'memory'
  health.lastError = String(err?.name || err?.message || err).slice(0, 80)
  if (err?.name === 'QuotaExceededError' || /quota/i.test(String(err?.message || ''))) health.quotaErrors += 1
}

async function read(k) {
  if (memory.has(k)) return memory.get(k)          // memory holds the newest copy after a write failure
  try { return await get(k) } catch (e) { noteError('readErrors', e); return undefined }
}
async function write(k, value) {
  try {
    await set(k, value)
    memory.delete(k)
  } catch (e) {
    noteError('writeErrors', e)
    memory.set(k, value)                            // keep it for this page's lifetime at least
  }
}
const id = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`

export function sanitizeEvent(x) {
  if (!x || typeof x !== 'object' || !CLIENT_ID_RE.test(String(x.client_event_id || '')) || !TYPE_RE.test(String(x.type || ''))) return null
  const status = ['PENDING', 'FAILED'].includes(x.upload_status) ? x.upload_status : 'PENDING'
  return { ...x, waiting: false, upload_status: status, attempts: Number.isFinite(x.attempts) ? x.attempts : 0, next_retry_at: 0 }
}

export function sanitizeSnapshot(x) {
  const isBlob = typeof Blob !== 'undefined' ? x?.blob instanceof Blob : !!x?.blob
  if (!x || typeof x !== 'object' || !isBlob || !CLIENT_ID_RE.test(String(x.client_event_id || '')) || !TYPE_RE.test(String(x.event_type || ''))) return null
  return { ...x, upload_status: x.upload_status === 'FAILED' ? 'FAILED' : 'PENDING', attempts: Number.isFinite(x.attempts) ? x.attempts : 0, next_retry_at: 0 }
}

function clean(value, fn) {
  if (!Array.isArray(value)) {
    if (value !== undefined && value !== null) health.corruptDropped += 1
    return []
  }
  const out = []
  for (const v of value) {
    const c = fn(v)
    if (c) out.push(c)
    else health.corruptDropped += 1
  }
  return out
}

export async function loadProctorQueue(sessionId) {
  return clean(await read(key(sessionId)), sanitizeEvent)
}

export async function saveProctorQueue(sessionId, items) {
  if (items.length > MAX_QUEUED_EVENTS) health.trimmed += items.length - MAX_QUEUED_EVENTS   // server never stores more per session
  await write(key(sessionId), items.slice(-MAX_QUEUED_EVENTS).map(({ waiting, ...rest }) => rest))
}

export async function loadSnapshotQueue(sessionId) {
  return clean(await read(snapshotKey(sessionId)), sanitizeSnapshot)
}

export async function saveSnapshotQueue(sessionId, items) {
  await write(snapshotKey(sessionId), items)
}

export function makeQueuedEvent(event) {
  return { ...event, client_event_id: event.client_event_id || id(), upload_status: 'PENDING', attempts: 0, next_retry_at: 0 }
}

/**
 * Apply a /proctor/events response to the queue. Only records the server
 * explicitly acknowledged (persisted or exact duplicate) are removed.
 * invalid → kept as FAILED (never retried); failed/missing → retried with backoff.
 */
export function applyEventResults(queue, sent, data, now, retryDelay, maxAttempts) {
  const results = Array.isArray(data?.results) ? data.results : null
  const ack = new Set(results
    ? results.filter((r) => r && (r.status === 'persisted' || r.status === 'duplicate')).map((r) => r.client_event_id)
    : (data?.acknowledged || []))
  const byId = new Map((results || []).filter((r) => r?.client_event_id).map((r) => [r.client_event_id, r]))
  for (const r of data?.rejected || []) if (r?.client_event_id && !byId.has(r.client_event_id)) byId.set(r.client_event_id, { status: 'invalid', reason: r.reason })
  const sentIds = new Set(sent.map((e) => e.client_event_id))
  const kept = []
  for (const e of queue) {
    if (!sentIds.has(e.client_event_id)) { kept.push(e); continue }
    if (ack.has(e.client_event_id)) continue
    const r = byId.get(e.client_event_id)
    if (r?.status === 'invalid') {
      kept.push({ ...e, upload_status: 'FAILED', error: r.reason || 'invalid_event' })
    } else {
      const attempts = (e.attempts || 0) + 1
      kept.push({ ...e, attempts, upload_status: attempts >= maxAttempts ? 'FAILED' : 'PENDING', next_retry_at: now + retryDelay(attempts), error: r?.reason || 'not_acknowledged' })
    }
  }
  return kept
}

export { id as makeClientEventId }
