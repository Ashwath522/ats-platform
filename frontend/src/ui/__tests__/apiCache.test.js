import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FRESH_MS, MAX_STALE_MS, _resetForTests, cachedGet, collectKeys, invalidateAll, peek, subscribe,
} from '../apiCache.js'

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('apiCache (stale-while-revalidate GET cache)', () => {
  beforeEach(() => { _resetForTests(); vi.useFakeTimers({ toFake: ['Date'] }) })
  afterEach(() => { vi.useRealTimers() })

  it('dedupes concurrent requests for the same key', async () => {
    const fetcher = vi.fn(async () => ({ n: 1 }))
    const [a, b] = await Promise.all([cachedGet('k', fetcher), cachedGet('k', fetcher)])
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(a).toEqual({ n: 1 })
    expect(b).toEqual({ n: 1 })
    expect(a).not.toBe(b) // each consumer gets its own copy
  })

  it('serves fresh data from memory without a request', async () => {
    const fetcher = vi.fn(async () => ({ n: 1 }))
    await cachedGet('k', fetcher)
    vi.setSystemTime(Date.now() + FRESH_MS - 1)
    await cachedGet('k', fetcher)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('returns stale data immediately and revalidates in the background', async () => {
    let n = 1
    const fetcher = vi.fn(async () => ({ n }))
    await cachedGet('k', fetcher)
    n = 2
    vi.setSystemTime(Date.now() + FRESH_MS + 1)
    const onNew = vi.fn()
    subscribe('k', onNew)
    const stale = await cachedGet('k', fetcher)
    expect(stale).toEqual({ n: 1 })
    await flush()
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(onNew).toHaveBeenCalledTimes(1)
    expect(peek('k').data).toEqual({ n: 2 })
  })

  it('refetches when data is older than the stale window', async () => {
    const fetcher = vi.fn(async () => ({ n: 1 }))
    await cachedGet('k', fetcher)
    vi.setSystemTime(Date.now() + MAX_STALE_MS + 1)
    expect(peek('k')).toBeUndefined()
    await cachedGet('k', fetcher)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('writes invalidate everything, and an in-flight read started before the write is not cached', async () => {
    let resolve
    const slow = () => new Promise((r) => { resolve = r })
    const p = cachedGet('k', slow)
    invalidateAll() // e.g. POST /apply happened meanwhile
    await flush()
    resolve({ old: true })
    expect(await p).toEqual({ old: true })
    expect(peek('k')).toBeUndefined()
    const fetcher = vi.fn(async () => ({ fresh: true }))
    expect(await cachedGet('k', fetcher)).toEqual({ fresh: true })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('force bypasses the cache (reload button)', async () => {
    const fetcher = vi.fn(async () => ({ n: 1 }))
    await cachedGet('k', fetcher)
    await cachedGet('k', fetcher, { force: true })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('failed requests are not cached', async () => {
    const bad = vi.fn(async () => { throw new Error('boom') })
    await expect(cachedGet('k', bad)).rejects.toThrow('boom')
    const good = vi.fn(async () => ({ ok: 1 }))
    expect(await cachedGet('k', good)).toEqual({ ok: 1 })
  })

  it('mutating a returned object does not corrupt the cache', async () => {
    const data = await cachedGet('k', async () => ({ items: [1, 2] }))
    data.items.push(3)
    expect((await cachedGet('k', async () => ({}))).items).toEqual([1, 2])
  })

  it('collectKeys records the keys a query reads and honours force', async () => {
    const fetcher = vi.fn(async () => 1)
    await cachedGet('a', fetcher)
    const { keys, result } = collectKeys(() => Promise.all([cachedGet('a', fetcher), cachedGet('b', fetcher)]), { force: true })
    await result
    expect(keys.sort()).toEqual(['a', 'b'])
    expect(fetcher).toHaveBeenCalledTimes(3) // 'a' forced again + 'b'
  })
})
