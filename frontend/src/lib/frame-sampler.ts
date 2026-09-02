export type FrameCallback = (canvas: HTMLCanvasElement | HTMLVideoElement) => void | Promise<void>

export class FrameSampler {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D | null
  private onFrame?: FrameCallback
  private intervalId: any = null
  private fps: number

  constructor(onFrameOrFps?: FrameCallback | number, fps: number = 2) {
    this.canvas = document.createElement('canvas')
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })
    if (typeof onFrameOrFps === 'function') {
      this.onFrame = onFrameOrFps
      this.fps = fps
    } else {
      this.fps = onFrameOrFps || fps
    }
  }

  start(video: HTMLVideoElement, fps?: number): void {
    this.stop()
    const targetFps = fps || this.fps || 2
    const intervalMs = Math.round(1000 / targetFps)

    this.intervalId = setInterval(async () => {
      if (!video || video.readyState < 2) return
      this.canvas.width = video.videoWidth || 320
      this.canvas.height = video.videoHeight || 240
      if (this.ctx) {
        this.ctx.drawImage(video, 0, 0, this.canvas.width, this.canvas.height)
      }
      if (this.onFrame) {
        try {
          await this.onFrame(this.canvas)
        } catch (err) {
          console.error('Error in FrameSampler callback:', err)
        }
      }
    }, intervalMs)
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
  }

  sample(video: HTMLVideoElement, width: number = 320, height: number = 240): ImageData | null {
    if (!video || video.readyState < 2) return null
    this.canvas.width = width
    this.canvas.height = height
    if (!this.ctx) return null
    this.ctx.drawImage(video, 0, 0, width, height)
    return this.ctx.getImageData(0, 0, width, height)
  }

  sampleDataUrl(video: HTMLVideoElement, width: number = 320, height: number = 240): string | null {
    if (!video || video.readyState < 2) return null
    this.canvas.width = width
    this.canvas.height = height
    if (!this.ctx) return null
    this.ctx.drawImage(video, 0, 0, width, height)
    return this.canvas.toDataURL('image/jpeg', 0.7)
  }
}
