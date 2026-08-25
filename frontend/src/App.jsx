import React from 'react'
import { BrowserRouter, Routes, Route, Navigate, Link, useNavigate, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth.jsx'

// Original pages
import CandidatePage from './pages/CandidatePage.jsx'
import RecruiterPage from './pages/RecruiterPage.jsx'

// Candidate portal
import CandidateLogin from './pages/candidate/CandidateLogin.jsx'
import CandidateLayout from './pages/candidate/CandidateLayout.jsx'
import ProfilePage from './pages/candidate/ProfilePage.jsx'
import JobsPage from './pages/candidate/JobsPage.jsx'
import RepoPage from './pages/candidate/RepoPage.jsx'
import ContactPage from './pages/candidate/ContactPage.jsx'
import FeedPage from './pages/candidate/FeedPage.jsx'
import AdminPage from './pages/AdminPage.jsx'

function GlobalNav() {
  const { candidateToken, recruiterToken } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()

  // Hide TopNav on candidate portal and admin routes since they have their own navigation headers
  if (location.pathname.startsWith('/candidate') || location.pathname.startsWith('/admin')) {
    return null
  }

  return (
    <div className="global-nav">
      <div className="global-nav-inner">
        <Link to="/" className="nav-logo" title="Home">
          <div className="nav-logo-icon">A</div>
          <span>ATS Platform</span>
        </Link>
        <div className="nav-links">
          <Link to="/" className={`nav-link ${location.pathname === '/' ? 'active' : ''}`}>Home</Link>
          <Link to="/ats-check" className={`nav-link ${location.pathname === '/ats-check' ? 'active' : ''}`}>Quick Check</Link>
          <Link to="/recruiter" className={`nav-link ${location.pathname === '/recruiter' ? 'active' : ''}`}>Recruiters</Link>
        </div>
        <div className="nav-actions">
          {candidateToken ? (
            <Link to="/candidate" className="btn btn-secondary btn-sm">Go to Portal</Link>
          ) : recruiterToken ? (
            <Link to="/recruiter" className="btn btn-secondary btn-sm">Dashboard</Link>
          ) : (
            <>
              <Link to="/candidate/login" className="btn btn-ghost btn-sm">Log in</Link>
              <Link to="/candidate/login" className="btn btn-primary btn-sm">Join now</Link>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function LandingPage() {
  const navigate = useNavigate()
  return (
    <div className="landing-wrapper">
      <div className="landing-hero">
        <div className="landing-badge">
          <div className="landing-badge-dot" /> Now with local LLM deep analysis
        </div>
        <h1 className="landing-title" onDoubleClick={() => navigate('/admin')} style={{ cursor: 'default' }} title="Double click for Admin panel">
          Find your next great hire,<br />
          <span className="landing-title-accent">faster than ever.</span>
        </h1>
        <p className="landing-subtitle">
          ATS Platform scores candidates instantly and accurately, completely free. No more guessing what the algorithm wants.
        </p>

        <div className="landing-cta-row">
          <Link to="/candidate/login" className="btn btn-primary">I'm a Candidate</Link>
          <Link to="/recruiter" className="btn btn-secondary">I'm a Recruiter</Link>
        </div>

        <div className="landing-stats">
          <div className="landing-stat">
            <span className="landing-stat-number">0ms</span>
            <span className="landing-stat-label">Latency Scoring</span>
          </div>
          <div className="landing-stat">
            <span className="landing-stat-number">100%</span>
            <span className="landing-stat-label">Free & Local</span>
          </div>
          <div className="landing-stat">
            <span className="landing-stat-number">AI</span>
            <span className="landing-stat-label">Deep Insights</span>
          </div>
        </div>
      </div>

      <div className="landing-cards-section">
        <h2 className="landing-cards-heading">Choose your path</h2>
        <div className="landing-cards">
          <Link to="/candidate/login" className="landing-card">
            <div className="landing-card-icon candidate">
              <svg fill="currentColor" viewBox="0 0 24 24"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
            </div>
            <h2>Candidate Portal</h2>
            <p>Build your profile, upload your resume, and discover matching jobs. Auto-score your fit before applying.</p>
            <span className="landing-card-cta">Get started →</span>
          </Link>

          <Link to="/recruiter" className="landing-card">
            <div className="landing-card-icon recruiter">
              <svg fill="currentColor" viewBox="0 0 24 24"><path d="M12 7V3H2v18h20V7H12zM6 19H4v-2h2v2zm0-4H4v-2h2v2zm0-4H4V9h2v2zm0-4H4V5h2v2zm4 12H8v-2h2v2zm0-4H8v-2h2v2zm0-4H8V9h2v2zm0-4H8V5h2v2zm10 12h-8v-2h2v-2h-2v-2h2v-2h-2V9h8v10zm-2-8h-2v2h2v-2zm0 4h-2v2h2v-2z"/></svg>
            </div>
            <h2>Recruiter Dashboard</h2>
            <p>Post jobs, review applicants, and instantly see candidate rankings powered by semantic search and keyword analysis.</p>
            <span className="landing-card-cta">Post a job →</span>
          </Link>

          <Link to="/ats-check" className="landing-card">
            <div className="landing-card-icon ats-check">
              <svg fill="currentColor" viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z"/></svg>
            </div>
            <h2>Quick ATS Check</h2>
            <p>Just want to see how your resume scores against a job description? Paste them here—no account required.</p>
            <span className="landing-card-cta">Try it free →</span>
          </Link>
        </div>
      </div>
      
      <div className="landing-features">
        <div className="landing-features-inner">
          <div className="landing-feature">
            <div className="landing-feature-icon">
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L1 21h22L12 2zm0 3.99L19.53 19H4.47L12 5.99zM11 16h2v2h-2zm0-6h2v4h-2z"/></svg>
            </div>
            <div className="landing-feature-text">
              <h4>Missing Skills Analysis</h4>
              <p>Identify exactly which keywords you're missing from the job description.</p>
            </div>
          </div>
          <div className="landing-feature">
            <div className="landing-feature-icon">
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
            </div>
            <div className="landing-feature-text">
              <h4>Semantic Matching</h4>
              <p>We use vector embeddings to understand the meaning, not just exact words.</p>
            </div>
          </div>
          <div className="landing-feature">
            <div className="landing-feature-icon">
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M11 17h2v-6h-2v6zm1-15C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zM11 9h2V7h-2v2z"/></svg>
            </div>
            <div className="landing-feature-text">
              <h4>Deep Insights</h4>
              <p>Optional integration with local Ollama or Gemini for grammar and technical depth checks.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <GlobalNav />
        <div className="app-shell">
          <Routes>
            {/* Landing */}
            <Route path="/" element={<LandingPage />} />

            {/* Original ATS check (no auth needed) */}
            <Route path="/ats-check" element={<CandidatePage />} />

            {/* Candidate portal */}
            <Route path="/candidate/login" element={<CandidateLogin />} />
            <Route path="/candidate" element={<CandidateLayout />}>
              <Route index element={<Navigate to="feed" replace />} />
              <Route path="feed" element={<FeedPage />} />
              <Route path="profile" element={<ProfilePage />} />
              <Route path="jobs" element={<JobsPage />} />
              <Route path="repo" element={<RepoPage />} />
              <Route path="contact" element={<ContactPage />} />
            </Route>

            {/* Recruiter portal */}
            <Route path="/recruiter" element={<RecruiterPage />} />

            {/* Admin panel */}
            <Route path="/admin" element={<AdminPage />} />

            {/* Fallback */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </BrowserRouter>
    </AuthProvider>
  )
}
