import React, { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, Link, useNavigate, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth.jsx'

// Original pages
import CandidatePage from './pages/CandidatePage.jsx'
import RecruiterLayout from './pages/recruiter/RecruiterLayout.jsx'
import RecruiterHome from './pages/recruiter/RecruiterHome.jsx'
import RecruiterJobs from './pages/recruiter/RecruiterJobs.jsx'
import RecruiterTalent from './pages/recruiter/RecruiterTalent.jsx'
import RecruiterMessages from './pages/recruiter/RecruiterMessages.jsx'
import RecruiterProfile from './pages/recruiter/RecruiterProfile.jsx'


// Candidate portal
import CandidateLogin from './pages/candidate/CandidateLogin.jsx'
import CandidateLayout from './pages/candidate/CandidateLayout.jsx'
import ProfilePage from './pages/candidate/ProfilePage.jsx'
import JobsPage from './pages/candidate/JobsPage.jsx'
import ApplicationsPage from './pages/candidate/ApplicationsPage.jsx'
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
          <div className="nav-logo-icon">C</div>
          <span>CoreLink</span>
        </Link>
        <div className="nav-links">
          <Link to="/" className={`nav-link ${location.pathname === '/' ? 'active' : ''}`}>Home</Link>
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
  const { candidateToken, recruiterToken } = useAuth()
  
  // Optional: Auto redirect if they hit the homepage while logged in
  useEffect(() => {
    if (candidateToken) {
      navigate('/candidate')
    } else if (recruiterToken) {
      navigate('/recruiter')
    }
  }, [candidateToken, recruiterToken, navigate])

  return (
    <div className="landing-wrapper">
      <div className="landing-hero">
        <h1 className="landing-title" onDoubleClick={() => navigate('/admin')} style={{ cursor: 'default' }} title="Double click for Admin panel">
          CoreLink<br />
          <span className="landing-title-accent">Connecting talent with the right opportunities.</span>
        </h1>
        <p className="landing-subtitle">
          CoreLink matches candidates and jobs instantly and accurately. A polished platform for professionals.
        </p>

        <div className="landing-cta-row">
          <Link to={candidateToken ? "/candidate" : "/candidate/login"} className="btn btn-primary">I'm a Candidate</Link>
          <Link to="/recruiter" className="btn btn-secondary">I'm a Recruiter</Link>
        </div>
      </div>

      <div className="landing-cards-section">
        <h2 className="landing-cards-heading">What we offer</h2>
        <div className="landing-cards">
          <Link to="/candidate/login" className="landing-card">
            <div className="landing-card-icon candidate">
              <svg fill="currentColor" viewBox="0 0 24 24"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
            </div>
            <h2>For Candidates</h2>
            <ul style={{ textAlign: 'left', margin: '1rem 0', paddingLeft: '1.5rem', color: 'var(--text-secondary)' }}>
              <li>Build your professional profile</li>
              <li>Upload your resume</li>
              <li>Get intelligent job matching</li>
              <li>Track your applications</li>
            </ul>
            <span className="landing-card-cta">Get started →</span>
          </Link>

          <Link to="/recruiter" className="landing-card">
            <div className="landing-card-icon recruiter">
              <svg fill="currentColor" viewBox="0 0 24 24"><path d="M12 7V3H2v18h20V7H12zM6 19H4v-2h2v2zm0-4H4v-2h2v2zm0-4H4V9h2v2zm0-4H4V5h2v2zm4 12H8v-2h2v2zm0-4H8v-2h2v2zm0-4H8V9h2v2zm0-4H8V5h2v2zm10 12h-8v-2h2v-2h-2v-2h2v-2h-2V9h8v10zm-2-8h-2v2h2v-2zm0 4h-2v2h2v-2z"/></svg>
            </div>
            <h2>For Recruiters</h2>
            <ul style={{ textAlign: 'left', margin: '1rem 0', paddingLeft: '1.5rem', color: 'var(--text-secondary)' }}>
              <li>Publish jobs easily</li>
              <li>Discover matching candidates</li>
              <li>Review CoreLink ATS matching</li>
              <li>Manage your hiring pipeline</li>
            </ul>
            <span className="landing-card-cta">Post a job →</span>
          </Link>

          <div className="landing-card" style={{ cursor: 'default' }}>
            <div className="landing-card-icon ats-check">
              <svg fill="currentColor" viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z"/></svg>
            </div>
            <h2>For Companies</h2>
            <ul style={{ textAlign: 'left', margin: '1rem 0', paddingLeft: '1.5rem', color: 'var(--text-secondary)' }}>
              <li>Structured hiring workflow</li>
              <li>Deep candidate insights</li>
              <li>Secure recruiter access</li>
              <li>End-to-end pipeline management</li>
            </ul>
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
              <Route path="repo" element={<ApplicationsPage />} />
              <Route path="contact" element={<ContactPage />} />
            </Route>

            {/* Recruiter portal */}
            <Route path="/recruiter" element={<RecruiterLayout />}>
              <Route index element={<Navigate to="home" replace />} />
              <Route path="home" element={<RecruiterHome />} />
              <Route path="jobs" element={<RecruiterJobs />} />
              <Route path="talent" element={<RecruiterTalent />} />
              <Route path="messages" element={<RecruiterMessages />} />
              <Route path="profile" element={<RecruiterProfile />} />
            </Route>

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
