import React, { useEffect, useState, useCallback } from 'react'
import { Outlet, Navigate, useNavigate } from 'react-router-dom'
import { Home, Briefcase, ClipboardList, User, LifeBuoy, LogOut } from 'lucide-react'
import { useAuth, createAuthedFetch } from '../../auth.jsx'
import AppShell from '../../components/AppShell.jsx'
import Onboarding from '../../components/Onboarding.jsx'
import { mediaUrl } from '../../lib/api.js'

const TABS = [
  { to: '/candidate/feed', label: 'Home', icon: Home },
  { to: '/candidate/jobs', label: 'Jobs', icon: Briefcase },
  { to: '/candidate/repo', label: 'Applications', icon: ClipboardList },
  { to: '/candidate/profile', label: 'Profile', icon: User },
  { to: '/candidate/contact', label: 'Help', icon: LifeBuoy },
]

const QUICK_LINKS = [
  { to: '/candidate/jobs?remote=remote', label: 'Remote jobs' },
  { to: '/candidate/jobs?near=1', label: 'Jobs near me' },
  { to: '/candidate/repo', label: 'AI interview' },
  { to: '/candidate/profile', label: 'Resume & projects' },
  { to: '/ats-check', label: 'Free ATS check' },
]

export default function CandidateLayout() {
  const { candidateToken, candidateUsername, logoutCandidate } = useAuth()
  const navigate = useNavigate()
  const [profile, setProfile] = useState(null)

  const loadProfile = useCallback(() => {
    if (!candidateToken) return
    const api = createAuthedFetch(candidateToken, logoutCandidate)
    api('/api/candidate/profile')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (data) setProfile(data) })
      .catch(() => {})
  }, [candidateToken, logoutCandidate])

  useEffect(() => { loadProfile() }, [loadProfile])

  if (!candidateToken) {
    return <Navigate to="/candidate/login" replace />
  }

  const display = (candidateUsername || '').split('@')[0]
  const initials = display ? display.substring(0, 2).toUpperCase() : 'ME'
  const headline = profile?.headline

  return (
    <AppShell
      tabs={TABS}
      quickLinks={QUICK_LINKS}
      searchPlaceholder="Search jobs, skills, companies"
      onSearch={(q) => navigate(`/candidate/jobs${q ? `?q=${encodeURIComponent(q)}` : ''}`)}
      context={headline ? `Matching for: ${headline}` : 'Complete your profile for better matches'}
      onBrandDoubleClick={() => navigate('/admin')}
      account={{
        initials,
        label: display || 'Candidate',
        sublabel: 'Hello,',
        to: '/candidate/profile',
        avatarUrl: profile?.avatar_url ? mediaUrl(profile.avatar_url) : null,
      }}
      actions={
        <button type="button" className="as-icon-btn" onClick={logoutCandidate} aria-label="Log out" title="Log out">
          <LogOut size={18} />
        </button>
      }
    >
      <Onboarding type="candidate" />
      <Outlet context={{ loadParentProfile: loadProfile }} />
    </AppShell>
  )
}
