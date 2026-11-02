/**
 * "Always show something" data hook for slow analyses.
 *
 *   const r = usePersistedResult('best-jobs:all', () => api.get(url, { cache: false }))
 *
 * 1. Paints instantly from the last result saved in this browser (per user).
 * 2. Fetches from the server (which itself answers from its saved result).
 * 3. While the server says `refreshing` / `pending`, polls every few seconds
 *    and swaps in the fresh result when it lands.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../auth.jsx'

const PREFIX = 'cl_result:'
const POLL_MS = 4000
const MAX_POLLS = 30

export function readSaved(key) {
  try { return JSON.parse(localStorage.getItem(PREFIX + key) || 'null') } catch { return null }
}
export function writeSaved(key, data) {
  try { localStorage.setItem(PREFIX + key, JSON.stringify(data)) } catch { /* storage full / private mode */ }
}

export function usePersistedResult(key, fetcher, { enabled = true } = {}) {
  const { candidateUsername } = useAuth()
  const fullKey = `${candidateUsername || 'anon'}:${key}`
  const [data, setData] = useState(() => (enabled ? readSaved(fullKey) : null))
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const polls = useRef(0)
  const timer = useRef(null)
  const fetchRef = useRef(fetcher)
  fetchRef.current = fetcher

  const run = useCallback(async (opts = {}) => {
    clearTimeout(timer.current)
    setLoading(true)
    try {
      const d = await fetchRef.current(opts)
      setData(d)
      setError(null)
      if (d && !d.pending) writeSaved(fullKey, d)
      if (d && (d.refreshing || d.pending) && polls.current < MAX_POLLS) {
        polls.current += 1
        timer.current = setTimeout(() => run(), POLL_MS)
      }
    } catch (e) {
      setError(e)
    } finally { setLoading(false) }
  }, [fullKey])

  useEffect(() => {
    if (!enabled) return undefined
    polls.current = 0
    setData(readSaved(fullKey))
    run()
    return () => clearTimeout(timer.current)
  }, [enabled, fullKey, run])

  const reload = useCallback((opts) => { polls.current = 0; return run(opts) }, [run])
  const busy = loading || !!data?.refreshing || !!data?.pending
  return { data, setData, error, loading, busy, reload }
}
