import { create } from 'zustand'

export interface NetworkStats {
  latency: number
  jitter: number
  packetLoss: number
  bandwidth: number
  lastUpdated: number
}

export interface InterviewRoomState {
  interviewId: string | null
  isConnected: boolean
  isCameraReady: boolean
  isMicReady: boolean
  networkStats: NetworkStats
  frameCount: number
  evidenceCount: number
  startTime: number | null
  errorMessage: string | null

  setInterviewId: (id: string) => void
  setConnected: (connected: boolean) => void
  setCameraReady: (ready: boolean) => void
  setMicReady: (ready: boolean) => void
  updateNetworkStats: (stats: Partial<NetworkStats>) => void
  incrementFrameCount: () => void
  incrementEvidenceCount: () => void
  setStartTime: (time: number | null) => void
  setErrorMessage: (error: string | null) => void
  reset: () => void
}

const initialNetworkStats: NetworkStats = {
  latency: 0,
  jitter: 0,
  packetLoss: 0,
  bandwidth: 0,
  lastUpdated: 0,
}

export const useInterviewStore = create<InterviewRoomState>((set) => ({
  interviewId: null,
  isConnected: false,
  isCameraReady: false,
  isMicReady: false,
  networkStats: initialNetworkStats,
  frameCount: 0,
  evidenceCount: 0,
  startTime: null,
  errorMessage: null,

  setInterviewId: (id) => set({ interviewId: id }),
  setConnected: (connected) => set({ isConnected: connected }),
  setCameraReady: (ready) => set({ isCameraReady: ready }),
  setMicReady: (ready) => set({ isMicReady: ready }),
  updateNetworkStats: (stats) =>
    set((state) => ({
      networkStats: { ...state.networkStats, ...stats, lastUpdated: Date.now() },
    })),
  incrementFrameCount: () => set((state) => ({ frameCount: state.frameCount + 1 })),
  incrementEvidenceCount: () => set((state) => ({ evidenceCount: state.evidenceCount + 1 })),
  setStartTime: (time) => set({ startTime: time }),
  setErrorMessage: (error) => set({ errorMessage: error }),
  reset: () =>
    set({
      interviewId: null,
      isConnected: false,
      isCameraReady: false,
      isMicReady: false,
      networkStats: initialNetworkStats,
      frameCount: 0,
      evidenceCount: 0,
      startTime: null,
      errorMessage: null,
    }),
}))
