import { useState } from 'react'

export interface InterviewStoreState {
  interviewId: string | null
  startTime: number | null
  cameraReady: boolean
  isCameraReady: boolean
  micReady: boolean
  isMicReady: boolean
  connected: boolean
  isConnected: boolean
  frameCount: number
  networkStats: { latency: number; jitter: number; packetLoss: number }
  errorMessage: string | null
  setInterviewId: (id: string) => void
  setStartTime: (time: number) => void
  setCameraReady: (ready: boolean) => void
  setMicReady: (ready: boolean) => void
  setConnected: (connected: boolean) => void
  incrementFrameCount: () => void
  setErrorMessage: (msg: string | null) => void
}

export function useInterviewStore(): InterviewStoreState {
  const [interviewId, setInterviewId] = useState<string | null>(null)
  const [startTime, setStartTime] = useState<number | null>(null)
  const [cameraReady, setCameraReady] = useState(false)
  const [micReady, setMicReady] = useState(false)
  const [connected, setConnected] = useState(false)
  const [frameCount, setFrameCount] = useState(0)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  return {
    interviewId,
    startTime,
    cameraReady,
    isCameraReady: cameraReady,
    micReady,
    isMicReady: micReady,
    connected,
    isConnected: connected,
    frameCount,
    networkStats: { latency: 32, jitter: 4, packetLoss: 0 },
    errorMessage,
    setInterviewId,
    setStartTime,
    setCameraReady,
    setMicReady,
    setConnected,
    incrementFrameCount: () => setFrameCount((c) => c + 1),
    setErrorMessage,
  }
}
