'use client'

import { useEffect, useRef, useState } from 'react'
import { requestMediaPermissions } from '@/lib/media'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { CheckIcon, AlertCircleIcon, CameraIcon } from 'lucide-react'

export function MediaSetup({ onReady }: { onReady: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [cameraReady, setCameraReady] = useState(false)
  const [micReady, setMicReady] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const [checking, setChecking] = useState(false)

  const checkPermissions = async () => {
    setChecking(true)
    setErrors([])

    const { camera, microphone, errors: permErrors } = await requestMediaPermissions()
    setCameraReady(camera)
    setMicReady(microphone)
    setErrors(permErrors)

    if (camera && videoRef.current) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user' },
          audio: false,
        })
        videoRef.current.srcObject = stream
      } catch {
        setErrors((prev) => [...prev, 'Failed to access camera stream'])
      }
    }

    setChecking(false)
  }

  useEffect(() => {
    checkPermissions()

    return () => {
      if (videoRef.current?.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream
        stream.getTracks().forEach((t) => t.stop())
      }
    }
  }, [])

  const isReady = cameraReady && micReady && errors.length === 0

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Camera & Microphone Setup</CardTitle>
          <CardDescription>Let&apos;s ensure your equipment is working correctly</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="relative w-full aspect-video rounded-lg overflow-hidden bg-black">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />
            {!cameraReady && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                <div className="text-center text-white">
                  <CameraIcon className="size-12 mx-auto mb-2 opacity-50" />
                  <p>Camera not available</p>
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Card className={cameraReady ? 'border-ok bg-ok/5' : 'border-warn'}>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  {cameraReady ? (
                    <CheckIcon className="size-5 text-ok" />
                  ) : (
                    <AlertCircleIcon className="size-5 text-warn" />
                  )}
                  <div>
                    <p className="text-sm font-medium">Camera</p>
                    <p className="text-xs text-muted-foreground">{cameraReady ? 'Ready' : 'Not Ready'}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className={micReady ? 'border-ok bg-ok/5' : 'border-warn'}>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  {micReady ? (
                    <CheckIcon className="size-5 text-ok" />
                  ) : (
                    <AlertCircleIcon className="size-5 text-warn" />
                  )}
                  <div>
                    <p className="text-sm font-medium">Microphone</p>
                    <p className="text-xs text-muted-foreground">{micReady ? 'Ready' : 'Not Ready'}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {errors.length > 0 && (
            <div className="rounded-lg bg-warn/10 border border-warn p-4">
              <p className="text-sm font-medium text-warn mb-2">Setup Issues</p>
              <ul className="space-y-1">
                {errors.map((error, i) => (
                  <li key={i} className="text-sm text-warn">
                    • {error}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex gap-3">
            <Button
              onClick={checkPermissions}
              variant="outline"
              disabled={checking}
              className="flex-1"
            >
              {checking ? 'Checking...' : 'Recheck'}
            </Button>
            <Button
              onClick={onReady}
              disabled={!isReady}
              className="flex-1"
            >
              {isReady ? 'Continue' : 'Fix Issues First'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
