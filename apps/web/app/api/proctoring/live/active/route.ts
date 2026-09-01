import { NextResponse } from 'next/server'
import { getActiveLiveSessions } from '@/app/actions/core'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const sessions = await getActiveLiveSessions()
    return NextResponse.json(sessions)
  } catch (error) {
    console.error('Failed to get active live sessions:', error)
    return NextResponse.json({ error: 'Failed to get active sessions' }, { status: 500 })
  }
}
