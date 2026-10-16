/**
 * Small data layer for v2 pages.
 *
 *   const api = useApi('candidate')            // or 'recruiter' | 'admin'
 *   const { data, loading, error, reload, setData } = useQuery(() => api.get('/api/candidate/profile'), [])
 *   await api.post('/api/x', { a: 1 })          // JSON body
 *   await api.post('/api/x', formData)          // multipart (FormData passes through)
 *   api.prefetch('/api/student/dashboard')      // warm the cache (hover / idle)
 *
 * GETs go through an in-memory stale-while-revalidate cache (ui/apiCache.js):
 * the same URL requested twice on one page (shell + page) or again within
 * 10 s is served from memory, older data (< 10 min) is shown at once and
 * refreshed in the background, and every write (POST/PUT/PATCH/DELETE)
 * clears the cache. `reload()` always goes to the network. Pass
 * `{ cache: false }` to bypass it for one call.
 *
 * Errors throw ApiError with the backend's `detail` message. A 401 logs the
 * user out of that role (same behaviour as the old createAuthedFetch).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../auth.jsx'
import { cachedGet, collectKeys, invalidateAll, peek, subscribe, versionOf } from './apiCache.js'

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message)
    this.status = status
    this.body = body
  }
}

function detailOf(body, status) {
  if (!body) return `Request failed (${status})`
  if (typeof body.detail === 'string') return body.detail
  if (Array.isArray(body.detail)) return body.detail.map((d) => d.msg || JSON.stringify(d)).join('; ')
  return body.message || `Request failed (${status})`
}

export function useApi(role = 'candidate') {
  const auth = useAuth()
  const token = role === 'candidate' ? auth.candidateToken : role === 'recruiter' ? auth.recruiterToken : auth.adminToken
  const logout = role === 'candidate' ? auth.logoutCandidate : role === 'recruiter' ? auth.logoutRecruiter : auth.logoutAdmin

  return useMemo(() => {
    async function send(method, url, body, opts = {}) {
      const headers = { ...(opts.headers || {}) }
      if (token) headers.Authorization = `Bearer ${token}`
      let payload = body
      if (body != null && !(body instanceof FormData) && typeof body !== 'string') {
        headers['Content-Type'] = 'application/json'
        payload = JSON.stringify(body)
      }
      const res = await fetch(url, { method, headers, body: payload, signal: opts.signal })
      if (opts.raw) return res
      const text = await res.text()
      let data = null
      try { data = text ? JSON.parse(text) : null } catch { data = text }
      if (res.status === 401 && token) {
        invalidateAll()
        logout && logout()
        throw new ApiError('Your session expired — please sign in again.', 401, data)
      }
      if (!res.ok) throw new ApiError(detailOf(data, res.status), res.status, data)
      return data
    }
    async function request(method, url, body, opts = {}) {
      const m = String(method || 'GET').toUpperCase()
      if (m === 'GET' && !opts.raw && !opts.signal && opts.cache !== false) {
        return cachedGet(`${role}|${token || ''}|${url}`, () => send('GET', url, undefined, opts), { force: opts.force })
      }
      if (m === 'GET' || m === 'HEAD') return send(m, url, body, opts)
      try {
        return await send(m, url, body, opts)
      } finally {
        invalidateAll() // any write may change what other pages show
      }
    }
    return {
      token,
      get: (u, o) => request('GET', u, undefined, o),
      post: (u, b, o) => request('POST', u, b, o),
      put: (u, b, o) => request('PUT', u, b, o),
      patch: (u, b, o) => request('PATCH', u, b, o),
      del: (u, o) => request('DELETE', u, undefined, o),
      prefetch: (u) => { if (token) request('GET', u).catch(() => {}) },
      request,
    }
  }, [token, logout, role])
}

/** Remembered results per useQuery call site, so a page you return to renders
 * instantly from cache (no skeleton flash) and then revalidates. */
const lastResults = new Map()
const sigOf = (fn, deps) => {
  try { return `${fn.toString()}|${JSON.stringify(deps)}` } catch { return null }
}
function remembered(sig) {
  const r = sig && lastResults.get(sig)
  if (!r || !r.keys.length) return undefined
  for (const k of r.keys) if (versionOf(k) !== r.versions[k]) return undefined
  // single-endpoint queries: hand out a fresh copy of the cached response
  if (r.keys.length === 1 && r.raw) { const p = peek(r.keys[0]); return p ? p.data : undefined }
  return r.data
}

/** Fetch-on-mount helper with loading / error / reload (+ cache-aware). */
export function useQuery(fn, deps = []) {
  const sig = sigOf(fn, deps)
  const [state, setState] = useState(() => {
    const data = remembered(sig)
    return data !== undefined ? { data, loading: false, error: null } : { data: undefined, loading: true, error: null }
  })
  const alive = useRef(true)
  const unsub = useRef([])
  const runRef = useRef(null)
  const run = useCallback(async (opts = {}) => {
    if (!opts.silent) setState((s) => ({ ...s, loading: true, error: null }))
    let keys = []
    try {
      const collected = collectKeys(() => fn(), { force: !!opts.force })
      keys = collected.keys
      // re-subscribe to the endpoints this query reads (background revalidation pushes new data)
      unsub.current.forEach((u) => u())
      unsub.current = keys.map((k) => subscribe(k, () => runRef.current && runRef.current({ silent: true })))
      const data = await collected.result
      if (sig && keys.length) {
        const versions = {}
        keys.forEach((k) => { versions[k] = versionOf(k) })
        const raw = keys.length === 1 && JSON.stringify(data) === JSON.stringify(peek(keys[0])?.data)
        lastResults.set(sig, { data, keys, versions, raw })
        if (lastResults.size > 300) lastResults.delete(lastResults.keys().next().value)
      }
      if (alive.current) setState({ data, loading: false, error: null })
      return data
    } catch (error) {
      if (alive.current) setState((s) => ({ ...s, loading: false, error }))
      return undefined
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  runRef.current = run
  const first = useRef(true)
  useEffect(() => {
    alive.current = true
    if (first.current) {
      first.current = false
      run({ silent: state.data !== undefined }) // mounted with cached data → revalidate quietly
    } else {
      // deps changed (filters, page…): show remembered data for the new query at once if we have it
      const cached = remembered(sig)
      if (cached !== undefined) { setState({ data: cached, loading: false, error: null }); run({ silent: true }) } else run()
    }
    return () => { alive.current = false; unsub.current.forEach((u) => u()); unsub.current = [] }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run])
  const setData = useCallback((updater) => setState((s) => ({ ...s, data: typeof updater === 'function' ? updater(s.data) : updater })), [])
  // reload() = explicit refresh → always hits the network
  const reload = useCallback(() => run({ force: true }), [run])
  return { ...state, reload, setData }
}

/** Run an async action with a busy flag + toast-friendly result. */
export function useAction() {
  const [busy, setBusy] = useState(false)
  const run = useCallback(async (fn) => {
    setBusy(true)
    try { return await fn() } finally { setBusy(false) }
  }, [])
  return [busy, run]
}
