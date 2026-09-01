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
