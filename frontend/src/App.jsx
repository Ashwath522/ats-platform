import React, { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, Link, useNavigate, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth.jsx'
import './landing.css'

// Original pages
import CandidatePage from './pages/CandidatePage.jsx'
import RecruiterLayout from './pages/recruiter/RecruiterLayout.jsx'
import RecruiterHome from './pages/recruiter/RecruiterHome.jsx'
import RecruiterJobs from './pages/recruiter/RecruiterJobs.jsx'
import RecruiterTalent from './pages/recruiter/RecruiterTalent.jsx'
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
import InterviewRoom from './interview/InterviewRoom.jsx'

function GlobalNav() {
  const { candidateToken, recruiterToken } = useAuth()
  const location = useLocation()

  // Portals and the interview have their own app shell.
  if (location.pathname.startsWith('/candidate') || location.pathname.startsWith('/admin') || location.pathname.startsWith('/recruiter') || location.pathname === '/') {
    return null
  }

  return (
    <div className="global-nav">
      <div className="global-nav-inner">
        <Link to="/" className="nav-logo" title="Home">
          <div className="nav-logo-icon">C</div>
          <span>CoreLink</span>
        </Link>
        <div className="nav-actions">
          {candidateToken ? (
            <Link to="/candidate" className="btn btn-secondary btn-sm">My portal</Link>
          ) : recruiterToken ? (
            <Link to="/recruiter" className="btn btn-secondary btn-sm">Dashboard</Link>
          ) : (
            <Link to="/candidate/login" className="btn btn-primary btn-sm">Sign in</Link>
          )}
        </div>
      </div>
    </div>
  )
}

function LandingPage() {
  const navigate = useNavigate()
  const { candidateToken, recruiterToken } = useAuth()

  useEffect(() => {
    if (candidateToken) navigate('/candidate')
    else if (recruiterToken) navigate('/recruiter')
  }, [candidateToken, recruiterToken, navigate])

  return (
    <div className="lp">
      <header className="lp-top">
        <div className="lp-brand" onDoubleClick={() => navigate('/admin')} title="CoreLink">
          <span className="lp-mark">C</span> CoreLink
        </div>
        <Link to="/candidate/login" className="lp-signin">Sign in</Link>
      </header>

      <section className="lp-hero">
        <span className="lp-pill">AI interviews · Verified recruiters · Fair scoring</span>
        <h1>Get hired for what you can <em>actually</em> do.</h1>
        <p>Upload your resume, prove your skills with real projects, and finish a 10-minute spoken interview with Aria, our AI interviewer — all from your phone.</p>
        <div className="lp-cta">
          <Link to="/candidate/login" className="lp-btn lp-btn-primary">I'm looking for a job</Link>
          <Link to="/recruiter" className="lp-btn lp-btn-ghost">I'm hiring</Link>
        </div>
        <Link to="/ats-check" className="lp-free">Free resume ATS check — no account needed →</Link>
      </section>

      <section className="lp-steps">
        {[
          ['1', 'Match', 'Semantic resume-to-job matching with clear, explainable scores.'],
          ['2', 'Prove', 'Upload a project; AI reviewers verify depth and stack.'],
          ['3', 'Talk', 'A natural voice interview that follows up like a real person.'],
          ['4', 'Decide', 'Recruiters confirm every decision. Nothing is auto-rejected.'],
        ].map(([n, t, d]) => (
          <div className="lp-step" key={n}>
            <span className="lp-step-n">{n}</span>
            <div><strong>{t}</strong><p>{d}</p></div>
          </div>
        ))}
      </section>

      <footer className="lp-foot">© CoreLink · Every AI decision is logged and reviewed by a human.</footer>
    </div>
  )
}

/** Legacy pages sit in a centred, padded column; app-style screens are full-bleed. */
function PageFrame({ children }) {
  const { pathname } = useLocation()
  const legacy = pathname.startsWith('/ats-check')
  return <div className={legacy ? 'app-shell' : 'app-frame'}>{children}</div>
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <GlobalNav />
        <PageFrame>
          <Routes>
            {/* Landing */}
            <Route path="/" element={<LandingPage />} />

            {/* Original ATS check (no auth needed) */}
            <Route path="/ats-check" element={<CandidatePage />} />

            {/* Candidate portal */}
            <Route path="/candidate/login" element={<CandidateLogin />} />
            <Route path="/candidate/interview/:appId" element={<InterviewRoom />} />
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
              <Route path="profile" element={<RecruiterProfile />} />
            </Route>

            {/* Admin panel */}
            <Route path="/admin" element={<AdminPage />} />

            {/* Fallback */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </PageFrame>
      </BrowserRouter>
    </AuthProvider>
  )
}
