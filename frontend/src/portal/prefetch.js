/**
 * Route → (page chunk, first-render API calls) for the three portals.
 *
 * Used by the shells to
 *   • start the current page's data requests in parallel with its JS chunk
 *     (instead of chunk → render → fetch),
 *   • warm a page on nav hover / focus / touch (chunk + data),
 *   • preload the remaining page chunks when the browser is idle.
 *
 * URLs must match exactly what the page requests on first render (same query
 * string) so the page's useQuery joins the cached / in-flight request.
 */
import { useEffect, useMemo } from 'react'
import { useLocation } from 'react-router-dom'

const RP = '/api/recruiter/portal'
const RH = '/api/recruiter/hiring'

export const STUDENT_ROUTES = {
  '/candidate/feed': { chunk: () => import('./student/Dashboard.jsx'), data: ['/api/student/dashboard', '/api/student/resume/insights'] },
  '/candidate/profile': { chunk: () => import('./student/Profile.jsx'), data: ['/api/student/projects'] },
  '/candidate/resume-skills': { chunk: () => import('./student/ResumeSkills.jsx'), data: ['/api/student/resume/insights'] },
  '/candidate/projects': { chunk: () => import('./student/Projects.jsx'), data: ['/api/student/projects'] },
  '/candidate/opportunities': { chunk: () => import('./student/Opportunities.jsx'), data: ['/api/student/opportunities?sort=relevance&page=1&page_size=10'] },
  '/candidate/companies': { chunk: () => import('./student/Companies.jsx'), data: ['/api/student/company-directory?page=1&page_size=24'] },
  '/candidate/applications': { chunk: () => import('./student/Applications.jsx'), data: ['/api/student/applications/overview'] },
  '/candidate/ai-interview': { chunk: () => import('./student/AIInterviewPrep.jsx'), data: ['/api/interview/practice/history?limit=200', '/api/student/companies'] },
  '/candidate/resources': { chunk: () => import('./student/Resources.jsx'), data: [] },
  '/candidate/settings': { chunk: () => import('./student/Settings.jsx'), data: [] },
}

export const RECRUITER_ROUTES = {
  '/recruiter/dashboard': { chunk: () => import('./recruiter/Dashboard.jsx'), data: [`${RP}/overview?days=30`] },
  '/recruiter/jobs': { chunk: () => import('./recruiter/Jobs.jsx'), data: [`${RP}/jobs`, '/api/candidate/roles', `${RP}/jobs/colleges`] },
  '/recruiter/jobs/new': { chunk: () => import('./recruiter/Jobs.jsx'), data: [`${RP}/jobs`, '/api/candidate/roles', `${RP}/jobs/colleges`] },
  '/recruiter/candidates': { chunk: () => import('./recruiter/Candidates.jsx'), data: [`${RP}/candidates?view=mine&sort=match&page=1&page_size=10`] },
  '/recruiter/candidates?view=search': { chunk: () => import('./recruiter/Candidates.jsx'), data: [`${RP}/candidates?view=search&sort=match&page=1&page_size=10`] },
  '/recruiter/applications': { chunk: () => import('./recruiter/Applications.jsx'), data: [`${RP}/applications?sort=newest&page=1&page_size=10`, `${RP}/jobs`] },
  '/recruiter/shortlisted': { chunk: () => import('./recruiter/Shortlisted.jsx'), data: [`${RP}/shortlisted?sort=match&page=1&page_size=10`] },
  '/recruiter/interviews': { chunk: () => import('./recruiter/Interviews.jsx'), data: [`${RH}/interviews?limit=500`, `${RH}/interviews/stats`] },
  '/recruiter/offers': { chunk: () => import('./recruiter/Offers.jsx'), data: [`${RH}/offers?limit=1000`, `${RH}/offers/stats`] },
  '/recruiter/company-profile': { chunk: () => import('./recruiter/CompanyProfile.jsx'), data: [`${RH}/company`, `${RH}/team`, `${RH}/account`] },
  '/recruiter/analytics': { chunk: () => import('./recruiter/Analytics.jsx'), data: [] },
  '/recruiter/settings': { chunk: () => import('./recruiter/Settings.jsx'), data: [`${RH}/account`, `${RH}/team`] },
}

export const ADMIN_ROUTES = {
  '/admin/dashboard': { chunk: () => import('./admin/Dashboard.jsx') },
  '/admin/users': { chunk: () => import('./admin/Users.jsx') },
  '/admin/companies': { chunk: () => import('./admin/Companies.jsx') },
  '/admin/jobs': { chunk: () => import('./admin/JobPostings.jsx') },
  '/admin/applications': { chunk: () => import('./admin/Applications.jsx') },
  '/admin/interviews': { chunk: () => import('./admin/Interviews.jsx') },
  '/admin/offers': { chunk: () => import('./admin/Offers.jsx') },
  '/admin/moderation': { chunk: () => import('./admin/Moderation.jsx') },
  '/admin/reports': { chunk: () => import('./admin/Reports.jsx') },
  '/admin/live-data': { chunk: () => import('./admin/LiveData.jsx') },
  '/admin/settings': { chunk: () => import('./admin/SystemSettings.jsx'), data: ['/api/admin/portal/settings'] },
  '/admin/audit-logs': { chunk: () => import('./admin/AuditLogs.jsx') },
}

function routeFor(routes, to) {
  if (!to) return null
  if (routes[to]) return routes[to]
  const path = String(to).split('?')[0].replace(/\/+$/, '')
  return routes[path] || null
}

const onIdle = (fn) => (typeof window !== 'undefined' && window.requestIdleCallback
  ? window.requestIdleCallback(fn, { timeout: 4000 })
  : setTimeout(fn, 1500))

/**
 * usePortalPrefetch(api, routes, { idleData }) → prefetch(to)
 *  – fetches the current route's data right away (parallel with its chunk),
 *  – after the first load, on idle: preloads all page chunks and the data of
 *    `idleData` routes (the most likely next pages).
 */
export function usePortalPrefetch(api, routes, { idleData = [] } = {}) {
  const location = useLocation()
  const prefetch = useMemo(() => {
    const warmed = new Set()
    return (to, { data = true } = {}) => {
      const r = routeFor(routes, to)
      if (!r) return
      if (!warmed.has(to)) { warmed.add(to); r.chunk && r.chunk().catch(() => {}) }
      if (data && api?.token) (r.data || []).forEach((u) => api.prefetch(u))
    }
  }, [api, routes])

  // current page: start its requests now, in parallel with the page chunk
  useEffect(() => {
    // only when the URL has no filters of its own (the page then builds a different query)
    const full = `${location.pathname}${location.search}`
    if (routes[full]) prefetch(full)
    else if (!location.search) prefetch(location.pathname)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname])

  // idle: the other pages' code + the most likely next pages' data
  useEffect(() => {
    if (!api?.token) return undefined
    let cancelled = false
    const t = setTimeout(() => onIdle(() => {
      if (cancelled) return
      Object.keys(routes).forEach((to) => prefetch(to, { data: false }))
      idleData.forEach((to) => prefetch(to))
    }), 2500)
    return () => { cancelled = true; clearTimeout(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api?.token])

  return prefetch
}
