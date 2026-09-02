export class FrameSampler {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D | null

  constructor() {
    this.canvas = document.createElement('canvas')
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })
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
