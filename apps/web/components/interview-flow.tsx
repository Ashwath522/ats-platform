'use client'

import { useState, useEffect } from 'react'
import { MediaSetup } from './media-setup'
import LiveInterviewRoom from './live-interview-room'
import BaselineCapture from './baseline-capture'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { CheckIcon, ChevronRightIcon } from 'lucide-react'
import { interviewService, InterviewData } from '@/lib/interview-service'
import { markInterviewStarted } from '@/app/actions/core'

interface InterviewFlowProps {
  interviewId: string
  jobTitle: string
  onComplete: () => void
}

type FlowStep = 'consent' | 'setup' | 'baseline' | 'interview' | 'complete'

export function InterviewFlow({ interviewId, jobTitle, onComplete }: InterviewFlowProps) {
  const [step, setStep] = useState<FlowStep>('consent')
  const [interviewData, setInterviewData] = useState<InterviewData | null>(null)
  const [intervalId, setIntervalId] = useState<NodeJS.Timeout | null>(null)
  const [statusMessage, setStatusMessage] = useState({ message: 'Loading...', showJoinButton: false })
  const [blockedMessage, setBlockedMessage] = useState<string | null>(null)

  // Fetch interview details on mount and when interviewId changes
  useEffect(() => {
    const fetchInterviewData = async () => {
      try {
        const data = await interviewService.getInterviewDetails(interviewId)
        setInterviewData(data)

        if (data.joinBlockReason || !data.canJoin) {
          setBlockedMessage(data.joinBlockReason ?? 'This interview is not available to join.')
          setStatusMessage({ message: data.joinBlockReason ?? 'Unavailable', showJoinButton: false })
          return
        }

        const status = interviewService.getStatusMessage(data.scheduledAt, data.durationMinutes)
        setStatusMessage(status)
      } catch (error) {
        console.error('Failed to fetch interview data:', error)
        setStatusMessage({ message: 'Failed to load interview details', showJoinButton: false })
      }
    }

    fetchInterviewData()

    // Set up polling to update time-sensitive status (every 30 seconds)
    const interval = setInterval(() => {
      if (interviewData) {
        const status = interviewService.getStatusMessage(interviewData.scheduledAt, interviewData.durationMinutes)
        setStatusMessage(status)
      }
    }, 30 * 1000) // 30 seconds

    setIntervalId(interval)

    // Cleanup interval on unmount
    return () => {
      if (intervalId) {
        clearInterval(intervalId)
      }
    }
  }, [interviewId])

  if (blockedMessage) {
    return (
      <div className="max-w-3xl mx-auto">
        <Card>
          <CardHeader>
            <CardTitle>Interview unavailable</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-base text-muted-foreground">{blockedMessage}</p>
            <Button onClick={onComplete} className="w-full">
              Return to Lobby
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const renderStep = () => {
    switch (step) {
      case 'consent':
        return (
          <Card>
            <CardHeader>
              <CardTitle>Interview Consent & Privacy</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                <div className="flex gap-3">
                  <div className="flex-shrink-0">
                    <CheckIcon className="size-5 text-ok mt-0.5" />
                  </div>
                  <div>
                    <p className="font-medium text-sm">Camera and Microphone Recording</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      Your video and audio will be recorded during this interview to help the hiring team
                      provide fair feedback. You can review the recording after the interview.
                    </p>
                  </div>
                </div>

                <div className="flex gap-3">
                  <div className="flex-shrink-0">
                    <CheckIcon className="size-5 text-ok mt-0.5" />
                  </div>
                  <div>
                    <p className="font-medium text-sm">Behavioral Analysis</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      CoreLink may analyze your responses and behavior to help ensure a fair interview
                      process. This analysis is reviewed by humans before any decisions are made.
                    </p>
                  </div>
                </div>

                <div className="flex gap-3">
                  <div className="flex-shrink-0">
                    <CheckIcon className="size-5 text-ok mt-0.5" />
                  </div>
                  <div>
                    <p className="font-medium text-sm">Data Retention</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      Your interview data will be securely stored and automatically deleted after 30 days
                      unless you request otherwise.
                    </p>
                  </div>
                </div>

                <div className="flex gap-3">
                  <div className="flex-shrink-0">
                    <CheckIcon className="size-5 text-ok mt-0.5" />
                  </div>
                  <div>
                    <p className="font-medium text-sm">Baseline Session</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      You&apos;ll complete a 45–60 second baseline session before the interview begins. This
                      helps establish your normal appearance and behavior.
                    </p>
                  </div>
                </div>
              </div>

              <div className="rounded-lg bg-muted p-4">
                <p className="text-sm text-muted-foreground">
                  By proceeding, you consent to the recording and analysis described above.
                </p>
              </div>

              <div className="flex gap-3">
                <Button variant="outline" onClick={onComplete} className="flex-1">
                  Decline & Exit
                </Button>
                {interviewData ? (
                  <Button
                    onClick={() => {
                      setStep('setup')
                    }}
                    disabled={!statusMessage.showJoinButton}
                    className="flex-1"
                  >
                    {statusMessage.showJoinButton ? (
                      <>
                        {statusMessage.message === 'Join now' ? 'Join Interview' : statusMessage.message}
                        <ChevronRightIcon className="size-4 ml-2" />
                      </>
                    ) : (
                      <>
                        {statusMessage.message}
                        <ChevronRightIcon className="size-4 ml-2 opacity-50" />
                      </>
                    )}
                  </Button>
                ) : (
                  <Button
                    onClick={() => {
                      setStep('setup')
                    }}
                    className="flex-1"
                  >
                    I Agree & Continue
                    <ChevronRightIcon className="size-4 ml-2" />
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        )

      case 'setup':
        return (
          <MediaSetup
            onReady={() => setStep('baseline')}
          />
        )

      case 'baseline':
        return (
          <BaselineCapture
            onComplete={async () => {
              await markInterviewStarted(Number(interviewId))
              setStep('interview')
            }}
            duration={45}
          />
        )

      case 'interview':
        // Check if we're still in the valid time window before allowing interview to proceed
        if (interviewData) {
          const { canJoin } = interviewService.canJoinInterview(interviewData.scheduledAt, interviewData.durationMinutes)
          if (!canJoin) {
            // Auto-complete or handle out-of-window scenario
            // For now, we'll go to complete step but this could be changed to show a message
            return (
              <Card>
                <CardHeader>
                  <CardTitle>Interview Not Available</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-base text-muted-foreground">
                    The interview window has closed. Please contact the recruiter if you believe this is in error.
                  </p>
                  <Button onClick={onComplete} className="w-full">
                    Return to Lobby
                  </Button>
                </CardContent>
              </Card>
            )
          }
        }

        return (
          <LiveInterviewRoom
            interviewId={interviewId}
            jobTitle={jobTitle}
            candidateName="You"
            onComplete={() => setStep('complete')}
          />
        )

      case 'complete':
        return (
          <Card>
            <CardHeader>
              <CardTitle>Interview Complete</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <p className="text-base text-muted-foreground">
                Thank you for completing your interview! The hiring team will review your responses and
                get back to you soon.
              </p>

              <div className="rounded-lg bg-ok/10 border border-ok p-4">
                <p className="text-sm font-medium text-ok">Interview submission successful</p>
              </div>

              <Button onClick={onComplete} className="w-full">
                Return to Lobby
              </Button>
            </CardContent>
          </Card>
        )
    }
  }

  return <div className="max-w-3xl mx-auto">{renderStep()}</div>
}
