import React from 'react'
import { BrowserRouter, Routes, Route, Navigate, Link } from 'react-router-dom'
import { AuthProvider } from './auth.jsx'

// Original pages (preserved for backwards compatibility)
import CandidatePage from './pages/CandidatePage.jsx'
import RecruiterPage from './pages/RecruiterPage.jsx'

// New candidate pages
import CandidateLogin from './pages/candidate/CandidateLogin.jsx'
import CandidateLayout from './pages/candidate/CandidateLayout.jsx'
import ProfilePage from './pages/candidate/ProfilePage.jsx'
import JobsPage from './pages/candidate/JobsPage.jsx'
import RepoPage from './pages/candidate/RepoPage.jsx'
import ContactPage from './pages/candidate/ContactPage.jsx'

function LandingPage() {
  return (
    <div className="landing-page">
      <div className="landing-hero">
        <div className="landing-glow" />
        <h1 className="landing-title">
          <span className="beacon" /> ATS Platform
        </h1>
        <p className="landing-subtitle">
          Resume screening, job matching, and candidate ranking — scored locally, no LLM in the hot path.
        </p>

        <div className="landing-cards">
          <Link to="/candidate/login" className="landing-card candidate-card">
            <div className="landing-card-icon">👤</div>
            <h2>Candidate</h2>
            <p>Build your profile, upload your resume, browse jobs, and apply with automatic ATS scoring.</p>
            <span className="landing-card-cta">Get started →</span>
          </Link>

          <Link to="/recruiter" className="landing-card recruiter-card">
            <div className="landing-card-icon">🏢</div>
            <h2>Recruiter</h2>
            <p>Post jobs, manage companies, and see candidates ranked by match score in real-time.</p>
            <span className="landing-card-cta">Get started →</span>
          </Link>

          <Link to="/ats-check" className="landing-card ats-card">
            <div className="landing-card-icon">📊</div>
            <h2>ATS Check</h2>
            <p>Quick resume ATS score check — no account needed. Upload and get instant feedback.</p>
            <span className="landing-card-cta">Try it free →</span>
          </Link>
        </div>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <div className="app-shell">
          <Routes>
            {/* Landing */}
            <Route path="/" element={<LandingPage />} />

            {/* Original ATS check (no auth needed) */}
            <Route path="/ats-check" element={
              <>
                <div className="app-header">
                  <h1><span className="beacon" /> ATS Platform</h1>
                  <Link to="/" className="back-link">← Home</Link>
                </div>
                <CandidatePage />
              </>
            } />

            {/* Candidate portal */}
            <Route path="/candidate/login" element={<CandidateLogin />} />
            <Route path="/candidate" element={<CandidateLayout />}>
              <Route index element={<Navigate to="profile" replace />} />
              <Route path="profile" element={<ProfilePage />} />
              <Route path="jobs" element={<JobsPage />} />
              <Route path="repo" element={<RepoPage />} />
              <Route path="contact" element={<ContactPage />} />
            </Route>

            {/* Recruiter portal */}
            <Route path="/recruiter" element={
              <>
                <div className="app-header">
                  <h1><span className="beacon" /> ATS Platform</h1>
                  <Link to="/" className="back-link">← Home</Link>
                </div>
                <RecruiterPage />
              </>
            } />

            {/* Fallback */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </BrowserRouter>
    </AuthProvider>
  )
}
