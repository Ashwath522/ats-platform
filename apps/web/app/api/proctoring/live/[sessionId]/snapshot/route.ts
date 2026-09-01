import { getLiveSession } from '@/lib/proctoring-store'

export async function GET(_request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params
  const session = getLiveSession(sessionId)

  // ensure session exists and has snapshot before returning the binary
  if (!session || !session.snapshot) {
    return new Response('Snapshot not found', { status: 404 })
  }

  return new Response(session.snapshot, {
    headers: {
      'Content-Type': session.snapshotContentType ?? 'image/jpeg',
      'Cache-Control': 'no-store',
    },
  })
}