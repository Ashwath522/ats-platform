import { NextResponse } from 'next/server'
import {
  getLiveSession,
  serializeLiveSession,
  upsertLiveSession,
  type LiveSignalSummary,
  type StoredLiveSession,
} from '@/lib/proctoring-store'

type LiveSessionPayload = {
  session_id?: string
  interview_id?: number | string
  candidate_name?: string
  job_title?: string
  company?: string
  status?: 'baseline' | 'attending' | 'warning' | 'ended'
  last_seen_at?: string
  risk_score?: number | null
  risk_level?: 'low' | 'medium' | 'high'
  warning?: string | null
  signal_summary?: LiveSignalSummary
}

async function parsePayload(request: Request): Promise<LiveSessionPayload & { snapshot?: File | null }> {
  const contentType = request.headers.get('content-type') ?? ''

  if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData()
    const payloadText = String(formData.get('payload') ?? '{}')
    const payload = JSON.parse(payloadText) as LiveSessionPayload
    const snapshot = formData.get('snapshot')
    return { ...payload, snapshot: snapshot instanceof File ? snapshot : null }
  }

  const payload = (await request.json()) as LiveSessionPayload
  return { ...payload, snapshot: null }
}

export async function GET(_request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params
  const session = getLiveSession(sessionId)
  if (!session) {
    return NextResponse.json({ error: 'session not found' }, { status: 404 })
  }

  return NextResponse.json(serializeLiveSession(session))
}

export async function POST(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params
  const payload = await parsePayload(request)
  const snapshot = payload.snapshot

  const liveSession: StoredLiveSession = {
    session_id: sessionId,
    interview_id: Number(payload.interview_id ?? 0),
    candidate_name: String(payload.candidate_name ?? 'Candidate'),
    job_title: String(payload.job_title ?? 'Interview'),
    company: payload.company ? String(payload.company) : undefined,
    status: payload.status ?? 'attending',
    last_seen_at: payload.last_seen_at ?? new Date().toISOString(),
    risk_score: payload.risk_score ?? null,
    risk_level: payload.risk_level ?? 'low',
    warning: payload.warning ?? null,
    signal_summary: payload.signal_summary ?? {
      faceDetected: false,
      faceCount: 0,
      eyeLookingAtScreen: false,
      gazeX: null,
      gazeY: null,
      headPitch: null,
      headYaw: null,
      headRoll: null,
      personPresent: false,
      shouldersVisible: false,
      poseScore: null,
      attentionScore: 0,
      engagementScore: 0,
      darkLighting: false,
      goodLighting: false,
      brightness: null,
      contrast: null,
      uniformity: null,
      livenessScore: null,
      spoofSuspected: false,
      landmarkDataAvailable: false,
      objects: [],
      redFlags: [],
      activeEventTypes: [],
    },
  }

  if (snapshot instanceof File && snapshot.size > 0) {
    liveSession.snapshot = new Uint8Array(await snapshot.arrayBuffer())
    liveSession.snapshotContentType = snapshot.type || 'image/jpeg'
  } else {
    const existing = getLiveSession(sessionId)
    if (existing?.snapshot) liveSession.snapshot = existing.snapshot
    if (existing?.snapshotContentType) liveSession.snapshotContentType = existing.snapshotContentType
  }

  upsertLiveSession(liveSession)
  return NextResponse.json(serializeLiveSession(liveSession))
}