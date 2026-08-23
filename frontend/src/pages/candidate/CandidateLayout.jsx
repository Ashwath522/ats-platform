import React from 'react'
import { Outlet, Navigate } from 'react-router-dom'
import { useAuth } from '../../auth.jsx'
import BottomNav from '../../components/BottomNav.jsx'

export default function CandidateLayout() {
  const { candidateToken, candidateUsername, logoutCandidate } = useAuth()

  if (!candidateToken) {
    return <Navigate to="/candidate/login" replace />
  }

  return (
    <div className="candidate-layout">
      <div className="candidate-topbar">
        <span className="candidate-topbar-user">
          Signed in as <strong>{candidateUsername}</strong>
        </span>
        <button className="topbar-logout-btn" onClick={logoutCandidate}>Log out</button>
      </div>
      <div className="candidate-content">
        <Outlet />
      </div>
      <BottomNav />
    </div>
  )
}
