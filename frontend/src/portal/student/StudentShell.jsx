import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Home, User, FileText, Briefcase, Compass, ClipboardCheck, Bot, BookOpen, Settings } from 'lucide-react'
import PortalLayout from '../../ui/PortalLayout.jsx'
import { useAuth } from '../../auth.jsx'
import { useApi } from '../../ui/useApi.js'
import { getBranch } from '../../branding/branches.js'

export const STUDENT_NAV = [
  { to: '/candidate/feed', label: 'Home', icon: Home },
  { to: '/candidate/profile', label: 'My Profile', icon: User },
  { to: '/candidate/resume-skills', label: 'Resume & Skills', icon: FileText },
  { to: '/candidate/projects', label: 'Projects', icon: Briefcase },
  { to: '/candidate/opportunities', label: 'Opportunities', icon: Compass },
  { to: '/candidate/applications', label: 'Applications', icon: ClipboardCheck },
  { to: '/candidate/ai-interview', label: 'AI Interview', icon: Bot },
  { to: '/candidate/resources', label: 'Resources', icon: BookOpen },
]
const STUDENT_TABS = [
  { to: '/candidate/feed', label: 'Home', icon: Home },
  { to: '/candidate/opportunities', label: 'Jobs', icon: Compass },
  { to: '/candidate/applications', label: 'Applied', icon: ClipboardCheck },
  { to: '/candidate/ai-interview', label: 'Interview', icon: Bot },
  { to: '/candidate/profile', label: 'Profile', icon: User },
]

const StudentCtx = createContext(null)
/**
 * useStudent() → { profile, branch, reload, setProfile, displayName, firstName }
 * `branch` is the catalogue entry (src/branding/branches.js) for the student's
 * branch — use it for hero images, thumbnails, suggested skills and topics.
 */
export const useStudent = () => useContext(StudentCtx)

export default function StudentShell() {
  const { candidateToken, candidateUsername, logoutCandidate } = useAuth()
  const api = useApi('candidate')
  const navigate = useNavigate()
  const [profile, setProfile] = useState(null)

  const reload = useCallback(() => api.get('/api/candidate/profile').then((p) => { setProfile(p); return p }).catch(() => null), [api])
  useEffect(() => { if (candidateToken) reload() }, [candidateToken, reload])

  if (!candidateToken) return <Navigate to="/candidate/login" replace />

  const displayName = profile?.full_name || (candidateUsername || '').split('@')[0]
  const firstName = (displayName || 'there').split(/[\s._]+/)[0].replace(/^\w/, (c) => c.toUpperCase())
  const branch = getBranch(profile?.branch)
  const value = { profile, setProfile, reload, branch, displayName, firstName }

  return (
    <StudentCtx.Provider value={value}>
      <PortalLayout
        role="candidate"
        nav={STUDENT_NAV}
        bottomNav={[{ to: '/candidate/settings', label: 'Settings', icon: Settings }]}
        tabs={STUDENT_TABS}
        user={{ name: displayName || 'Student', sub: 'Student', src: profile?.avatar_url }}
        userMenu={[
          { label: 'My Profile', icon: User, to: '/candidate/profile' },
          { label: 'Settings', icon: Settings, to: '/candidate/settings' },
        ]}
        onLogout={() => { logoutCandidate(); navigate('/candidate/login') }}
        searchPlaceholder="Search for jobs, internships, companies…"
        onSearch={(q) => navigate(`/candidate/opportunities${q ? `?q=${encodeURIComponent(q)}` : ''}`)}
      />
    </StudentCtx.Provider>
  )
}
