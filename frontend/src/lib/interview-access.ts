const BLOCKED_STATUSES = new Set(['completed', 'missed', 'cancelled'])

export function joinBlockReason(status: string): string | null {
  if (status === 'completed') return 'This interview is already completed'
  if (status === 'missed') return 'This interview was marked as missed'
  if (status === 'cancelled') return 'This interview was cancelled'
  return null
}

export function canCandidateJoinInterview(params: {
  status: string
  scheduledAt: string | Date
  durationMinutes: number
  now?: number
}): { allowed: boolean; reason: string | null; inTimeWindow: boolean } {
  const blocked = joinBlockReason(params.status)
  if (blocked) return { allowed: false, reason: blocked, inTimeWindow: false }

  if (params.status !== 'scheduled' && params.status !== 'active') {
    return { allowed: false, reason: 'Interview is not available to join', inTimeWindow: false }
  }

  const now = params.now ?? Date.now()
  const scheduledTime = new Date(params.scheduledAt).getTime()
  const durationMs = params.durationMinutes * 60 * 1000
  const windowStart = scheduledTime - 15 * 60 * 1000
  const windowEnd = scheduledTime + durationMs + 5 * 60 * 1000
  const inTimeWindow = now >= windowStart && now <= windowEnd

  if (!inTimeWindow && params.status === 'scheduled') {
    return { allowed: false, reason: 'Interview is outside the join window', inTimeWindow: false }
  }

  return { allowed: true, reason: null, inTimeWindow }
}

export function isInterviewTerminal(status: string): boolean {
  return BLOCKED_STATUSES.has(status)
}

export type ApplicationGate = {
  status: string
  repo_match_score?: number | null
  project_score?: number | null
  interview_status?: string | null
}

export function canTakeInterview(app: ApplicationGate): { allowed: boolean; reason: string } {
  if (!app) {
    return { allowed: false, reason: 'No application record found' }
  }

  const validStatuses = new Set(['shortlisted', 'automated_interview', 'repo_verification'])
  if (!validStatuses.has(app.status)) {
    return {
      allowed: false,
      reason: `Interview locked. Application status must be shortlisted (current status: ${app.status}).`,
    }
  }

  const hasRepoScore =
    app.repo_match_score !== undefined && app.repo_match_score !== null ||
    app.project_score !== undefined && app.project_score !== null

  if (!hasRepoScore) {
    return {
      allowed: false,
      reason: 'Interview locked. Candidate must complete Repo / Project Verification first.',
    }
  }

  if (app.interview_status === 'completed') {
    return {
      allowed: false,
      reason: 'Interview is already completed.',
    }
  }

  return { allowed: true, reason: 'Interview unlocked and ready to take' }
}

