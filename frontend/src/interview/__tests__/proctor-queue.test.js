import { beforeEach, describe, expect, it, vi } from 'vitest'

// In-memory IndexedDB stand-in whose failures we can switch on.
const store = new Map()
const fail = { get: null, set: null }
vi.mock('idb-keyval', () => ({
  get: vi.fn(async (k) => { if (fail.get) throw fail.get; return structuredClone(store.get(k)) }),
  set: vi.fn(async (k, v) => { if (fail.set) throw fail.set; store.set(k, structuredClone(v)) }),
}))

const Q = await import('../proctor-queue.js')
const { Proctor } = await import('../proctor.js')

const ev = (id, extra = {}) => ({ client_event_id: id, type: 'tab_switched', severity: 'medium', ts: new Date(0).toISOString(), ...extra })
const quota = Object.assign(new Error('The quota has been exceeded.'), { name: 'QuotaExceededError' })

beforeEach(() => { store.clear(); fail.get = null; fail.set = null; Q._resetQueueHealthForTests() })

describe('durable queue recovery', () => {
  it('survives a refresh and un-sticks events that were waiting for a snapshot', async () => {
    await Q.saveProctorQueue(9, [Q.makeQueuedEvent(ev('a')), { ...Q.makeQueuedEvent(ev('b')), waiting: true }])
    const loaded = await Q.loadProctorQueue(9)                     // "after refresh"
    expect(loaded.map((e) => e.client_event_id)).toEqual(['a', 'b'])
    expect(loaded.every((e) => e.waiting === false && e.upload_status === 'PENDING')).toBe(true)
  })

  it('drops corrupted records (and counts them) instead of retrying them forever', async () => {
    store.set('proctor-queue:9', [ev('ok'), null, 'garbage', { type: 'tab_switched' }, ev('bad id!'), { client_event_id: 'x', type: 'BAD TYPE' }])
    store.set('proctor-snapshots:9', [{ client_event_id: 's1', event_type: 'tab_switched' }])   // blob lost
    expect((await Q.loadProctorQueue(9)).map((e) => e.client_event_id)).toEqual(['ok'])
    expect(await Q.loadSnapshotQueue(9)).toEqual([])
    expect(Q.queueHealth().corruptDropped).toBe(6)
    store.set('proctor-queue:10', { not: 'an array' })
    expect(await Q.loadProctorQueue(10)).toEqual([])
  })

  it('keeps evidence in memory and reports it when storage is full', async () => {
    fail.set = quota
    await Q.saveProctorQueue(9, [Q.makeQueuedEvent(ev('a'))])
    expect((await Q.loadProctorQueue(9)).map((e) => e.client_event_id)).toEqual(['a'])
    const h = Q.queueHealth()
    expect(h.mode).toBe('memory')
    expect(h.quotaErrors).toBe(1)
    fail.set = null
    await Q.saveProctorQueue(9, [Q.makeQueuedEvent(ev('a')), Q.makeQueuedEvent(ev('b'))])   // storage recovers
    expect((await Q.loadProctorQueue(9)).length).toBe(2)
  })

  it('reports read failures instead of throwing', async () => {
    fail.get = new Error('IDB blocked')
    expect(await Q.loadProctorQueue(9)).toEqual([])
    expect(Q.queueHealth().readErrors).toBe(1)
  })
})

