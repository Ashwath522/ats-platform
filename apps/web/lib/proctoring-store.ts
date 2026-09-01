export type StoredEvent = {
  event_id: number
  session_id: string
  event_type: string
  severity: 'low' | 'medium' | 'high'
  timestamp: string
  metadata: Record<string, unknown>
  clip_url?: string
  snapshot_url?: string
}

export type StoredMedia = {
  snapshot?: Uint8Array
  clip?: Uint8Array
  snapshotContentType?: string
  clipContentType?: string
}

export type LiveSignalSummary = {
  faceDetected: boolean
  faceCount: number
  eyeLookingAtScreen: boolean
  gazeX: number | null
  gazeY: number | null
  headPitch: number | null
  headYaw: number | null
  headRoll: number | null
  personPresent: boolean
  shouldersVisible: boolean
  poseScore: number | null
  attentionScore: number
  engagementScore: number
  darkLighting: boolean
  goodLighting: boolean
  brightness: number | null
  contrast: number | null
  uniformity: number | null
  livenessScore: number | null
  spoofSuspected: boolean
  landmarkDataAvailable: boolean
  objects: string[]
  redFlags: string[]
  activeEventTypes: string[]
}

export type StoredLiveSession = {
  session_id: string
  interview_id: number
  candidate_name: string
  job_title: string
  company?: string
  status: 'baseline' | 'attending' | 'warning' | 'ended'
  last_seen_at: string
  risk_score: number | null
  risk_level: 'low' | 'medium' | 'high'
  warning: string | null
  signal_summary: LiveSignalSummary
  snapshot?: Uint8Array
  snapshotContentType?: string
  // Additional optional fields used across the app
  baseline_complete?: boolean
  last_updated?: string
  active_high_severity?: boolean
  recent_events?: StoredEvent[]
}

type Store = {
  nextEventId: number
  events: Map<string, StoredEvent[]>
  risks: Map<string, Record<string, unknown>>
  media: Map<number, StoredMedia>
  liveSessions: Map<string, StoredLiveSession>
}

const globalStore = globalThis as typeof globalThis & { __corelinkProctoringStore?: Store }

export const proctoringStore =
  globalStore.__corelinkProctoringStore ??
  (globalStore.__corelinkProctoringStore = {
    nextEventId: 1,
    events: new Map<string, StoredEvent[]>(),
    risks: new Map<string, Record<string, unknown>>(),
    media: new Map<number, StoredMedia>(),
    liveSessions: new Map<string, StoredLiveSession>(),
  })

export function attachMediaToEvent(
  sessionId: string,
  eventId: number,
  urls: { snapshot_url?: string; clip_url?: string },
) {
  const events = proctoringStore.events.get(sessionId) ?? []
  const index = events.findIndex((event) => event.event_id === eventId)
  if (index < 0) return
  events[index] = { ...events[index], ...urls }
  proctoringStore.events.set(sessionId, events)
}

export function getEventsForInterview(interviewId: number): StoredEvent[] {
  return proctoringStore.events.get(`interview:${interviewId}`) ?? []
}

export function upsertLiveSession(session: StoredLiveSession) {
  const existing = proctoringStore.liveSessions.get(session.session_id)
  if (!existing) {
    proctoringStore.liveSessions.set(session.session_id, session)
    return
  }

  // Merge existing with incoming to avoid overwriting with partial payloads
  const merged: StoredLiveSession = {
    ...existing,
    ...session,
    // merge nested signal_summary if provided partially
    signal_summary: { ...existing.signal_summary, ...session.signal_summary },
  }

  proctoringStore.liveSessions.set(session.session_id, merged)
}

export function getLiveSession(sessionId: string): StoredLiveSession | undefined {
  const s = proctoringStore.liveSessions.get(sessionId)
  if (!s) return undefined

  // Ensure returned session always contains full shape (defaults for missing fields)
  const defaultSignal: LiveSignalSummary = {
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
  }

  return {
    session_id: s.session_id,
    interview_id: s.interview_id ?? 0,
    candidate_name: s.candidate_name ?? 'Candidate',
    job_title: s.job_title ?? 'Interview',
    company: s.company,
    status: s.status ?? 'attending',
    last_seen_at: s.last_seen_at ?? new Date().toISOString(),
    risk_score: s.risk_score ?? null,
    risk_level: s.risk_level ?? 'low',
    warning: s.warning ?? null,
    signal_summary: { ...defaultSignal, ...(s.signal_summary ?? {}) },
    snapshot: s.snapshot,
    snapshotContentType: s.snapshotContentType,
    baseline_complete: s.baseline_complete ?? false,
    last_updated: s.last_updated ?? s.last_seen_at ?? new Date().toISOString(),
    active_high_severity: s.active_high_severity ?? false,
    recent_events: s.recent_events ?? [],
  }
}

export function listLiveSessions() {
  return [...proctoringStore.liveSessions.values()].sort((left, right) => {
    return new Date(right.last_seen_at).getTime() - new Date(left.last_seen_at).getTime()
  })
}

export function serializeLiveSession(session: StoredLiveSession) {
  const { snapshot, snapshotContentType, ...rest } = session
  return {
    ...rest,
    snapshot_url: snapshot ? `/api/proctoring/live/${encodeURIComponent(session.session_id)}/snapshot` : undefined,
    has_snapshot: Boolean(snapshot),
    snapshot_content_type: snapshotContentType,
  }
}
