'use client'

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  AlertTriangle,
  BriefcaseIcon,
  UsersIcon,
  CheckCircleIcon,
  BarChart3Icon,
  RefreshCcwIcon,
} from "lucide-react"
import {
  getRecruiterJobs,
  getCompletedInterviews,
  getShortlistCandidates,
  moveToShortlist,
  hireCandidate,
  rejectCandidate,
  getRecruiterPipelineCandidates,
  scheduleInterviewBatch,
  getScheduledInterviews,
} from "@/app/actions/core"

// ─── Types ───────────────────────────────────────────────────────────────────
// Dates arrive as ISO strings from the server action (safe across the boundary)

type InterviewData = {
  id: number
  candidateName: string
  jobTitle: string
  company: string
  scheduledAt: string
  status: 'scheduled' | 'baseline' | 'active' | 'completed' | 'cancelled' | 'missed' | 'rescheduled'
  riskScore: number | null
  interviewScore: number | null
  humanReviewRequired: boolean
}

type ShortlistData = {
  candidateId: number
  candidateName: string
  jobTitle: string
  company: string
  jobId: number
  interviewId: number | null
  scheduledAt: string | null
  riskScore: number | null
  interviewScore: number | null
  humanReviewRequired: boolean
}

type ScheduledInterview = {
  id: number
  candidateName: string
  jobTitle: string
  company: string
  scheduledAt: string
  status: 'scheduled' | 'baseline' | 'active' | 'completed' | 'cancelled' | 'missed' | 'rescheduled'
  durationMinutes: number
}

type PipelineCandidate = {
  candidateId: number
  candidateName: string
  jobId: number
  jobTitle: string
  stage: string
}

// ─── Component ────────────────────────────────────────────────────────────────

