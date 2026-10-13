/**
 * Small data layer for v2 pages.
 *
 *   const api = useApi('candidate')            // or 'recruiter' | 'admin'
 *   const { data, loading, error, reload, setData } = useQuery(() => api.get('/api/candidate/profile'), [])
 *   await api.post('/api/x', { a: 1 })          // JSON body
 *   await api.post('/api/x', formData)          // multipart (FormData passes through)
 *
 * Errors throw ApiError with the backend's `detail` message. A 401 logs the
 * user out of that role (same behaviour as the old createAuthedFetch).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../auth.jsx'

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
    async function request(method, url, body, opts = {}) {
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
        logout && logout()
        throw new ApiError('Your session expired — please sign in again.', 401, data)
      }
      if (!res.ok) throw new ApiError(detailOf(data, res.status), res.status, data)
      return data
    }
    return {
      token,
      get: (u, o) => request('GET', u, undefined, o),
      post: (u, b, o) => request('POST', u, b, o),
      put: (u, b, o) => request('PUT', u, b, o),
      patch: (u, b, o) => request('PATCH', u, b, o),
      del: (u, o) => request('DELETE', u, undefined, o),
      request,
    }
  }, [token, logout])
}

/** Fetch-on-mount helper with loading / error / reload. */
export function useQuery(fn, deps = []) {
  const [state, setState] = useState({ data: undefined, loading: true, error: null })
  const alive = useRef(true)
  const run = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }))
    try {
      const data = await fn()
      if (alive.current) setState({ data, loading: false, error: null })
      return data
    } catch (error) {
      if (alive.current) setState((s) => ({ ...s, loading: false, error }))
      return undefined
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  useEffect(() => {
    alive.current = true
    run()
    return () => { alive.current = false }
  }, [run])
  const setData = useCallback((updater) => setState((s) => ({ ...s, data: typeof updater === 'function' ? updater(s.data) : updater })), [])
  return { ...state, reload: run, setData }
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
