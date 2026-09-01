import { useEffect, useRef } from 'react'
import { FrameSampler } from './frame-sampler'

export interface RollingBufferReturn {
  getClip: (seconds: number) => Blob
  takeSnapshot: () => Promise<Blob | null>
}

export function useRollingVideoBuffer(
  videoElement: HTMLVideoElement | null,
  options: { secondsToBuffer: number } = { secondsToBuffer: 25 }
): RollingBufferReturn {
  const { secondsToBuffer } = options
  const frameSamplerRef = useRef<FrameSampler | null>(null)
  const frameBufferRef = useRef<Array<{ blob: Blob; timestamp: number }>>([])

  // Take a snapshot from the video element and return as Blob
  const takeSnapshot = async (): Promise<Blob | null> => {
    if (!videoElement) return null
    try {
      const canvas = document.createElement('canvas')
      canvas.width = videoElement.videoWidth
      canvas.height = videoElement.videoHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) return null
      ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height)
      return new Promise((resolve) => {
        canvas.toBlob((blob) => {
          resolve(blob)
        }, 'image/jpeg', 0.9)
      })
    } catch (err) {
      console.error('Failed to take snapshot', err)
      return null
    }
  }

  // Get a clip (as a Blob) of the last `seconds` seconds.
  // We return a blob of the most recent frame as a placeholder.
  const getClip = (seconds: number): Blob => {
    void seconds
    // We'll just return a blob of a single frame (the most recent) as a placeholder.
    // In a real implementation, we would encode a video from the frame buffer.
    const mostRecent = frameBufferRef.current[frameBufferRef.current.length - 1]
    if (mostRecent) {
      return mostRecent.blob
    }
    // Return an empty blob if no frames
    return new Blob()
  }

  useEffect(() => {
    if (!videoElement) return

    // Create a frame sampler that captures the current video frame every second
    const frameSampler = new FrameSampler(async (canvas) => {
      // Draw the current video frame onto the canvas
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height)

      // Convert the canvas to a blob and store it
      canvas.toBlob((blob) => {
        if (blob) {
          const now = Date.now()
          frameBufferRef.current.push({ blob, timestamp: now })
          // Remove frames older than secondsToBuffer seconds
          const cutoff = now - secondsToBuffer * 1000
          frameBufferRef.current = frameBufferRef.current.filter(
            (frame) => frame.timestamp >= cutoff
          )
        }
      }, 'image/jpeg', 0.9)
    })

    frameSampler.start(videoElement)
    frameSamplerRef.current = frameSampler

    return () => {
      if (frameSamplerRef.current) {
        frameSamplerRef.current.stop()
        frameSamplerRef.current = null
      }
      frameBufferRef.current = []
    }
  }, [videoElement, secondsToBuffer])

  return { getClip, takeSnapshot }
}
