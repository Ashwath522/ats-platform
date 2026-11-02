import { get, set } from 'idb-keyval'

const key = (sessionId) => `proctor-queue:${sessionId}`
const snapshotKey = (sessionId) => `proctor-snapshots:${sessionId}`
const memory = new Map()

async function read(k) {
  try { return await get(k) } catch { return memory.get(k) }
}
async function write(k, value) {
  try { await set(k, value) } catch { memory.set(k, value) }
}
const id = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`

export async function loadProctorQueue(sessionId) {
  const value = await read(key(sessionId))
  return Array.isArray(value) ? value : []
}

export async function saveProctorQueue(sessionId, items) {
  await write(key(sessionId), items.slice(-600))
}

export async function loadSnapshotQueue(sessionId) {
  const value = await read(snapshotKey(sessionId))
  return Array.isArray(value) ? value : []
}

export async function saveSnapshotQueue(sessionId, items) {
  await write(snapshotKey(sessionId), items)
}

export function makeQueuedEvent(event) {
  return { ...event, client_event_id: event.client_event_id || id(), upload_status: 'PENDING', attempts: 0, next_retry_at: 0 }
}

export { id as makeClientEventId }
