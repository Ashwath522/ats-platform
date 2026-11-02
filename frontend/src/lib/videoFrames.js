/**
 * Pick key frames from a local demo video entirely in the browser.
 * The video never leaves the device: we sample it, find scene changes with a
 * small grayscale histogram, and return ≤12 JPEG frames (≤190 KB each).
 */
import { fmtTs, histDiff, selectFrames } from './projectAnalysis.js'

export const MAX_VIDEO_SECONDS = 10 * 60
export const MAX_VIDEO_BYTES = 1024 * 1024 * 1024
const SAMPLES_MAX = 90
const BINS = 16

function seek(video, t) {
  return new Promise((resolve, reject) => {
    const done = () => { video.removeEventListener('seeked', done); resolve() }
    video.addEventListener('seeked', done)
    video.addEventListener('error', () => reject(new Error('This video format can’t be read by your browser — try MP4 (H.264).')), { once: true })
    video.currentTime = Math.min(t, Math.max(0, video.duration - 0.05))
  })
}

function histogram(ctx, w, h) {
  const { data } = ctx.getImageData(0, 0, w, h)
  const hist = new Array(BINS).fill(0)
  for (let i = 0; i < data.length; i += 4) {
    const y = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
    hist[Math.min(BINS - 1, Math.floor(y / (256 / BINS)))]++
  }
  const total = w * h
  return hist.map((v) => v / total)
}

async function toJpeg(canvas) {
  for (const q of [0.72, 0.6, 0.5, 0.4]) {
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', q))
    if (blob && blob.size <= 190 * 1024) return blob
  }
  return null
}

export async function extractKeyframes(file, { max = 12, onProgress } = {}) {
  if (file.size > MAX_VIDEO_BYTES) throw new Error('Video is larger than 1 GB — use a YouTube link instead.')
  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  video.src = url
  try {
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve
      video.onerror = () => reject(new Error('This video format can’t be read by your browser — try MP4 (H.264).'))
    })
    const duration = video.duration
    if (!isFinite(duration) || duration <= 0) throw new Error('Could not read the video length.')
    if (duration > MAX_VIDEO_SECONDS) throw new Error('Video is longer than 10 minutes — use a YouTube link instead.')
    const n = Math.min(SAMPLES_MAX, Math.max(2, Math.floor(duration)))
    const times = Array.from({ length: n }, (_, i) => (i * duration) / n)
    const small = document.createElement('canvas')
    small.width = 64; small.height = 36
    const sctx = small.getContext('2d', { willReadFrequently: true })
    const diffs = []
    let prev = null
    for (let i = 0; i < n; i++) {
      await seek(video, times[i])
      sctx.drawImage(video, 0, 0, 64, 36)
      const h = histogram(sctx, 64, 36)
      diffs.push(prev ? histDiff(prev, h) : 0)
      prev = h
      onProgress && onProgress(Math.round((i / n) * 80), 'Finding key moments')
    }
    const pick = selectFrames(diffs, max)
    const big = document.createElement('canvas')
    const scale = Math.min(1, 768 / Math.max(video.videoWidth, video.videoHeight))
    big.width = Math.round(video.videoWidth * scale); big.height = Math.round(video.videoHeight * scale)
    const bctx = big.getContext('2d')
    const frames = []
    for (let k = 0; k < pick.length; k++) {
      await seek(video, times[pick[k]])
      bctx.drawImage(video, 0, 0, big.width, big.height)
      const blob = await toJpeg(big)
      if (blob) frames.push({ timestamp: fmtTs(times[pick[k]]), blob })
      onProgress && onProgress(80 + Math.round(((k + 1) / pick.length) * 20), 'Saving key frames')
    }
    return { duration, frames }
  } finally {
    URL.revokeObjectURL(url)
    video.removeAttribute('src')
  }
}
