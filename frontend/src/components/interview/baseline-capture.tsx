'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { AlertCircle, Clock, CheckCircle } from 'lucide-react'

export default function BaselineCapture({
  onComplete,
  duration = 45,
}: {
  onComplete: () => void
  duration?: number
}) {
  const [remainingSeconds, setRemainingSeconds] = useState(duration)
  const [isCapturing, setIsCapturing] = useState(false)

  useEffect(() => {
    if (!isCapturing || remainingSeconds <= 0) return

    const timer = setInterval(() => {
      setRemainingSeconds((prev) => prev - 1)
    }, 1000)

    return () => clearInterval(timer)
  }, [isCapturing, remainingSeconds])

  useEffect(() => {
    if (remainingSeconds === 0) {
      setIsCapturing(false)
      onComplete()
    }
  }, [remainingSeconds, onComplete])

  const startCapture = () => {
    setIsCapturing(true)
  }

  const percentComplete = ((duration - remainingSeconds) / duration) * 100

  return (
    <Card>
      <CardHeader>
        <CardTitle>Baseline Capture</CardTitle>
        <CardDescription>
          We&apos;ll capture your baseline behavior for comparison during the interview
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Instructions */}
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
          <div className="flex gap-2">
            <AlertCircle className="size-4 flex-shrink-0 text-blue-700 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-blue-900">What to expect:</p>
              <ul className="mt-2 space-y-1 text-sm text-blue-800">
                <li>• Look directly at the camera</li>
                <li>• Speak naturally about your background</li>
                <li>• This helps us understand your baseline behavior</li>
                <li>• We&apos;ll capture video and behavioral signals</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Baseline Capture Area */}
        <div>
          <p className="text-sm font-medium mb-3">Baseline Video</p>
          <div className="relative aspect-video w-full overflow-hidden rounded-lg border-2 border-border bg-black">
            {isCapturing ? (
              <div className="flex h-full items-center justify-center bg-gradient-to-br from-indigo-500 to-purple-600">
                <div className="text-center">
                  <div className="mb-4 size-16 mx-auto rounded-full border-2 border-white border-t-transparent animate-spin" />
                  <p className="text-white font-medium">Capturing baseline...</p>
                </div>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center bg-neutral-900">
                <div className="text-center">
                  <div className="mb-2 text-4xl">📹</div>
                  <p className="text-muted-foreground text-sm">Camera ready</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Progress */}
        {isCapturing && (
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>Progress</span>
              <span className="font-medium">{remainingSeconds}s remaining</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-border">
              <div
                className="h-full bg-blue-500 transition-all duration-1000"
                style={{ width: `${percentComplete}%` }}
              />
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3">
          {!isCapturing ? (
            <>
              <Button onClick={startCapture} className="w-full">
                <Clock className="mr-2 size-4" />
                Start Baseline ({duration}s)
              </Button>
            </>
          ) : (
            <div className="w-full flex items-center justify-center rounded-lg border-2 border-green-500 bg-green-50 py-4">
              <div className="flex items-center gap-2 text-green-700">
                <CheckCircle className="size-5" />
                <span className="font-medium">Baseline in progress</span>
              </div>
            </div>
          )}
        </div>

        {/* Privacy Note */}
        <p className="text-xs text-muted-foreground text-center">
          Your baseline data is used only for this interview comparison and is deleted after 30 days.
        </p>
      </CardContent>
    </Card>
  )
}
