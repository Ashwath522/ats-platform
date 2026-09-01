import React from 'react'
import { NavLink } from 'react-router-dom'

const tabs = [
  { path: '/candidate/feed', label: 'Feed', icon: '📰' },
  { path: '/candidate/profile', label: 'Profile', icon: '👤' },
  { path: '/candidate/jobs', label: 'Jobs', icon: '💼' },
  { path: '/candidate/repo', label: 'Applications', icon: '📋' },
  { path: '/candidate/contact', label: 'Contact', icon: '📧' },
]

export default function BottomNav() {
  return (
    <nav className="bottom-nav">
      {tabs.map(t => (
        <NavLink
          key={t.path}
          to={t.path}
          className={({ isActive }) => `bottom-nav-tab ${isActive ? 'active' : ''}`}
        >
          <span className="bottom-nav-icon">{t.icon}</span>
          <span className="bottom-nav-label">{t.label}</span>
        </NavLink>
      ))}
    </nav>
  )
}
