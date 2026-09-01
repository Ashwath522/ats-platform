'use client'

import { useEffect, useRef, useState } from 'react'
import { FrameSampler } from '@/lib/frame-sampler'
import { useInterviewStore } from '@/lib/interview-store'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { WifiIcon, VideoIcon, MicIcon, SquareIcon, Clock } from 'lucide-react'

interface InterviewRoomProps {
  interviewId: string
  jobTitle: string
  onEnd: () => void
}

export function InterviewRoom({ interviewId, jobTitle, onEnd }: InterviewRoomProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [isRecording, setIsRecording] = useState(false)
  const [elapsedTime, setElapsedTime] = useState(0)
  const frameSamplerRef = useRef<FrameSampler | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const store = useInterviewStore()

  useEffect(() => {
    store.setInterviewId(interviewId)
    store.setStartTime(Date.now())

    const initMedia = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user' },
          audio: true,
        })
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          streamRef.current = stream
          store.setCameraReady(true)
          store.setMicReady(stream.getAudioTracks().length > 0)
        }
      } catch {
        store.setErrorMessage('Failed to access media devices')
      }
    }

    initMedia()

    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop())
      }
      frameSamplerRef.current?.stop()
    }
  }, [interviewId, store])

  useEffect(() => {
    if (!isRecording) return

    const interval = setInterval(() => {
      setElapsedTime((t) => t + 1)
    }, 1000)

    if (videoRef.current && !frameSamplerRef.current) {
      frameSamplerRef.current = new FrameSampler(() => {
        store.incrementFrameCount()
      })
      frameSamplerRef.current.start(videoRef.current)
    }

    return () => clearInterval(interval)
  }, [isRecording, store])

  const toggleRecording = async () => {
    if (!isRecording) {
      setIsRecording(true)
      store.setConnected(true)
    } else {
      setIsRecording(false)
      frameSamplerRef.current?.stop()
      store.setConnected(false)
    }
  }

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = seconds % 60
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{jobTitle}</h1>
          <p className="text-muted-foreground mt-1">Interview in progress</p>
        </div>
        <Badge variant="default" className="h-fit gap-2">
          <Clock className="size-3" />
          {formatTime(elapsedTime)}
        </Badge>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <div className="text-2xl font-bold">{store.frameCount}</div>
              <p className="text-xs text-muted-foreground">Frames</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <div className="text-2xl font-bold">{Math.round(store.networkStats.latency)}ms</div>
              <p className="text-xs text-muted-foreground">Latency</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <div className="text-2xl font-bold">{store.networkStats.packetLoss}%</div>
              <p className="text-xs text-muted-foreground">Packet Loss</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Camera Feed</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="relative w-full aspect-video rounded-lg overflow-hidden bg-black">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />
            {!store.isCameraReady && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                <VideoIcon className="size-12 text-muted opacity-50" />
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-3">
        <Button
          onClick={toggleRecording}
          size="lg"
          className="flex-1"
          variant={isRecording ? 'destructive' : 'default'}
        >
          {isRecording ? (
            <>
              <SquareIcon className="size-4 mr-2" />
              Stop Recording
            </>
          ) : (
            <>
              <VideoIcon className="size-4 mr-2" />
              Start Recording
            </>
          )}
        </Button>
        <Button onClick={onEnd} variant="outline" size="lg">
          End Interview
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4 text-sm">
        <div className="flex items-center gap-2">
          <VideoIcon className={`size-4 ${store.isCameraReady ? 'text-ok' : 'text-warn'}`} />
          <span>Camera {store.isCameraReady ? 'Active' : 'Inactive'}</span>
        </div>
        <div className="flex items-center gap-2">
          <MicIcon className={`size-4 ${store.isMicReady ? 'text-ok' : 'text-warn'}`} />
          <span>Microphone {store.isMicReady ? 'Active' : 'Inactive'}</span>
        </div>
        <div className="flex items-center gap-2">
          <WifiIcon className={`size-4 ${store.isConnected ? 'text-ok' : 'text-warn'}`} />
          <span>Connection {store.isConnected ? 'Good' : 'Disconnected'}</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {store.frameCount} frames captured
        </div>
      </div>
    </div>
  )
}
