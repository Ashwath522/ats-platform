'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ThumbsUp, ThumbsDown, CheckCircle, Flag } from 'lucide-react'
import {
  moveToShortlist,
} from '@/app/actions/core'

type EvidenceSummary = {
  interviewId: number
  candidateName: string
  jobTitle: string
  company: string
  status: string
  scheduledAt: string | null
  riskScore: number | null
  interviewScore: number | null
  transcriptSnippet: string | null
  events: {
    event_type: string
    severity: string
    timestamp: string
    snapshot_url?: string
    clip_url?: string
  }[]
}

export default function EvidenceReview({ summary }: { summary: EvidenceSummary }) {
  const [decision, setDecision] = useState<'pass' | 'reject' | null>(null)
  const [notes, setNotes] = useState('')
  const [message, setMessage] = useState<string | null>(null)

  const riskLevel =
    summary.riskScore === null
      ? 'low'
      : summary.riskScore >= 80
        ? 'high'
        : summary.riskScore >= 60
          ? 'medium'
          : 'low'

  const riskColor = {
    low: 'text-green-700 bg-green-50 border-green-200',
    medium: 'text-yellow-700 bg-yellow-50 border-yellow-200',
    high: 'text-red-700 bg-red-50 border-red-200',
  }

  const riskLabel = {
    low: 'Low Risk',
    medium: 'Medium Risk',
    high: 'High Risk',
  }

  const applyDecision = async (next: 'pass' | 'reject') => {
    setDecision(next)
    setMessage(null)

    if (next === 'pass') {
      const result = await moveToShortlist(summary.interviewId)
      setMessage(result.ok ? 'Candidate moved to shortlist.' : result.error ?? 'Action failed.')
      return
    }

    setMessage('Use hire/reject from the shortlist after review, or reject from dashboard.')
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-1">
        <CardHeader>
          <CardTitle>Interview</CardTitle>
          <CardDescription>Interview #{summary.interviewId}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="font-medium">{summary.candidateName}</p>
          <p className="text-muted-foreground">{summary.jobTitle}</p>
          <p className="text-muted-foreground">{summary.company}</p>
          <p className="capitalize text-muted-foreground">Status: {summary.status}</p>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>{summary.candidateName}</CardTitle>
              <CardDescription>{summary.jobTitle}</CardDescription>
            </div>
            <div className={`rounded-full border px-3 py-1 text-xs font-medium ${riskColor[riskLevel]}`}>
              {riskLabel[riskLevel]}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg border border-border bg-muted p-3">
              <p className="text-xs text-muted-foreground">Risk Score</p>
              <p className="mt-1 font-mono text-sm font-bold">{summary.riskScore ?? 'N/A'}</p>
            </div>
            <div className="rounded-lg border border-border bg-muted p-3">
              <p className="text-xs text-muted-foreground">Interview Score</p>
              <p className="mt-1 font-mono text-sm font-bold">{summary.interviewScore ?? 'N/A'}</p>
            </div>
            <div className="rounded-lg border border-border bg-muted p-3">
              <p className="text-xs text-muted-foreground">Proctoring Events</p>
              <p className="mt-1 font-mono text-sm font-bold">{summary.events.length}</p>
            </div>
          </div>

          {summary.events.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm font-medium">Proctoring Events</p>
              {summary.events.map((event, index) => (
                <div key={`${event.timestamp}-${index}`} className="rounded-md border p-3 text-sm space-y-3">
                  <div>
                    <p className="font-medium">{event.event_type.replace(/_/g, ' ')}</p>
                    <p className="text-muted-foreground">
                      {event.severity} · {new Date(event.timestamp).toLocaleString()}
                    </p>
                  </div>
                  {event.snapshot_url && (
                    <img
                      src={event.snapshot_url}
                      alt={`Proctoring snapshot for ${event.event_type}`}
                      className="max-h-48 rounded-md border object-contain"
                    />
                  )}
                  {event.clip_url && (
                    <video
                      src={event.clip_url}
                      controls
                      className="max-h-48 w-full rounded-md border"
                    />
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              No proctoring events recorded for this interview yet.
            </div>
          )}

          <div className="rounded-lg border border-border bg-muted/50 p-4">
            <p className="text-sm font-medium mb-2">Transcript Snippet</p>
            <p className="text-sm text-muted-foreground italic">
              {summary.transcriptSnippet
                ? `"${summary.transcriptSnippet}"`
                : 'Transcript will appear after the candidate completes the interview.'}
            </p>
          </div>

          <div className="space-y-3">
            <p className="text-sm font-medium">Your Assessment</p>
            <textarea
              placeholder="Add your notes about the candidate..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full h-24 rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />

            <div className="flex gap-2">
              <Button
                variant={decision === 'pass' ? 'default' : 'outline'}
                onClick={() => applyDecision('pass')}
                className="flex-1"
              >
                <ThumbsUp className="mr-2 size-4" />
                Move Forward
              </Button>
              <Button
                variant={decision === 'reject' ? 'destructive' : 'outline'}
                onClick={() => applyDecision('reject')}
                className="flex-1"
              >
                <ThumbsDown className="mr-2 size-4" />
                Not a Fit
              </Button>
            </div>

            {message && <p className="text-sm text-muted-foreground">{message}</p>}

            {decision && (
              <div
                className={`rounded-lg border p-3 text-xs font-medium ${
                  decision === 'pass'
                    ? 'border-green-200 bg-green-50 text-green-700'
                    : 'border-red-200 bg-red-50 text-red-700'
                }`}
              >
                <div className="flex items-center gap-2">
                  {decision === 'pass' ? (
                    <CheckCircle className="size-4" />
                  ) : (
                    <Flag className="size-4" />
                  )}
                  {decision === 'pass'
                    ? 'Ready to advance to next stage'
                    : 'Marked as not a fit for this stage'}
                </div>
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <Link
              href="/recruiter"
              className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
            >
              Back to dashboard
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
