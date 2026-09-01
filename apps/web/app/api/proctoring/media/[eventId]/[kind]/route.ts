import { NextResponse } from 'next/server'
import { proctoringStore } from '@/lib/proctoring-store'

export async function GET(
  _request: Request,
  context: { params: Promise<{ eventId: string; kind: string }> },
) {
  const { eventId: eventIdParam, kind } = await context.params
  const eventId = Number(eventIdParam)
  if (!Number.isFinite(eventId)) {
    return NextResponse.json({ error: 'Invalid event id' }, { status: 400 })
  }

  const media = proctoringStore.media.get(eventId)
  if (!media) {
    return NextResponse.json({ error: 'Media not found' }, { status: 404 })
  }

  if (kind === 'snapshot' && media.snapshot) {
    return new NextResponse(media.snapshot, {
      headers: {
        'Content-Type': media.snapshotContentType ?? 'image/jpeg',
        'Cache-Control': 'private, max-age=3600',
      },
    })
  }

  if (kind === 'clip' && media.clip) {
    return new NextResponse(media.clip, {
      headers: {
        'Content-Type': media.clipContentType ?? 'video/webm',
        'Cache-Control': 'private, max-age=3600',
      },
    })
  }

  return NextResponse.json({ error: 'Media not found' }, { status: 404 })
}
