import { NextResponse } from 'next/server'
import { attachMediaToEvent, proctoringStore } from '@/lib/proctoring-store'

export async function POST(request: Request) {
  const formData = await request.formData()
  const eventId = Number(formData.get('event_id') ?? '')
  const sessionId = String(formData.get('session_id') ?? '')

  if (!Number.isFinite(eventId) || !sessionId) {
    return NextResponse.json({ error: 'event_id and session_id required' }, { status: 400 })
  }

  const snapshot = formData.get('snapshot')
  const clip = formData.get('clip')
  const media: {
    snapshot?: Uint8Array
    clip?: Uint8Array
    snapshotContentType?: string
    clipContentType?: string
  } = {}

  if (snapshot instanceof File && snapshot.size > 0) {
    media.snapshot = new Uint8Array(await snapshot.arrayBuffer())
    media.snapshotContentType = snapshot.type || 'image/jpeg'
  }
  if (clip instanceof File && clip.size > 0) {
    media.clip = new Uint8Array(await clip.arrayBuffer())
    media.clipContentType = clip.type || 'video/webm'
  }

  proctoringStore.media.set(eventId, media)

  const snapshot_url = media.snapshot ? `/api/proctoring/media/${eventId}/snapshot` : undefined
  const clip_url = media.clip ? `/api/proctoring/media/${eventId}/clip` : undefined
  attachMediaToEvent(sessionId, eventId, { snapshot_url, clip_url })

  return NextResponse.json({
    ok: true,
    event_id: eventId,
    snapshot_url,
    clip_url,
  })
}
