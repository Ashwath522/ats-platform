import { describe, expect, it } from 'vitest'
import { extractorFor } from '../extractors/index.js'
import { zipGuard } from '../extractors/zip.js'
import { clientStatusPayload, uploadEvidenceWithRetry } from '../engine.js'

describe('browser extractor registry', () => {
  it('routes text and lazily routes PDF/ZIP', async () => {
    expect(await extractorFor('.py')).toBeTypeOf('function')
    expect(await extractorFor('.pdf')).toBeTypeOf('function')
    expect(await extractorFor('.zip')).toBeTypeOf('function')
    expect(await extractorFor('.exe')).toBeNull()
  })
  it('guards oversized and highly compressed archives', () => {
    expect(zipGuard([['x.txt', new Uint8Array(201 * 1024 * 1024), 1]])).toMatch(/unsafe/i)
    expect(zipGuard([['x.txt', new Uint8Array(101), 1]])).toMatch(/unsafe/i)
  })
  it('retries evidence uploads and builds bounded client status', async () => {
    let tries = 0
    const result = await uploadEvidenceWithRetry({ payload: { id: 1 }, upload: async () => { tries += 1; if (tries < 3) throw Error('offline'); return 'ok' }, delay: 0 })
    expect(result).toBe('ok'); expect(tries).toBe(3)
    expect(clientStatusPayload(120, 'x.py')).toEqual({ percentage: 100, current_file: 'x.py' })
  })
})
