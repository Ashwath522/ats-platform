import Link from 'next/link'
import { LiveSessionMonitor } from '@/components/recruiter/live-session-monitor'
import { getActiveLiveSessions } from '@/app/actions/core'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export const dynamic = 'force-dynamic'

export default async function AdminLivePage({
  searchParams,
}: {
  searchParams: Promise<{ sessionId?: string }>
}) {
  const { sessionId } = await searchParams

  if (sessionId) {
    return (
      <LiveSessionMonitor
        initialSessionId={sessionId}
        title="Admin live monitor"
        eyebrow="Operations view"
        backHref="/admin/live"
        backLabel="← Back to sessions"
      />
    )
  }

  // No sessionId — show all active sessions (admin sees everything)
  const sessions = await getActiveLiveSessions()

  return (
    <main className="min-h-screen bg-background px-4 py-8 md:px-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">Live Sessions — Admin View</h1>
            <p className="mt-2 text-muted-foreground">
              All candidates currently active in an interview (across all recruiters). Refreshes on each page load.
            </p>
          </div>
          <Link
            href="/admin"
            className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
          >
            ← Back to Admin
          </Link>
        </div>

        {sessions.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>No active sessions</CardTitle>
              <CardDescription>
                No candidates are currently in an active interview session. Sessions appear here
                within seconds of activity and expire after 60 seconds of inactivity.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <div className="space-y-3">
            {sessions.map((session) => (
              <Card key={session.sessionId}>
                <CardContent className="flex items-center justify-between gap-4 py-4">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold truncate">{session.candidateName}</p>
                    <p className="text-sm text-muted-foreground truncate">{session.jobTitle}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Interview #{session.interviewId} · Status: {session.status}
                    </p>
                  </div>
                  <div className="flex items-center gap-4 shrink-0">
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">Risk</p>
                      <p
                        className={`text-sm font-semibold ${
                          session.riskLevel === 'high'
                            ? 'text-red-600'
                            : session.riskLevel === 'medium'
                              ? 'text-yellow-600'
                              : 'text-green-600'
                        }`}
                      >
                        {session.riskLevel.toUpperCase()}
                        {session.riskScore !== null ? ` (${session.riskScore})` : ''}
                      </p>
                    </div>
                    <Link
                      href={`/admin/live?sessionId=${encodeURIComponent(session.sessionId)}`}
                      className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                    >
                      Monitor →
                    </Link>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}