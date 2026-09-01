export class FrameSampler {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private lastFrameTime = 0
  private frameInterval = 1000 / 1
  private isRunning = false

  constructor(private onFrame: (canvas: HTMLCanvasElement) => void) {
    this.canvas = document.createElement('canvas')
    this.canvas.width = 640
    this.canvas.height = 480
    const ctx = this.canvas.getContext('2d')
    if (!ctx) throw new Error('Failed to get canvas context')
    this.ctx = ctx
  }

  start(videoElement: HTMLVideoElement): void {
    if (this.isRunning) return
    this.isRunning = true
    this.sample(videoElement)
  }

  stop(): void {
    this.isRunning = false
  }

  private sample(videoElement: HTMLVideoElement): void {
    const now = performance.now()

    if (now - this.lastFrameTime >= this.frameInterval) {
      this.ctx.drawImage(videoElement, 0, 0, this.canvas.width, this.canvas.height)
      this.lastFrameTime = now
      this.onFrame(this.canvas)
    }

    if (this.isRunning) {
      requestAnimationFrame(() => this.sample(videoElement))
    }
  }

  getBase64(): string {
    return this.canvas.toDataURL('image/jpeg', 0.7)
  }

  getBlob(): Promise<Blob | null> {
    return new Promise((resolve) => {
      this.canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.7)
    })
  }
}
