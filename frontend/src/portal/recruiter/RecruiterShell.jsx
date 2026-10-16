import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { Home, Users, PlusSquare, Briefcase, UserCheck, FileCheck2, Bookmark, CalendarDays, Handshake, Building2, BarChart3, Settings } from 'lucide-react'
import PortalLayout from '../../ui/PortalLayout.jsx'
import { useAuth } from '../../auth.jsx'
import { useApi } from '../../ui/useApi.js'
import { RECRUITER_ROUTES, usePortalPrefetch } from '../prefetch.js'

export const RECRUITER_NAV = [
  { to: '/recruiter/dashboard', label: 'Dashboard', icon: Home },
  { to: '/recruiter/candidates?view=search', label: 'Find Candidates', icon: Users, match: (l) => l.pathname === '/recruiter/candidates' && l.search.includes('view=search') },
  { to: '/recruiter/jobs/new', label: 'Post a Job', icon: PlusSquare },
  { to: '/recruiter/jobs', label: 'Manage Jobs', icon: Briefcase, end: true },
  { to: '/recruiter/candidates', label: 'Candidate Management', icon: UserCheck, end: true, match: (l) => l.pathname === '/recruiter/candidates' && !l.search.includes('view=search') },
  { to: '/recruiter/applications', label: 'Applications', icon: FileCheck2 },
  { to: '/recruiter/shortlisted', label: 'Shortlisted', icon: Bookmark },
  { to: '/recruiter/interviews', label: 'Interviews', icon: CalendarDays },
  { to: '/recruiter/offers', label: 'Offers & Hiring', icon: Handshake },
  { to: '/recruiter/company-profile', label: 'Company Profile', icon: Building2 },
  { to: '/recruiter/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/recruiter/settings', label: 'Settings', icon: Settings },
]
const TABS = [
  { to: '/recruiter/dashboard', label: 'Dashboard', short: 'Home', icon: Home },
  { to: '/recruiter/jobs', label: 'Jobs', icon: Briefcase },
  { to: '/recruiter/candidates', label: 'Candidates', icon: UserCheck },
  { to: '/recruiter/applications', label: 'Applications', short: 'Applied', icon: FileCheck2 },
  { to: '/recruiter/interviews', label: 'Interviews', icon: CalendarDays },
]

const RecruiterCtx = createContext(null)
/** useRecruiter() → { me, company, reload } — company = CompanyProfile (name, logo_url …) */
export const useRecruiter = () => useContext(RecruiterCtx)

export default function RecruiterShell() {
  const { recruiterToken, recruiterUsername, logoutRecruiter } = useAuth()
  const api = useApi('recruiter')
  const navigate = useNavigate()
  const prefetch = usePortalPrefetch(api, RECRUITER_ROUTES, { idleData: ['/recruiter/applications'] })
  const [company, setCompany] = useState(null)
  const [me, setMe] = useState(null)
  const mustChange = (() => { try { return localStorage.getItem('ats_recruiter_must_change') === '1' } catch { return false } })()

  const reload = useCallback(async () => {
    const [p, c] = await Promise.all([
      api.get('/api/recruiter/profile').catch(() => null),
      api.get('/api/recruiter/hiring/company').catch(() => null),
    ])
    setMe(p); setCompany(c)
  }, [api])
  useEffect(() => { if (recruiterToken) reload() }, [recruiterToken, reload])

  if (!recruiterToken) return <Navigate to="/recruiter/login" replace />
  if (localStorage.getItem('ats_recruiter_role') === 'admin') return <Navigate to="/admin/dashboard" replace />

  const companyName = company?.name || me?.company_name || (recruiterUsername || '').split('@')[1]?.split('.')[0]?.replace(/^\w/, (c) => c.toUpperCase()) || 'Recruiter'
  return (
    <RecruiterCtx.Provider value={{ me, company, setCompany, reload, companyName }}>
      <PortalLayout
        prefetch={prefetch}
        notice={mustChange ? (
          <div className="cl-alert warn" role="status" style={{ marginBottom: 16 }}>
            You signed in with a temporary password. <Link to="/recruiter/settings?tab=security" style={{ fontWeight: 600 }}>Set your own password</Link> in Settings → Security.
          </div>
        ) : null}
        role="recruiter"
        brandSub="for Recruiters"
        nav={RECRUITER_NAV}
        tabs={TABS}
        user={{ name: companyName, sub: 'Recruiter Dashboard', src: company?.logo_url, logo: true }}
        userMenu={[
          { label: 'Company Profile', icon: Building2, to: '/recruiter/company-profile' },
          { label: 'Settings', icon: Settings, to: '/recruiter/settings' },
        ]}
        onLogout={() => { localStorage.removeItem('ats_recruiter_role'); logoutRecruiter(); navigate('/recruiter/login') }}
        searchPlaceholder="Search candidates by name, skills, branch, college…"
        onSearch={(q) => navigate(`/recruiter/candidates?view=search${q ? `&q=${encodeURIComponent(q)}` : ''}`)}
      />
    </RecruiterCtx.Provider>
  )
}
