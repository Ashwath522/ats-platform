'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, ArrowLeft, Eye, EyeOff, Phone, ShieldAlert, Signal, UserRound, Video } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

type LiveSignalSummary = {
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

type LiveSession = {
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
  snapshot_url?: string
  has_snapshot?: boolean
}

type LiveSessionMonitorProps = {
  initialSessionId: string | null
  title: string
  eyebrow: string
  backHref: string
  backLabel: string
}

function riskTone(level: LiveSession['risk_level']) {
  if (level === 'high') return 'destructive'
  if (level === 'medium') return 'secondary'
  return 'outline'
}

function metricTone(active: boolean) {
  return active ? 'text-destructive' : 'text-muted-foreground'
}

export function LiveSessionMonitor({ initialSessionId, title, eyebrow, backHref, backLabel }: LiveSessionMonitorProps) {
  const [sessions, setSessions] = useState<LiveSession[]>([])
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(initialSessionId)
  const [activeSession, setActiveSession] = useState<LiveSession | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const activeCount = useMemo(
    () => sessions.filter((session) => session.status !== 'ended').length,
    [sessions],
  )

  const loadSessions = async (preferredSessionId?: string | null) => {
    try {
      const response = await fetch('/api/proctoring/live', { cache: 'no-store' })
      if (!response.ok) {
        throw new Error(`Failed to load live sessions (${response.status})`)
      }

      const nextSessions = (await response.json()) as LiveSession[]
      setSessions(nextSessions)

      const nextSelected =
        preferredSessionId ??
        selectedSessionId ??
        nextSessions.find((session) => session.status === 'warning')?.session_id ??
        nextSessions[0]?.session_id ??
        null

      if (nextSelected && nextSelected !== selectedSessionId) {
        setSelectedSessionId(nextSelected)
      }

      if (nextSelected) {
        const detailResponse = await fetch(`/api/proctoring/live/${encodeURIComponent(nextSelected)}`, {
          cache: 'no-store',
        })
        if (detailResponse.ok) {
          setActiveSession((await detailResponse.json()) as LiveSession)
        } else {
          setActiveSession(null)
        }
      } else {
        setActiveSession(null)
      }

      setError(null)
    } catch (loadError) {
      console.error('Failed to load live sessions:', loadError)
      setError('Unable to load live session data right now.')
      setActiveSession(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadSessions(initialSessionId)

    const interval = window.setInterval(() => {
      void loadSessions(selectedSessionId)
    }, 2500)

    return () => window.clearInterval(interval)
  }, [initialSessionId])

  useEffect(() => {
    if (!selectedSessionId) return
    if (activeSession?.session_id === selectedSessionId) return

    void loadSessions(selectedSessionId)
  }, [selectedSessionId])

  const visibleSession = activeSession ?? sessions.find((session) => session.session_id === selectedSessionId) ?? null
  const summary = visibleSession?.signal_summary
  const liveSnapshotUrl = visibleSession?.snapshot_url
    ? `${visibleSession.snapshot_url}?v=${encodeURIComponent(visibleSession.last_seen_at)}`
    : null

  return (
    <main className="min-h-screen bg-background px-4 py-8 md:px-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.28em] text-muted-foreground">{eyebrow}</p>
            <h1 className="mt-2 text-3xl font-bold">{title}</h1>
            <p className="mt-2 text-muted-foreground">
              Live candidate monitor with face, gaze, posture, and risk warnings pulled from the running interview.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant="outline" className="gap-2">
              <Signal className="size-3" />
              {activeCount} active
            </Badge>
            <Link
              href={backHref}
              className="inline-flex h-10 items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
            >
              <ArrowLeft className="mr-2 size-4" />
              {backLabel}
            </Link>
          </div>
        </div>

        {error && (
          <Card className="border-destructive/30 bg-destructive/5">
            <CardContent className="py-4 text-sm text-destructive">{error}</CardContent>
          </Card>
        )}

        {loading && sessions.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-sm text-muted-foreground">Loading live session data…</CardContent>
          </Card>
        ) : sessions.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>No one is attending right now</CardTitle>
              <CardDescription>
                When a candidate joins the interview, their live snapshot and proctoring indicators will appear here.
              </CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              The page stays ready for the next person who enters a session.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
            <Card className="h-fit">
              <CardHeader>
                <CardTitle>Live sessions</CardTitle>
                <CardDescription>Pick a candidate to inspect the latest feed.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {sessions.map((session) => {
                  const isSelected = session.session_id === selectedSessionId
                  return (
                    <button
                      key={session.session_id}
                      onClick={() => setSelectedSessionId(session.session_id)}
                      className={`w-full rounded-xl border p-4 text-left transition ${
                        isSelected ? 'border-primary bg-primary/5 shadow-sm' : 'hover:border-muted-foreground/40'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold">{session.candidate_name}</p>
                          <p className="text-sm text-muted-foreground">{session.job_title}</p>
                        </div>
                        <Badge variant={riskTone(session.risk_level)} className="capitalize">
                          {session.risk_level}
                        </Badge>
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                        <span>{session.status === 'warning' ? 'This person is attending' : 'Monitoring live'}</span>
                        <span>{new Date(session.last_seen_at).toLocaleTimeString()}</span>
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">This person is attending - View live</span>
                        <Link href={`/recruiter/live/${session.interview_id}`}>
                          <Button variant="outline" size="sm">View live</Button>
                        </Link>
                      </div>
                    </button>
                  )
                })}
              </CardContent>
            </Card>

            {visibleSession ? (
              <div className="space-y-6">
                <Card className={visibleSession.risk_level === 'high' ? 'border-destructive/40 bg-destructive/5' : ''}>
                  <CardHeader className="space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <CardTitle className="flex items-center gap-2 text-2xl">
                          {visibleSession.candidate_name}
                          {visibleSession.risk_level === 'high' && <ShieldAlert className="size-5 text-destructive" />}
                        </CardTitle>
                        <CardDescription className="mt-1">
                          {visibleSession.job_title} {visibleSession.company ? `· ${visibleSession.company}` : ''}
                        </CardDescription>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={riskTone(visibleSession.risk_level)} className="gap-2 capitalize">
                          {visibleSession.risk_level}
                        </Badge>
                        <Badge variant="outline" className="gap-2 capitalize">
                          {visibleSession.status}
                        </Badge>
                      </div>
                    </div>

                    {visibleSession.warning && (
                      <div className="flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
                        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                        <div>
                          <p className="font-semibold">Live warning</p>
                          <p>{visibleSession.warning}</p>
                        </div>
                      </div>
                    )}
                  </CardHeader>

                  <CardContent className="space-y-6">
                    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,0.9fr)]">
                      <div className="space-y-3">
                        <div className="relative aspect-video overflow-hidden rounded-2xl border bg-slate-950 shadow-lg">
                          {liveSnapshotUrl ? (
                            <img
                              src={liveSnapshotUrl}
                              alt={`${visibleSession.candidate_name} live snapshot`}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-full items-center justify-center text-sm text-slate-300">
                              Waiting for the first live snapshot…
                            </div>
                          )}
                          <div className="absolute left-4 top-4 rounded-full bg-destructive px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-destructive-foreground shadow">
                            Live
                          </div>
                        </div>

                        <p className="text-xs text-muted-foreground">
                          Updated {new Date(visibleSession.last_seen_at).toLocaleTimeString()} · session {visibleSession.session_id}
                        </p>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                        <MetricCard
                          icon={<UserRound className="size-4" />}
                          label="Face"
                          value={summary?.faceDetected ? `${summary.faceCount} detected` : 'Not detected'}
                          tone={metricTone(!summary?.faceDetected)}
                        />
                        <MetricCard
                          icon={summary?.eyeLookingAtScreen ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
                          label="Eyes"
                          value={summary?.eyeLookingAtScreen ? 'Looking at screen' : 'Looking away'}
                          tone={metricTone(!summary?.eyeLookingAtScreen)}
                        />
                        <MetricCard
                          icon={<Video className="size-4" />}
                          label="Body"
                          value={summary?.shouldersVisible ? 'Shoulders visible' : 'Low posture / turned'}
                          tone={metricTone(!summary?.shouldersVisible)}
                        />
                        <MetricCard
                          icon={<Signal className="size-4" />}
                          label="Attention"
                          value={`${Math.round((summary?.attentionScore ?? 0) * 100)}%`}
                          tone={metricTone((summary?.attentionScore ?? 0) < 0.6)}
                        />
                        <MetricCard
                          icon={<ShieldAlert className="size-4" />}
                          label="Liveness"
                          value={summary?.spoofSuspected ? 'Spoof suspected' : 'Looks live'}
                          tone={metricTone(Boolean(summary?.spoofSuspected))}
                        />
                        <MetricCard
                          icon={<Phone className="size-4" />}
                          label="Objects"
                          value={summary?.objects?.length ? summary.objects.join(', ') : 'No objects'}
                          tone={metricTone(Boolean(summary?.objects?.some((item) => item.toLowerCase().includes('phone'))))}
                        />
                      </div>
                    </div>

                    <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
                      <StatTile label="Risk score" value={visibleSession.risk_score?.toString() ?? 'N/A'} />
                      <StatTile label="Lighting" value={summary?.darkLighting ? 'Dark' : 'OK'} highlight={summary?.darkLighting} />
                      <StatTile label="Landmarks" value={summary?.landmarkDataAvailable ? 'Available' : 'Missing'} highlight={!summary?.landmarkDataAvailable} />
                      <StatTile label="Pose" value={summary?.poseScore != null ? summary.poseScore.toFixed(0) : 'N/A'} />
                      <StatTile label="Active flags" value={(summary?.redFlags.length ?? 0).toString()} highlight={(summary?.redFlags.length ?? 0) > 0} />
                      <StatTile label="Events" value={(summary?.activeEventTypes.length ?? 0).toString()} />
                    </div>

                    <div className="rounded-2xl border bg-muted/40 p-4">
                      <p className="text-sm font-medium">Red flags now</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {summary?.redFlags.length ? (
                          summary.redFlags.map((flag) => (
                            <Badge key={flag} variant="destructive" className="capitalize">
                              {flag.replace(/_/g, ' ')}
                            </Badge>
                          ))
                        ) : (
                          <span className="text-sm text-muted-foreground">No live red flags at the moment.</span>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </main>
  )
}

function MetricCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode
  label: string
  value: string
  tone?: string
}) {
  return (
    <div className="rounded-2xl border bg-background p-4 shadow-sm">
      <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted-foreground">
        <span className={tone}>{icon}</span>
        {label}
      </div>
      <p className={`mt-3 text-sm font-semibold ${tone ?? ''}`}>{value}</p>
    </div>
  )
}

function StatTile({
  label,
  value,
  highlight,
}: {
  label: string
  value: string
  highlight?: boolean
}) {
  return (
    <div className={`rounded-xl border p-3 ${highlight ? 'border-destructive/30 bg-destructive/5' : 'bg-background'}`}>
      <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{label}</p>
      <p className={`mt-2 text-sm font-semibold ${highlight ? 'text-destructive' : ''}`}>{value}</p>
    </div>
  )
}