'use client'

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { CheckIcon, ClockIcon } from "lucide-react"
import { InterviewFlow } from "@/components/interview-flow"
import { getCandidateInterviews } from "@/app/actions/core"

type CandidateInterview = {
  id: number
  jobTitle: string
  company: string
  scheduledAt: string
  status: string
  durationMinutes: number
  canAttend: boolean
  blockReason: string | null
}

export function CandidateLobby() {
  const [selectedInterview, setSelectedInterview] = useState<number | null>(null)
  const [upcomingInterviews, setUpcomingInterviews] = useState<CandidateInterview[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getCandidateInterviews()
      .then(setUpcomingInterviews)
      .finally(() => setLoading(false))
  }, [])

  const attendable = upcomingInterviews.filter((interview) => interview.canAttend)
  const closed = upcomingInterviews.filter((interview) => !interview.canAttend)

  if (selectedInterview) {
    const interview = upcomingInterviews.find((i) => i.id === selectedInterview)
    if (interview && !interview.canAttend) {
      return (
        <main className="min-h-screen bg-background">
          <div className="mx-auto max-w-3xl px-4 py-8 md:px-6">
            <Card>
              <CardHeader>
                <CardTitle>Interview unavailable</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  {interview.blockReason ?? 'This interview cannot be joined.'}
                </p>
                <Button onClick={() => setSelectedInterview(null)}>Back to lobby</Button>
              </CardContent>
            </Card>
          </div>
        </main>
      )
    }
    if (interview) {
      return (
        <main className="min-h-screen bg-background">
          <div className="mx-auto max-w-3xl px-4 py-8 md:px-6">
            <InterviewFlow
              interviewId={String(selectedInterview)}
              jobTitle={interview.jobTitle}
              onComplete={() => {
                setSelectedInterview(null)
                getCandidateInterviews().then(setUpcomingInterviews)
              }}
            />
          </div>
        </main>
      )
    }
  }

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-4 py-8 md:px-6">
        <div className="mb-8">
          <div>
            <h1 className="text-3xl font-bold">Interview Lobby</h1>
            <p className="mt-2 text-muted-foreground">Your upcoming interviews</p>
          </div>
        </div>

        <Card className="mb-8 bg-gradient-to-br from-primary/10 to-primary/5">
          <CardHeader>
            <CardTitle>Interview Guidelines</CardTitle>
            <CardDescription>Please review before your interview</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex gap-3">
              <CheckIcon className="size-5 shrink-0 text-green-600" />
              <p>Find a quiet, well-lit space for the interview</p>
            </div>
            <div className="flex gap-3">
              <CheckIcon className="size-5 shrink-0 text-green-600" />
              <p>Test your camera and microphone in advance</p>
            </div>
            <div className="flex gap-3">
              <CheckIcon className="size-5 shrink-0 text-green-600" />
              <p>Have your resume and any relevant materials nearby</p>
            </div>
            <div className="flex gap-3">
              <CheckIcon className="size-5 shrink-0 text-green-600" />
              <p>Close unnecessary tabs and notifications</p>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Your Upcoming Interviews</h2>
          {loading && <p className="text-sm text-muted-foreground">Loading interviews...</p>}
          {!loading && attendable.length === 0 && closed.length === 0 && (
            <Card>
              <CardContent className="py-6 text-sm text-muted-foreground">
                No interviews are scheduled for your account yet.
              </CardContent>
            </Card>
          )}
          {attendable.map((interview) => (
            <Card key={interview.id}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-lg">{interview.jobTitle}</CardTitle>
                    <CardDescription>{interview.company}</CardDescription>
                  </div>
                  <span className="inline-block rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary capitalize">
                    {interview.status}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <ClockIcon className="size-4" />
                  {new Date(interview.scheduledAt).toLocaleString()}
                </div>

                <Button className="w-full" onClick={() => setSelectedInterview(interview.id)}>
                  Enter Interview Room
                </Button>
              </CardContent>
            </Card>
          ))}

          {closed.length > 0 && (
            <>
              <h3 className="text-lg font-medium pt-2">Past / closed interviews</h3>
              {closed.map((interview) => (
                <Card key={interview.id} className="opacity-80">
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div>
                        <CardTitle className="text-lg">{interview.jobTitle}</CardTitle>
                        <CardDescription>{interview.company}</CardDescription>
                      </div>
                      <span className="inline-block rounded-full bg-muted px-3 py-1 text-xs font-medium capitalize">
                        {interview.status}
                      </span>
                    </div>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-3">
                    <p className="text-sm text-muted-foreground">
                      {interview.blockReason ?? 'This interview is no longer available.'}
                    </p>
                    <Button className="w-full" disabled>
                      {interview.status === 'completed' ? 'Completed' : 'Unavailable'}
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </>
          )}
        </div>

        <Card className="mt-8 bg-muted">
          <CardHeader>
            <CardTitle className="text-base">Privacy & Consent</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>
              CoreLink records interviews with your consent to help interviewers provide fair
              feedback. Proctoring snapshots are shared only with the hiring team.
            </p>
            <p className="text-muted-foreground">
              Your interview data is stored securely and deleted after 90 days unless you request
              otherwise.
            </p>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
