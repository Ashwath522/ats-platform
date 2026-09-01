import Link from 'next/link'
import EvidenceReview from '@/components/recruiter/evidence-review'
import { getInterviewEvidenceSummary } from '@/app/actions/core'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export const dynamic = 'force-dynamic'

export default async function RecruiterEvidencePage({
  searchParams,
}: {
  searchParams: Promise<{ interviewId?: string }>
}) {
  const { interviewId: interviewIdParam } = await searchParams
  const interviewId = interviewIdParam ? Number(interviewIdParam) : null
  const summary =
    interviewId && Number.isFinite(interviewId)
      ? await getInterviewEvidenceSummary(interviewId)
      : null

  return (
    <main className="min-h-screen bg-background px-4 py-8 md:px-6">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">Interview Evidence</h1>
            <p className="mt-2 text-muted-foreground">
              Review candidate interviews and make hiring decisions
            </p>
          </div>
          <Link
            href="/recruiter"
            className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
          >
            ← Back to Dashboard
          </Link>
        </div>

        {!summary ? (
          <Card>
            <CardHeader>
              <CardTitle>No evidence loaded</CardTitle>
              <CardDescription>
                Open this page from a completed interview on the recruiter dashboard, or add
                ?interviewId=123 to the URL.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Proctoring events and transcripts will appear here once an interview is completed.
              </p>
            </CardContent>
          </Card>
        ) : (
          <EvidenceReview summary={summary} />
        )}
      </div>
    </main>
  )
}
