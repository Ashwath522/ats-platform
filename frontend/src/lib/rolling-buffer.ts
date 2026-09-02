import { useRef, useCallback, useEffect } from 'react'

export function useRollingVideoBuffer(
  videoElementOrMax?: HTMLVideoElement | MediaStream | number | null,
  options?: { secondsToBuffer?: number; maxClips?: number }
) {
  const maxClips = typeof videoElementOrMax === 'number' ? videoElementOrMax : (options?.maxClips ?? 5)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const clipsRef = useRef<Blob[]>([])

  const startBuffer = useCallback((stream: MediaStream) => {
    if (typeof MediaRecorder === 'undefined') return
    try {
      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8,opus' })
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          chunksRef.current.push(e.data)
        }
      }
      recorder.start(1000)
      recorderRef.current = recorder
    } catch {
      try {
        const recorder = new MediaRecorder(stream)
        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) {
            chunksRef.current.push(e.data)
          }
        }
        recorder.start(1000)
        recorderRef.current = recorder
      } catch (err) {
        console.warn('Rolling video buffer unavailable:', err)
      }
    }
  }, [])

  const captureClip = useCallback(() => {
    if (chunksRef.current.length > 0) {
      const clip = new Blob(chunksRef.current, { type: 'video/webm' })
      clipsRef.current.push(clip)
      if (clipsRef.current.length > maxClips) {
        clipsRef.current.shift()
      }
      chunksRef.current = []
      return clip
    }
    return new Blob()
  }, [maxClips])

  const getClip = useCallback((_durationSeconds?: number): Blob => {
    return captureClip()
  }, [captureClip])

  const takeSnapshot = useCallback(async (): Promise<Blob | null> => {
    if (videoElementOrMax && typeof videoElementOrMax !== 'number' && 'tagName' in videoElementOrMax) {
      const video = videoElementOrMax as HTMLVideoElement
      if (video.readyState >= 2) {
        const canvas = document.createElement('canvas')
        canvas.width = video.videoWidth || 320
        canvas.height = video.videoHeight || 240
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
          return new Promise<Blob | null>((resolve) => {
            canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.8)
          })
        }
      }
    }
    return null
  }, [videoElementOrMax])

  const stopBuffer = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop()
    }
  }, [])

  useEffect(() => {
    return () => {
      stopBuffer()
    }
  }, [stopBuffer])

  return {
    startBuffer,
    captureClip,
    getClip,
    takeSnapshot,
    stopBuffer,
    clips: clipsRef.current,
  }
}
