import React, { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AuthProvider } from './auth.jsx'
import { ToastProvider } from './ui/index.jsx'

// Public
const Landing = lazy(() => import('./portal/public/Landing.jsx'))
const StudentLogin = lazy(() => import('./portal/public/StudentLogin.jsx'))
const RecruiterLogin = lazy(() => import('./portal/public/RecruiterLogin.jsx'))
const AdminLogin = lazy(() => import('./portal/public/AdminLogin.jsx'))
const CandidatePage = lazy(() => import('./pages/CandidatePage.jsx'))

// Student (pages 04–12)
const StudentShell = lazy(() => import('./portal/student/StudentShell.jsx'))
const StudentDashboard = lazy(() => import('./portal/student/Dashboard.jsx'))
const StudentProfile = lazy(() => import('./portal/student/Profile.jsx'))
const ResumeSkills = lazy(() => import('./portal/student/ResumeSkills.jsx'))
const StudentProjects = lazy(() => import('./portal/student/Projects.jsx'))
const Opportunities = lazy(() => import('./portal/student/Opportunities.jsx'))
const StudentApplications = lazy(() => import('./portal/student/Applications.jsx'))
const AIInterviewPrep = lazy(() => import('./portal/student/AIInterviewPrep.jsx'))
const Resources = lazy(() => import('./portal/student/Resources.jsx'))
const StudentSettings = lazy(() => import('./portal/student/Settings.jsx'))
const InterviewRoom = lazy(() => import('./interview/InterviewRoom.jsx'))

// Recruiter (pages 13–22)
const RecruiterShell = lazy(() => import('./portal/recruiter/RecruiterShell.jsx'))
const RecruiterDashboard = lazy(() => import('./portal/recruiter/Dashboard.jsx'))
const RecruiterJobs = lazy(() => import('./portal/recruiter/Jobs.jsx'))
const RecruiterCandidates = lazy(() => import('./portal/recruiter/Candidates.jsx'))
const RecruiterApplications = lazy(() => import('./portal/recruiter/Applications.jsx'))
const RecruiterShortlisted = lazy(() => import('./portal/recruiter/Shortlisted.jsx'))
const RecruiterInterviews = lazy(() => import('./portal/recruiter/Interviews.jsx'))
const RecruiterOffers = lazy(() => import('./portal/recruiter/Offers.jsx'))
const CompanyProfile = lazy(() => import('./portal/recruiter/CompanyProfile.jsx'))
const RecruiterAnalytics = lazy(() => import('./portal/recruiter/Analytics.jsx'))
const RecruiterSettings = lazy(() => import('./portal/recruiter/Settings.jsx'))

// Admin (pages 23–24 + supporting admin pages)
const AdminShell = lazy(() => import('./portal/admin/AdminShell.jsx'))
const AdminDashboard = lazy(() => import('./portal/admin/Dashboard.jsx'))
const AdminUsers = lazy(() => import('./portal/admin/Users.jsx'))
const AdminCompanies = lazy(() => import('./portal/admin/Companies.jsx'))
const AdminJobPostings = lazy(() => import('./portal/admin/JobPostings.jsx'))
const AdminApplications = lazy(() => import('./portal/admin/Applications.jsx'))
const AdminInterviews = lazy(() => import('./portal/admin/Interviews.jsx'))
const AdminOffers = lazy(() => import('./portal/admin/Offers.jsx'))
const AdminModeration = lazy(() => import('./portal/admin/Moderation.jsx'))
const AdminReports = lazy(() => import('./portal/admin/Reports.jsx'))
const AdminSystemSettings = lazy(() => import('./portal/admin/SystemSettings.jsx'))
const AdminAuditLogs = lazy(() => import('./portal/admin/AuditLogs.jsx'))
const AdminLiveData = lazy(() => import('./portal/admin/LiveData.jsx'))

function PageFallback() { return <div className="page-skeleton" aria-busy="true" /> }

/** Redirect that keeps the query string (old links in emails/bookmarks). */
function Moved({ to }) {
  const { search } = useLocation()
  return <Navigate to={`${to}${search}`} replace />
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <Suspense fallback={<PageFallback />}>
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
              <Route path="live-data" element={<AdminLiveData />} />
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
        </Suspense>
      </ToastProvider>
    </AuthProvider>
  )
}