export function RecruiterDashboard() {
  const [activeTab, setActiveTab] = useState<'completed' | 'shortlist'>('completed')
  const [completedInterviews, setCompletedInterviews] = useState<InterviewData[]>([])
  const [scheduledInterviews, setScheduledInterviews] = useState<ScheduledInterview[]>([])
  const [shortlist, setShortlist] = useState<ShortlistData[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [openJobs, setOpenJobs] = useState<{ id: number; title: string; organizationName: string; description: string | null }[]>([])
  const [pipelineCandidates, setPipelineCandidates] = useState<PipelineCandidate[]>([])
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<number[]>([])
  const [selectedJobId, setSelectedJobId] = useState<number | ''>('')
  const [scheduledAt, setScheduledAt] = useState('')
  const [durationMinutes, setDurationMinutes] = useState(30)
  const [questionMode, setQuestionMode] = useState<'ai' | 'custom'>('ai')
  const [jobDescription, setJobDescription] = useState('')
  const [customQuestionsRaw, setCustomQuestionsRaw] = useState('')

  const loadData = async () => {
    setLoading(true)
    try {
      const [jobs, completed, scheduled, candidates, pipelineRows] = await Promise.all([
        getRecruiterJobs(),
        getCompletedInterviews(),
        getScheduledInterviews(),
        getShortlistCandidates(),
        getRecruiterPipelineCandidates(),
      ])

      setOpenJobs(jobs)
      setCompletedInterviews(completed as InterviewData[])
      setScheduledInterviews(scheduled as ScheduledInterview[])
      setShortlist(candidates as ShortlistData[])
      setPipelineCandidates(pipelineRows)
      setSelectedJobId((current) => current || jobs[0]?.id || '')
      if (!jobDescription && jobs[0]?.description) {
        setJobDescription(jobs[0].description)
      }
    } catch (err) {
      console.error('Failed to load recruiter data:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  // ─── Mutations ────────────────────────────────────────────────────────────

  const handleMoveToShortlist = async (interviewId: number) => {
    const result = await moveToShortlist(interviewId)
    if (result.ok) {
      await loadData()
    } else {
      alert(`Failed to move to shortlist: ${result.error}`)
    }
  }

  const handleHire = async (candidateId: number, jobId: number) => {
    const result = await hireCandidate(candidateId, jobId)
    if (result.ok) {
      await loadData()
    } else {
      alert(`Failed to hire candidate: ${result.error}`)
    }
  }

  const handleReject = async (candidateId: number, jobId: number) => {
    const result = await rejectCandidate(candidateId, jobId)
    if (result.ok) {
      await loadData()
    } else {
      alert(`Failed to reject candidate: ${result.error}`)
    }
  }

  const toggleCandidate = (candidateId: number) => {
    setSelectedCandidateIds((current) => {
      if (current.includes(candidateId)) return current.filter((id) => id !== candidateId)
      if (current.length >= 5) return current
      return [...current, candidateId]
    })
  }

  const handleScheduleBatch = async () => {
    if (!selectedJobId || !scheduledAt) return
    const result = await scheduleInterviewBatch({
      jobId: selectedJobId,
      candidateIds: selectedCandidateIds,
      scheduledAt,
      durationMinutes,
      questionMode,
      jobDescription: questionMode === 'ai' ? jobDescription : undefined,
      customQuestionsRaw: questionMode === 'custom' ? customQuestionsRaw : undefined,
    })
    if (result.ok) {
      setSelectedCandidateIds([])
      await loadData()
    } else {
      alert(`Failed to schedule interviews: ${result.error}`)
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  const formatDateTime = (iso: string | null) => {
    if (!iso) return '—'
    const d = new Date(iso)
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-7xl px-4 py-8 md:px-6">
        <div className="mb-8">
          <h1 className="text-3xl font-bold">Recruiter Workspace</h1>
          <p className="mt-2 text-muted-foreground">Manage jobs, schedule interviews, and review candidates</p>
        </div>

        {/* Stats */}
        <div className="grid gap-4 md:grid-cols-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">Active Jobs</CardTitle>
            </CardHeader>
            <CardContent className="flex items-end gap-2">
              <BriefcaseIcon className="size-5 text-primary" />
              <span className="text-2xl font-bold">{openJobs.length}</span>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">Candidates</CardTitle>
            </CardHeader>
            <CardContent className="flex items-end gap-2">
              <UsersIcon className="size-5 text-primary" />
              <span className="text-2xl font-bold">—</span>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">Scheduled</CardTitle>
            </CardHeader>
            <CardContent className="flex items-end gap-2">
              <CheckCircleIcon className="size-5 text-primary" />
              <span className="text-2xl font-bold">{scheduledInterviews.length}</span>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">Completed</CardTitle>
            </CardHeader>
            <CardContent className="flex items-end gap-2">
              <BarChart3Icon className="size-5 text-primary" />
              <span className="text-2xl font-bold">{completedInterviews.length}</span>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">Missed</CardTitle>
            </CardHeader>
            <CardContent className="flex items-end gap-2">
              <AlertTriangle className="size-5 text-destructive" />
              <span className="text-2xl font-bold text-destructive">
                {completedInterviews.filter((i) => i.status === 'missed').length}
              </span>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">Rescheduled</CardTitle>
            </CardHeader>
            <CardContent className="flex items-end gap-2">
              <RefreshCcwIcon className="size-5 text-primary" />
              <span className="text-2xl font-bold">
                {completedInterviews.filter((i) => i.status === 'rescheduled').length}
              </span>
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <div className="mt-6">
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="text-base">Schedule Interviews</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-3">
                <select
                  value={selectedJobId}
                  onChange={(event) => {
                    const jobId = Number(event.target.value)
                    setSelectedJobId(jobId)
                    setSelectedCandidateIds([])
                    const job = openJobs.find((item) => item.id === jobId)
                    setJobDescription(job?.description ?? '')
                  }}
                  className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  {openJobs.map((job) => (
                    <option key={job.id} value={job.id}>{job.title}</option>
                  ))}
                </select>
                <Input type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} />
                <Input
                  type="number"
                  min={15}
                  max={120}
                  value={durationMinutes}
                  onChange={(event) => setDurationMinutes(Number(event.target.value))}
                />
              </div>

              <div className="space-y-3 rounded-md border p-4">
                <p className="text-sm font-medium">Interview questions</p>
                <div className="flex flex-col gap-2 sm:flex-row sm:gap-6">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="questionMode"
                      checked={questionMode === 'ai'}
                      onChange={() => setQuestionMode('ai')}
                    />
                    AI generate questions
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="questionMode"
                      checked={questionMode === 'custom'}
                      onChange={() => setQuestionMode('custom')}
                    />
                    Use my questions
                  </label>
                </div>

                {questionMode === 'ai' ? (
                  <div className="space-y-2">
                    <label className="text-sm text-muted-foreground">
                      Job description (required for AI questions)
                    </label>
                    <textarea
                      value={jobDescription}
                      onChange={(event) => setJobDescription(event.target.value)}
                      className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      placeholder="Describe responsibilities, skills, and expectations for this role."
                    />
                  </div>
                ) : (
                  <div className="space-y-2">
                    <label className="text-sm text-muted-foreground">
                      One question per line. Optional expected points after |
                    </label>
                    <textarea
                      value={customQuestionsRaw}
                      onChange={(event) => setCustomQuestionsRaw(event.target.value)}
                      className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      placeholder={'Tell me about your relevant experience | experience, role fit\nDescribe a tough tradeoff you made | decision making'}
                    />
                  </div>
                )}
              </div>

              <div className="grid gap-2 md:grid-cols-2">
                {pipelineCandidates
                  .filter((candidate) => candidate.jobId === selectedJobId)
                  .map((candidate) => (
                    <label key={candidate.candidateId} className="flex items-center gap-3 rounded-md border p-3 text-sm">
                      <input
                        type="checkbox"
                        checked={selectedCandidateIds.includes(candidate.candidateId)}
                        onChange={() => toggleCandidate(candidate.candidateId)}
                      />
                      <span className="flex-1">{candidate.candidateName}</span>
                      <span className="text-xs text-muted-foreground">{candidate.stage}</span>
                    </label>
                  ))}
              </div>
              <Button
                onClick={handleScheduleBatch}
                disabled={
                  !selectedJobId ||
                  !scheduledAt ||
                  selectedCandidateIds.length === 0 ||
                  (questionMode === 'ai' && !jobDescription.trim()) ||
                  (questionMode === 'custom' && !customQuestionsRaw.trim())
                }
              >
                Schedule {selectedCandidateIds.length} Interview{selectedCandidateIds.length === 1 ? '' : 's'}
              </Button>
            </CardContent>
          </Card>

          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="text-base">Scheduled Interviews</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {loading ? (
                <p className="text-sm text-muted-foreground">Loading scheduled interviews…</p>
              ) : scheduledInterviews.length === 0 ? (
                <p className="text-sm text-muted-foreground">No interviews scheduled yet.</p>
              ) : (
                scheduledInterviews.map((interview) => (
                  <div key={interview.id} className="flex items-center justify-between rounded-md border p-3">
                    <div>
                      <p className="font-medium">{interview.candidateName}</p>
                      <p className="text-sm text-muted-foreground">
                        {interview.jobTitle} · {formatDateTime(interview.scheduledAt)}
                      </p>
                    </div>
                    <span className="text-xs capitalize text-muted-foreground">{interview.status}</span>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <div className="flex space-x-2 mb-4">
            <Button
              variant={activeTab === 'completed' ? 'default' : 'outline'}
              onClick={() => setActiveTab('completed')}
            >
              Completed Interviews
            </Button>
            <Button
              variant={activeTab === 'shortlist' ? 'default' : 'outline'}
              onClick={() => setActiveTab('shortlist')}
            >
              Final Shortlist
            </Button>
          </div>

          {/* Completed Interviews */}
          {activeTab === 'completed' && (
            <div>
              {loading ? (
                <p className="text-center py-4">Loading completed interviews…</p>
              ) : completedInterviews.length === 0 ? (
                <p className="text-center text-muted-foreground py-4">No completed interviews found.</p>
              ) : (
                <div className="space-y-4">
                  {completedInterviews.map((interview) => (
                    <div key={interview.id} className="border rounded-lg p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-3">
                            <div className="flex-shrink-0">
                              {interview.status === 'completed' && (
                                <CheckCircleIcon className="size-5 text-green-500" />
                              )}
                              {interview.status === 'missed' && (
                                <AlertTriangle className="size-5 text-destructive" />
                              )}
                              {interview.status === 'rescheduled' && (
                                <RefreshCcwIcon className="size-5 text-primary" />
                              )}
                            </div>
                            <div>
                              <p className="font-medium">{interview.candidateName}</p>
                              <p className="text-sm text-muted-foreground">
                                {interview.jobTitle} at {interview.company}
                              </p>
                            </div>
                          </div>
                        </div>
                        <div className="text-right space-y-1">
                          <p className="text-sm font-medium">{formatDateTime(interview.scheduledAt)}</p>
                          <div className="flex items-center gap-2">
                            {interview.riskScore !== null && (
                              <span
                                className={`px-2 py-0.5 text-xs rounded-full ${
                                  interview.riskScore >= 80
                                    ? 'bg-red-100 text-red-700'
                                    : interview.riskScore >= 60
                                    ? 'bg-yellow-100 text-yellow-700'
                                    : 'bg-green-100 text-green-700'
                                }`}
                              >
                                Risk: {interview.riskScore}%
                              </span>
                            )}
                            {interview.humanReviewRequired && (
                              <span className="px-2 py-0.5 text-xs rounded-full bg-yellow-100 text-yellow-700">
                                Human Review
                              </span>
                            )}
                            {interview.interviewScore !== null && (
                              <span className="px-2 py-0.5 text-xs rounded-full bg-blue-100 text-blue-700">
                                Score: {interview.interviewScore}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="mt-4 flex justify-end space-x-3">
                        {interview.status === 'completed' && (
                          <>
                            <a
                              href={`/recruiter/evidence?interviewId=${interview.id}`}
                              className="inline-flex h-7 items-center justify-center rounded-[min(var(--radius-md),12px)] border border-border bg-background px-2.5 text-[0.8rem] font-medium hover:bg-muted"
                            >
                              View Evidence
                            </a>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleMoveToShortlist(interview.id)}
                            >
                              Move to Shortlist
                            </Button>
                          </>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => alert('Schedule another interview feature coming soon.')}
                        >
                          Schedule Another
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Shortlist */}
          {activeTab === 'shortlist' && (
            <div>
              {loading ? (
                <p className="text-center py-4">Loading shortlist…</p>
              ) : shortlist.length === 0 ? (
                <p className="text-center text-muted-foreground py-4">No candidates in shortlist.</p>
              ) : (
                <div className="space-y-4">
                  {shortlist.map((candidate) => (
                    <div key={candidate.candidateId} className="border rounded-lg p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-3">
                            <span className="px-2 py-0.5 text-xs rounded-full bg-blue-100 text-blue-700">
                              Shortlist
                            </span>
                            <div>
                              <p className="font-medium">{candidate.candidateName}</p>
                              <p className="text-sm text-muted-foreground">
                                {candidate.jobTitle} at {candidate.company}
                              </p>
                            </div>
                          </div>
                        </div>
                        <div className="text-right space-y-1">
                          {candidate.scheduledAt && (
                            <p className="text-sm font-medium">{formatDateTime(candidate.scheduledAt)}</p>
                          )}
                          <div className="flex items-center gap-2">
                            {candidate.riskScore !== null && (
                              <span
                                className={`px-2 py-0.5 text-xs rounded-full ${
                                  candidate.riskScore >= 80
                                    ? 'bg-red-100 text-red-700'
                                    : candidate.riskScore >= 60
                                    ? 'bg-yellow-100 text-yellow-700'
                                    : 'bg-green-100 text-green-700'
                                }`}
                              >
                                Risk: {candidate.riskScore}%
                              </span>
                            )}
                            {candidate.humanReviewRequired && (
                              <span className="px-2 py-0.5 text-xs rounded-full bg-yellow-100 text-yellow-700">
                                Human Review
                              </span>
                            )}
                            {candidate.interviewScore !== null && (
                              <span className="px-2 py-0.5 text-xs rounded-full bg-blue-100 text-blue-700">
                                Score: {candidate.interviewScore}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="mt-4 flex justify-end space-x-3">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleHire(candidate.candidateId, candidate.jobId)}
                        >
                          Hire
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleReject(candidate.candidateId, candidate.jobId)}
                        >
                          Reject
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => alert('Schedule another interview feature coming soon.')}
                        >
                          Schedule Another
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
