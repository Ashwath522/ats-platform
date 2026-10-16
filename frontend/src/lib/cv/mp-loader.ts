/**
 * Shared, lazy MediaPipe Tasks Vision loader: the ESM bundle + WASM fileset
 * are fetched once and reused by every detector, and each task is created
 * with the GPU delegate first, falling back to CPU (headless browsers, older
 * phones and some Android WebViews have no usable WebGL2).
 */
const MP_VERSION = '0.10.8'
const MP_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`

type Vision = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

let visionPromise: Promise<{ vision: Vision; fileset: unknown }> | null = null

export function loadVision(): Promise<{ vision: Vision; fileset: unknown }> {
  if (!visionPromise) {
    visionPromise = (async () => {
      const vision = await import(/* @vite-ignore */ `${MP_BASE}/+esm`)
      const fileset = await vision.FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`)
      return { vision, fileset }
    })()
    visionPromise.catch(() => { visionPromise = null }) // allow a later retry
  }
  return visionPromise
}

/** Create a MediaPipe task (e.g. 'FaceDetector') trying GPU then CPU. */
export async function createTask<T>(taskName: string, options: Record<string, any>): Promise<T> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const { vision, fileset } = await loadVision()
  const Task = vision[taskName]
  if (!Task) throw new Error(`MediaPipe task ${taskName} unavailable`)
  let lastErr: unknown = null
  for (const delegate of ['GPU', 'CPU']) {
    try {
      return await Task.createFromOptions(fileset, {
        ...options,
        baseOptions: { ...(options.baseOptions || {}), delegate },
      })
    } catch (err) {
      lastErr = err
    }
  }
  throw lastErr
}
