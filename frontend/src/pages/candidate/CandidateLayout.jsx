import React, { useEffect, useState } from 'react'
import { Outlet, Navigate, Link, useNavigate } from 'react-router-dom'
import { useAuth, createAuthedFetch } from '../../auth.jsx'
import BottomNav from '../../components/BottomNav.jsx'

export default function CandidateLayout() {
  const { candidateToken, candidateUsername, logoutCandidate } = useAuth()
  const navigate = useNavigate()
  const api = createAuthedFetch(candidateToken, logoutCandidate)

  const [profile, setProfile] = useState(null)

  useEffect(() => {
    if (candidateToken) {
      api('/api/candidate/profile')
        .then(res => {
          if (res.ok) return res.json()
        })
        .then(data => {
          if (data) setProfile(data)
        })
        .catch(() => {})
    }
  }, [candidateToken])

  if (!candidateToken) {
    return <Navigate to="/candidate/login" replace />
  }

  const initials = candidateUsername ? candidateUsername.substring(0, 2).toUpperCase() : 'EE'
  const headline = profile?.headline || 'Candidate Profile'

  return (
    <div className="candidate-layout">
      <div className="candidate-topbar">
        {/* Compact persistent profile indicator top-left */}
        <div className="topbar-profile-indicator" onClick={() => navigate('/candidate/profile')} style={{ cursor: 'pointer' }}>
          <div className="topbar-avatar">{initials}</div>
          <div className="topbar-profile-meta">
            <span className="topbar-username">{candidateUsername}</span>
            <span className="topbar-headline" title={headline}>{headline}</span>
          </div>
        </div>

        {/* Double click title for admin gesture */}
        <h2 className="topbar-app-logo" onDoubleClick={() => navigate('/admin')} style={{ cursor: 'pointer', userSelect: 'none' }} title="Double click for Admin panel">
          ATS Portal
        </h2>

        <div className="topbar-actions">
          <button className="topbar-logout-btn" onClick={logoutCandidate}>Log out</button>
        </div>
      </div>

      <div className="candidate-content">
        <Outlet context={{ loadParentProfile: () => {
          // Allow children pages to update layout profile
          api('/api/candidate/profile')
            .then(res => { if (res.ok) return res.json() })
            .then(data => { if (data) setProfile(data) })
        }}} />
      </div>
      <BottomNav />
    </div>
  )
}