describe('per-record acknowledgements', () => {
  const delay = (n) => n * 1000
  it('removes only persisted/duplicate; invalid stays FAILED; failed and missing are retried', () => {
    const q = ['p', 'd', 'i', 'f', 'm', 'unsent'].map((id) => Q.makeQueuedEvent(ev(id)))
    const sent = q.slice(0, 5)
    const out = Q.applyEventResults(q, sent, { results: [
      { client_event_id: 'p', status: 'persisted' }, { client_event_id: 'd', status: 'duplicate' },
      { client_event_id: 'i', status: 'invalid', reason: 'invalid_event' }, { client_event_id: 'f', status: 'failed', reason: 'storage_error' },
    ] }, 100, delay, 8)
    const by = Object.fromEntries(out.map((e) => [e.client_event_id, e]))
    expect(Object.keys(by).sort()).toEqual(['f', 'i', 'm', 'unsent'])
    expect(by.i.upload_status).toBe('FAILED')
    expect(by.f).toMatchObject({ upload_status: 'PENDING', attempts: 1, next_retry_at: 1100, error: 'storage_error' })
    expect(by.m).toMatchObject({ upload_status: 'PENDING', error: 'not_acknowledged' })   // server never mentioned it
    expect(by.unsent.attempts).toBe(0)
  })

  it('understands the older acknowledged/rejected response shape', () => {
    const q = ['a', 'b'].map((id) => Q.makeQueuedEvent(ev(id)))
    const out = Q.applyEventResults(q, q, { acknowledged: ['a'], rejected: [{ client_event_id: 'b', reason: 'invalid_event' }] }, 0, () => 0, 8)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ client_event_id: 'b', upload_status: 'FAILED' })
  })
})

describe('Proctor sync through outages, refreshes and finalization', () => {
  function server({ offline = () => false, failIds = new Set() } = {}) {
    const rows = new Map()
    const api = vi.fn(async (url, req) => {
      if (offline()) throw new TypeError('Failed to fetch')
      const events = JSON.parse(req.body).events
      const results = events.map((e) => {
        if (failIds.has(e.client_event_id)) return { client_event_id: e.client_event_id, status: 'failed', reason: 'storage_error' }
        const dup = rows.has(e.client_event_id)
        rows.set(e.client_event_id, e)
        return { client_event_id: e.client_event_id, status: dup ? 'duplicate' : 'persisted' }
      })
      return { ok: true, status: 200, json: async () => ({ results }) }
    })
    return { api, rows }
  }

  const make = (api, sessionId = 5) => new Proctor({ getVideo: () => null, sessionId, api, tier: 'desktop', now: () => 0 })

  it('evidence queued while offline is delivered after reconnecting, exactly once', async () => {
    let off = true
    const srv = server({ offline: () => off })
    const p = make(srv.api)
    p.queue = [Q.makeQueuedEvent(ev('o1')), Q.makeQueuedEvent(ev('o2'))]
    await p._flush()
    expect(p.queue.map((e) => e.attempts)).toEqual([1, 1])          // kept, backoff scheduled
    off = false
    const sync = await p.finalize(3000)
    expect(sync.state).toBe('synced')
    expect([...srv.rows.keys()].sort()).toEqual(['o1', 'o2'])
    expect(p.summary().sync.state).toBe('synced')
  })

  it('a page refresh resumes the stored queue', async () => {
    await Q.saveProctorQueue(6, [Q.makeQueuedEvent(ev('r1')), { ...Q.makeQueuedEvent(ev('r2')), waiting: true }])
    const srv = server()
    const p = make(srv.api, 6)
    p.queue = await Q.loadProctorQueue(6)
    await p.finalize(3000)
    expect([...srv.rows.keys()].sort()).toEqual(['r1', 'r2'])
    expect(await Q.loadProctorQueue(6)).toEqual([])                 // cleaned only after acknowledgement
  })

  it('finalize never discards unacknowledged evidence', async () => {
    const srv = server({ failIds: new Set(['keep']) })
    const p = make(srv.api, 7)
    p.queue = [Q.makeQueuedEvent(ev('ok')), Q.makeQueuedEvent(ev('keep'))]
    const sync = await p.finalize(2500)
    expect(sync.state).toBe('partial')
    expect(sync.pending_events + sync.failed_events).toBe(1)
    expect((await Q.loadProctorQueue(7)).map((e) => e.client_event_id)).toEqual(['keep'])
    expect(p.summary().proctoring_status).toBe('completed_with_sync_issues')
  })
})
