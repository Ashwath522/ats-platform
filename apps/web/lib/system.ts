// Step 1 status shell contract. Mirrors the FastAPI /api/health and /api/ready
// responses. The web app never exposes candidate scores or risk — this surface
// is infrastructure status only.

export type ServiceHealth = {
  status: 'ok'
  service: string
  version: string
  timestamp: string
}

export type ReadinessDependency = 'configured'

export type ReadinessResponse = {
  status: 'ready'
  dependencies: Record<string, ReadinessDependency>
}

export async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) {
    throw new Error(`Request to ${url} failed with ${res.status}`)
  }
  return (await res.json()) as T
}

// Static description of the build sequence so the status page can communicate
// where the platform is in its rollout without implying future-step behavior
// is live.
export type BuildStep = {
  id: number
  title: string
  state: 'done' | 'active' | 'planned'
}

export const buildSteps: BuildStep[] = [
  { id: 1, title: 'Project skeleton & infrastructure', state: 'active' },
  { id: 2, title: 'Auth & roles', state: 'planned' },
  { id: 3, title: 'WebRTC & 1 fps sampler', state: 'planned' },
  { id: 4, title: 'Consent flow', state: 'planned' },
  { id: 5, title: 'Liveness & room scan', state: 'planned' },
  { id: 6, title: 'Continuous object detection', state: 'planned' },
  { id: 7, title: 'Face, gaze & baseline', state: 'planned' },
  { id: 8, title: 'Body pose & lighting', state: 'planned' },
  { id: 9, title: 'Audio analysis', state: 'planned' },
  { id: 10, title: 'Risk engine & timeline', state: 'planned' },
]

export const principles: string[] = [
  'Proctoring produces a risk score and evidence — never a cheating verdict.',
  'Every final hire or reject decision is made by a human.',
  'No continuous raw video or audio is stored; evidence is clips and snapshots under 40 MB, deleted after 30 days.',
  'A 45–60 second personal baseline is mandatory before any risk is calculated.',
  'Fairness first: no penalty for glasses, fidgeting, disability, skin tone, or lighting.',
  'Candidates never see scores or risk.',
]
