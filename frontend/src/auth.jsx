/**
 * Simple auth context for managing candidate/recruiter tokens and role.
 */
import React, { createContext, useContext, useState, useCallback } from 'react'

const AuthContext = createContext(null)

const STORAGE_KEYS = {
  candidate: { token: 'ats_candidate_token', username: 'ats_candidate_username' },
  recruiter: { token: 'ats_recruiter_token', username: 'ats_recruiter_username' },
}

export function AuthProvider({ children }) {
  const [candidateToken, setCandidateToken] = useState(() => {
    try {
      const params = new URLSearchParams(window.location.search)
      const token = params.get('token')
      if (token && token.split('.').length === 3) {
        localStorage.setItem(STORAGE_KEYS.candidate.token, token)
        // Clean URL
        const search = window.location.search.replace(/[?&]token=[^&]+/, '').replace(/^&/, '?')
        const cleanUrl = window.location.pathname + (search === '?' ? '' : search)
        window.history.replaceState({}, document.title, cleanUrl)
        return token
      }
    } catch (e) {}
    return localStorage.getItem(STORAGE_KEYS.candidate.token)
  })
  const [candidateUsername, setCandidateUsername] = useState(() => localStorage.getItem(STORAGE_KEYS.candidate.username))
  const [recruiterToken, setRecruiterToken] = useState(() => localStorage.getItem(STORAGE_KEYS.recruiter.token))
  const [recruiterUsername, setRecruiterUsername] = useState(() => localStorage.getItem(STORAGE_KEYS.recruiter.username))

  const loginCandidate = useCallback((token, username) => {
    localStorage.setItem(STORAGE_KEYS.candidate.token, token)
    localStorage.setItem(STORAGE_KEYS.candidate.username, username)
    setCandidateToken(token)
    setCandidateUsername(username)
  }, [])

  const logoutCandidate = useCallback(() => {
    localStorage.removeItem(STORAGE_KEYS.candidate.token)
    localStorage.removeItem(STORAGE_KEYS.candidate.username)
    setCandidateToken(null)
    setCandidateUsername(null)
  }, [])

  const loginRecruiter = useCallback((token, username) => {
    localStorage.setItem(STORAGE_KEYS.recruiter.token, token)
    localStorage.setItem(STORAGE_KEYS.recruiter.username, username)
    setRecruiterToken(token)
    setRecruiterUsername(username)
  }, [])

  const logoutRecruiter = useCallback(() => {
    localStorage.removeItem(STORAGE_KEYS.recruiter.token)
    localStorage.removeItem(STORAGE_KEYS.recruiter.username)
    setRecruiterToken(null)
    setRecruiterUsername(null)
  }, [])

  const value = {
    candidateToken, candidateUsername, loginCandidate, logoutCandidate,
    recruiterToken, recruiterUsername, loginRecruiter, logoutRecruiter,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

/**
 * Wrapper around fetch that adds the Authorization header and handles 401s.
 *
 * Memoised per (token, onAuthExpired): pages call this on every render and
 * then list the result in useEffect/useCallback dependencies. Returning a new
 * function each time caused effects to re-run on every render (an endless
 * request loop on the Applications page). Same inputs → same function now.
 */
const _authedFetchCache = new WeakMap()

export function createAuthedFetch(token, onAuthExpired) {
  const key = onAuthExpired || createAuthedFetch
  let byToken = _authedFetchCache.get(key)
  if (!byToken) {
    byToken = new Map()
    _authedFetchCache.set(key, byToken)
  }
  const cached = byToken.get(token)
  if (cached) return cached

  async function authedFetch(url, options = {}) {
    const res = await fetch(url, {
      ...options,
      headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` },
    })
    if (res.status === 401) {
      if (onAuthExpired) onAuthExpired()
      throw new Error('Session expired — please log in again.')
    }
    return res
  }
  byToken.set(token, authedFetch)
  return authedFetch
}
