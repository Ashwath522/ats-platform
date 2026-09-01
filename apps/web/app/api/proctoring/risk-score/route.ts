import { NextResponse } from 'next/server'
import { proctoringStore } from '../store'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { interview } from '@/lib/db/schema'
import { and, eq, or } from 'drizzle-orm'

export async function GET(request: Request) {
  // require a logged-in session
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { searchParams } = new URL(request.url)
  const sessionId = searchParams.get('session_id')
  if (!sessionId) return NextResponse.json({ error: 'session_id required' }, { status: 400 })
  // Verify the session_id belongs to this user (session_id format: interview:<id>)
  const interviewIdMatch = sessionId.match(/^interview:(\d+)$/)
  if (!interviewIdMatch) return NextResponse.json({ error: 'Invalid session_id' }, { status: 400 })
  const interviewIdNum = Number(interviewIdMatch[1])
  const owned = await db
    .select({ id: interview.id })
    .from(interview)
    .where(and(eq(interview.id, interviewIdNum), or(eq(interview.userId, session.user.id), eq(interview.recruiterId, session.user.id))))
    .limit(1)
  if (!owned.length) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return NextResponse.json(proctoringStore.risks.get(sessionId) ?? null)
}

export async function POST(request: Request) {
  // require a logged-in session
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json()
  const sessionId = String(body.session_id ?? '')
  if (!sessionId) return NextResponse.json({ error: 'session_id required' }, { status: 400 })
  // Verify the session_id belongs to this user (session_id format: interview:<id>)
  const interviewIdMatch = sessionId.match(/^interview:(\d+)$/)
  if (!interviewIdMatch) return NextResponse.json({ error: 'Invalid session_id' }, { status: 400 })
  const interviewIdNum = Number(interviewIdMatch[1])
  const owned = await db
    .select({ id: interview.id })
    .from(interview)
    .where(and(eq(interview.id, interviewIdNum), or(eq(interview.userId, session.user.id), eq(interview.recruiterId, session.user.id))))
    .limit(1)
  if (!owned.length) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const prev = proctoringStore.risks.get(sessionId) as { score?: number } | undefined
  const incoming = Number(body.score ?? 0)
  const score = Math.max(incoming, Number(prev?.score ?? 0))

  const risk = {
    session_id: sessionId,
    score,
    level: body.level ?? 'low',
    breakdown: body.breakdown ?? {},
    evidence_count: Number(body.evidenceCount ?? body.evidence_count ?? 0),
    timestamp: body.timestamp ?? Date.now(),
  }
  proctoringStore.risks.set(sessionId, risk)
  return NextResponse.json(risk)
}
