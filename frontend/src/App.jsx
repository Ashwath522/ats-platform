import React from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AuthProvider } from './auth.jsx'
import { ToastProvider } from './ui/index.jsx'

// Public
import Landing from './portal/public/Landing.jsx'
import StudentLogin from './portal/public/StudentLogin.jsx'
import RecruiterLogin from './portal/public/RecruiterLogin.jsx'
import AdminLogin from './portal/public/AdminLogin.jsx'
import CandidatePage from './pages/CandidatePage.jsx' // free ATS check (legacy page, still linked from landing)

// Student (pages 04–12)
import StudentShell from './portal/student/StudentShell.jsx'
import StudentDashboard from './portal/student/Dashboard.jsx'
import StudentProfile from './portal/student/Profile.jsx'
import ResumeSkills from './portal/student/ResumeSkills.jsx'
import StudentProjects from './portal/student/Projects.jsx'
import Opportunities from './portal/student/Opportunities.jsx'
import StudentApplications from './portal/student/Applications.jsx'
import AIInterviewPrep from './portal/student/AIInterviewPrep.jsx'
import Resources from './portal/student/Resources.jsx'
import StudentSettings from './portal/student/Settings.jsx'
import InterviewRoom from './interview/InterviewRoom.jsx'

// Recruiter (pages 13–22)
import RecruiterShell from './portal/recruiter/RecruiterShell.jsx'
import RecruiterDashboard from './portal/recruiter/Dashboard.jsx'
import RecruiterJobs from './portal/recruiter/Jobs.jsx'
import RecruiterCandidates from './portal/recruiter/Candidates.jsx'
import RecruiterApplications from './portal/recruiter/Applications.jsx'
import RecruiterShortlisted from './portal/recruiter/Shortlisted.jsx'
import RecruiterInterviews from './portal/recruiter/Interviews.jsx'
import RecruiterOffers from './portal/recruiter/Offers.jsx'
import CompanyProfile from './portal/recruiter/CompanyProfile.jsx'
import RecruiterAnalytics from './portal/recruiter/Analytics.jsx'
import RecruiterSettings from './portal/recruiter/Settings.jsx'

// Admin (pages 23–24 + supporting admin pages)
import AdminShell from './portal/admin/AdminShell.jsx'
import AdminDashboard from './portal/admin/Dashboard.jsx'
import AdminUsers from './portal/admin/Users.jsx'
import AdminCompanies from './portal/admin/Companies.jsx'
import AdminJobPostings from './portal/admin/JobPostings.jsx'
import AdminApplications from './portal/admin/Applications.jsx'
import AdminInterviews from './portal/admin/Interviews.jsx'
import AdminOffers from './portal/admin/Offers.jsx'
import AdminModeration from './portal/admin/Moderation.jsx'
import AdminReports from './portal/admin/Reports.jsx'
import AdminSystemSettings from './portal/admin/SystemSettings.jsx'
import AdminAuditLogs from './portal/admin/AuditLogs.jsx'

/** Redirect that keeps the query string (old links in emails/bookmarks). */
function Moved({ to }) {
  const { search } = useLocation()
  return <Navigate to={`${to}${search}`} replace />
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <BrowserRouter>
          <Routes>
            {/* 01–03 Public */}
            <Route path="/" element={<Landing />} />
            <Route path="/ats-check" element={<div className="app-shell"><CandidatePage /></div>} />
            <Route path="/candidate/login" element={<StudentLogin />} />
            <Route path="/recruiter/login" element={<RecruiterLogin />} />
            <Route path="/admin/login" element={<AdminLogin />} />

            {/* AI interview rooms (full screen, no shell) */}
            <Route path="/candidate/interview/:appId" element={<InterviewRoom />} />
            <Route path="/candidate/practice" element={<InterviewRoom practice />} />

            {/* 04–12 Student */}
            <Route path="/candidate" element={<StudentShell />}>
              <Route index element={<Navigate to="feed" replace />} />
              <Route path="feed" element={<StudentDashboard />} />
              <Route path="profile" element={<StudentProfile />} />
              <Route path="resume-skills" element={<ResumeSkills />} />
              <Route path="projects" element={<StudentProjects />} />
              <Route path="opportunities" element={<Opportunities />} />
              <Route path="applications" element={<StudentApplications />} />
              <Route path="ai-interview" element={<AIInterviewPrep />} />
              <Route path="resources" element={<Resources />} />
              <Route path="settings" element={<StudentSettings />} />
              {/* old routes */}
              <Route path="jobs" element={<Moved to="/candidate/opportunities" />} />
              <Route path="repo" element={<Moved to="/candidate/applications" />} />
              <Route path="contact" element={<Navigate to="/candidate/settings?section=help" replace />} />
            </Route>

            {/* 13–22 Recruiter */}
            <Route path="/recruiter" element={<RecruiterShell />}>
              <Route index element={<Navigate to="dashboard" replace />} />
              <Route path="dashboard" element={<RecruiterDashboard />} />
              <Route path="jobs" element={<RecruiterJobs />} />
              <Route path="jobs/new" element={<RecruiterJobs create />} />
              <Route path="candidates" element={<RecruiterCandidates />} />
              <Route path="applications" element={<RecruiterApplications />} />
              <Route path="shortlisted" element={<RecruiterShortlisted />} />
              <Route path="interviews" element={<RecruiterInterviews />} />
              <Route path="offers" element={<RecruiterOffers />} />
              <Route path="company-profile" element={<CompanyProfile />} />
              <Route path="analytics" element={<RecruiterAnalytics />} />
              <Route path="settings" element={<RecruiterSettings />} />
              {/* old routes */}
              <Route path="home" element={<Navigate to="/recruiter/dashboard" replace />} />
              <Route path="talent" element={<Moved to="/recruiter/candidates" />} />
              <Route path="profile" element={<Navigate to="/recruiter/company-profile" replace />} />
            </Route>

            {/* 23–24 Admin */}
            <Route path="/admin" element={<AdminShell />}>
              <Route index element={<Navigate to="dashboard" replace />} />
              <Route path="dashboard" element={<AdminDashboard />} />
              <Route path="users" element={<AdminUsers />} />
              <Route path="companies" element={<AdminCompanies />} />
              <Route path="jobs" element={<AdminJobPostings />} />
              <Route path="applications" element={<AdminApplications />} />
              <Route path="interviews" element={<AdminInterviews />} />
              <Route path="offers" element={<AdminOffers />} />
              <Route path="moderation" element={<AdminModeration />} />
              <Route path="reports" element={<AdminReports />} />
              <Route path="settings" element={<AdminSystemSettings />} />
              <Route path="audit-logs" element={<AdminAuditLogs />} />
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </AuthProvider>
  )
}
