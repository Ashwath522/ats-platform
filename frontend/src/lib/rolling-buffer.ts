import { useRef, useCallback, useEffect } from 'react'

export function useRollingVideoBuffer(maxClips: number = 5) {
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
      // Fallback without codecs if mimeType unsupported
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
    return null
  }, [maxClips])

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

  return { startBuffer, captureClip, stopBuffer, clips: clipsRef.current }
}
