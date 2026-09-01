import { fetcher } from './system'

export interface InterviewData {
  id: number
  jobTitle: string
  company: string
  scheduledAt: string // ISO date string
  durationMinutes: number
  status: 'scheduled' | 'baseline' | 'active' | 'completed' | 'cancelled' | 'missed' | 'rescheduled'
  canJoin: boolean
  joinBlockReason?: string | null
  timeToStart: number // milliseconds until interview can start (negative if already started)
  timeUntilEnd: number // milliseconds until interview ends (negative if already ended)
  windowStart: number // milliseconds from now when window opens
  windowEnd: number // milliseconds from now when window closes
}

export const interviewService = {
  // Get interview details for candidate
  async getInterviewDetails(interviewId: string): Promise<InterviewData> {
    const response = await fetcher<InterviewData>(`/api/interviews/${interviewId}`)
    return response
  },

  // Check if candidate can join interview based on time window
  // Window: 10-15 minutes before start until end of scheduled duration + small grace (5 minutes)
  canJoinInterview(scheduledAt: string, durationMinutes: number): { canJoin: boolean; timeToStart: number; timeUntilEnd: number; windowStart: number; windowEnd: number } {
    const now = Date.now()
    const scheduledTime = new Date(scheduledAt).getTime()
    const durationMs = durationMinutes * 60 * 1000

    // Window opens 15 minutes before scheduled start
    const windowStart = scheduledTime - (15 * 60 * 1000)
    // Window closes at end of scheduled duration + 5 minute grace period
    const windowEnd = scheduledTime + durationMs + (5 * 60 * 1000)

    const canJoin = now >= windowStart && now <= windowEnd
    const timeToStart = scheduledTime - now // Positive if in future, negative if already started
    const timeUntilEnd = (scheduledTime + durationMs) - now // Positive if not ended yet, negative if already ended

    return {
      canJoin,
      timeToStart,
      timeUntilEnd,
      windowStart,
      windowEnd
    }
  },

  // Format time remaining for display
  formatTimeRemaining(ms: number): string {
    const totalSeconds = Math.abs(Math.floor(ms / 1000))
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60

    if (hours > 0) {
      return `${hours}h ${minutes}m ${seconds}s`
    } else if (minutes > 0) {
      return `${minutes}m ${seconds}s`
    } else {
      return `${seconds}s`
    }
  },

  // Get status message for candidate
  getStatusMessage(scheduledAt: string, durationMinutes: number): { message: string; showJoinButton: boolean } {
    const { canJoin, timeToStart } = this.canJoinInterview(scheduledAt, durationMinutes)
    const now = Date.now()
    const scheduledTime = new Date(scheduledAt).getTime()

    if (!canJoin) {
      if (now < scheduledTime - (15 * 60 * 1000)) {
        // More than 15 minutes before start
        const hoursUntil = Math.floor((scheduledTime - now) / (1000 * 60 * 60))
        const minutesUntil = Math.floor(((scheduledTime - now) % (1000 * 60 * 60)) / (1000 * 60))
        return {
          message: `Interview starts in ${hoursUntil}h ${minutesUntil}m`,
          showJoinButton: false
        }
      } else if (now > scheduledTime + (durationMinutes * 60 * 1000) + (5 * 60 * 1000)) {
        // Past end time + grace period
        return {
          message: 'Interview has ended',
          showJoinButton: false
        }
      } else {
        // Between start time and end+grace but not in window (shouldn't happen with our logic)
        return {
          message: 'Please wait for your turn',
          showJoinButton: false
        }
      }
    } else {
      // Within join window
      if (timeToStart > 0) {
        // Before scheduled start time
        const minutesUntil = Math.floor(timeToStart / (1000 * 60))
        const secondsUntil = Math.floor((timeToStart % (1000 * 60)) / 1000)
        return {
          message: `Interview starts in ${minutesUntil}m ${secondsUntil}s`,
          showJoinButton: true // Show join button but indicate it's not time yet
        }
      } else {
        // Already started or in progress
        return {
          message: 'Join now',
          showJoinButton: true
        }
      }
    }
  }
}