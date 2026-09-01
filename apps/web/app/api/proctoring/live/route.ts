import { NextResponse } from 'next/server'
import { listLiveSessions, serializeLiveSession } from '@/lib/proctoring-store'

export async function GET() {
  return NextResponse.json(listLiveSessions().map(serializeLiveSession))
}