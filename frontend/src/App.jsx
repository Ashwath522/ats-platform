import React, { useState } from 'react'
import CandidatePage from './pages/CandidatePage.jsx'
import RecruiterPage from './pages/RecruiterPage.jsx'

export default function App() {
  const [tab, setTab] = useState('candidate')

  return (
    <div className="app-shell">
      <div className="app-header">
        <h1><span className="beacon" /> ATS Platform</h1>
      </div>
      <p className="app-subtitle">Resume screening, company matching, and recruiter ranking — scored locally, no LLM in the hot path.</p>

      <div className="tabs">
        <button className={`tab-btn ${tab === 'candidate' ? 'active' : ''}`} onClick={() => setTab('candidate')}>
          Candidate
        </button>
        <button className={`tab-btn ${tab === 'recruiter' ? 'active' : ''}`} onClick={() => setTab('recruiter')}>
          Recruiter
        </button>
      </div>

      {tab === 'candidate' ? <CandidatePage /> : <RecruiterPage />}
    </div>
  )
}
