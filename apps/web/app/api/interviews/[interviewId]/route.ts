import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { interview, job, pipeline, recruiterProfile } from '@/lib/db/schema'
import { eq, and, or } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { canCandidateJoinInterview, joinBlockReason } from '@/lib/interview-access'

export async function GET(
  _request: Request,
  context: { params: Promise<{ interviewId: string }> },
) {
  const { interviewId } = await context.params
  const id = Number(interviewId)
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: 'Invalid interview id' }, { status: 400 })
  }

  const session = await auth.api.getSession({ headers: _request.headers })
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rows = await db
    .select({
      id: interview.id,
      jobTitle: job.title,
      company: recruiterProfile.organizationName,
      scheduledAt: interview.scheduledAt,
      durationMinutes: interview.durationMinutes,
      status: interview.status,
    })
    .from(interview)
    .innerJoin(pipeline, eq(interview.pipelineId, pipeline.id))
    .innerJoin(job, eq(pipeline.jobId, job.id))
    .innerJoin(recruiterProfile, eq(job.userId, recruiterProfile.userId))
    .where(and(eq(interview.id, id), or(eq(interview.userId, session.user.id), eq(interview.recruiterId, session.user.id))))
    .limit(1)

  if (!rows.length) {
    return NextResponse.json({ error: 'Interview not found' }, { status: 404 })
  }

  const row = rows[0]
  const scheduledAt = new Date(row.scheduledAt).toISOString()
  const durationMinutes = row.durationMinutes ?? 30
  const now = Date.now()
  const scheduledTime = new Date(scheduledAt).getTime()
  const durationMs = durationMinutes * 60 * 1000
  const windowStart = scheduledTime - 15 * 60 * 1000
  const windowEnd = scheduledTime + durationMs + 5 * 60 * 1000
  const join = canCandidateJoinInterview({
    status: row.status ?? 'scheduled',
    scheduledAt,
    durationMinutes,
    now,
  })

  return NextResponse.json({
    id: row.id,
    jobTitle: row.jobTitle,
    company: row.company,
    scheduledAt,
    durationMinutes,
    status: row.status,
    canJoin: join.allowed,
    joinBlockReason: join.reason ?? joinBlockReason(row.status ?? 'scheduled'),
    timeToStart: scheduledTime - now,
    timeUntilEnd: scheduledTime + durationMs - now,
    windowStart: windowStart - now,
    windowEnd: windowEnd - now,
  })
}
