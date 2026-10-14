import React from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Home, Users, Building2, Briefcase, FileText, CalendarDays, Handshake, ShieldCheck, BarChart3, Settings, ScrollText, Radio } from 'lucide-react'
import PortalLayout from '../../ui/PortalLayout.jsx'
import { useAuth } from '../../auth.jsx'

export const ADMIN_NAV = [
  { to: '/admin/dashboard', label: 'Dashboard', icon: Home },
  { to: '/admin/users', label: 'Users', icon: Users },
  { to: '/admin/companies', label: 'Companies', icon: Building2 },
  { to: '/admin/jobs', label: 'Job Postings', icon: Briefcase },
  { to: '/admin/applications', label: 'Applications', icon: FileText },
  { to: '/admin/interviews', label: 'Interviews', icon: CalendarDays },
  { to: '/admin/offers', label: 'Offers & Hiring', icon: Handshake },
  { to: '/admin/moderation', label: 'Content Moderation', icon: ShieldCheck },
  { to: '/admin/reports', label: 'Reports & Analytics', icon: BarChart3 },
  { to: '/admin/live-data', label: 'Live Data', icon: Radio },
  { to: '/admin/settings', label: 'System Settings', icon: Settings },
  { to: '/admin/audit-logs', label: 'Audit Logs', icon: ScrollText },
]
const TABS = [
  { to: '/admin/dashboard', label: 'Dashboard', short: 'Home', icon: Home },
  { to: '/admin/users', label: 'Users', icon: Users },
  { to: '/admin/moderation', label: 'Moderation', icon: ShieldCheck },
  { to: '/admin/reports', label: 'Reports', icon: BarChart3 },
  { to: '/admin/settings', label: 'Settings', icon: Settings },
]

export default function AdminShell() {
  const { adminToken, adminUsername, logoutAdmin } = useAuth()
  const navigate = useNavigate()
  if (!adminToken) return <Navigate to="/admin/login" replace />
  return (
    <PortalLayout
      role="admin"
      brandSub="Admin Dashboard"
      nav={ADMIN_NAV}
      tabs={TABS}
      user={{ name: 'Admin', sub: adminUsername || 'Super Admin' }}
      onLogout={() => { logoutAdmin(); navigate('/admin/login') }}
      searchPlaceholder="Search users, companies, jobs, reports…"
      onSearch={(q) => navigate(`/admin/users${q ? `?q=${encodeURIComponent(q)}` : ''}`)}
    />
  )
}
