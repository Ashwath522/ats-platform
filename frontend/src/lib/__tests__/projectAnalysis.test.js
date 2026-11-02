import { describe, expect, it } from 'vitest'
import {
  fileExt, fmtBytes, fmtTs, histDiff, isRunning, normalizeYouTubeUrl, scoreTone, selectFrames, stageRows, validateProjectFile, youtubeAt,
} from '../projectAnalysis.js'

const MB = 1024 * 1024

describe('YouTube links', () => {
  it('normalises watch, youtu.be, shorts and live links', () => {
    for (const u of ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://youtu.be/dQw4w9WgXcQ?si=x', 'https://youtube.com/shorts/dQw4w9WgXcQ',
      'https://m.youtube.com/watch?feature=share&v=dQw4w9WgXcQ', 'https://www.youtube.com/live/dQw4w9WgXcQ']) {
      expect(normalizeYouTubeUrl(u)).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    }
  })
  it('rejects other sites and malformed ids', () => {
    expect(normalizeYouTubeUrl('https://vimeo.com/123')).toBeNull()
    expect(normalizeYouTubeUrl('https://youtu.be/short')).toBeNull()
    expect(normalizeYouTubeUrl('')).toBeNull()
  })
  it('builds timestamp links', () => {
    expect(youtubeAt('https://youtu.be/dQw4w9WgXcQ', '01:05')).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=65s')
  })
})

describe('file checks', () => {
  const exts = ['.ino', '.pdf', '.kicad_sch']
  it('handles KiCad double extensions', () => {
    expect(fileExt('Board.KICAD_SCH')).toBe('.kicad_sch')
    expect(fileExt('a.b.ino')).toBe('.ino')
  })
  it('enforces type, size, count and total limits', () => {
    expect(validateProjectFile({ name: 'x.exe', size: 10 }, exts)).toMatch(/aren't accepted/)
    expect(validateProjectFile({ name: 'x.ino', size: 0 }, exts)).toMatch(/empty/)
    expect(validateProjectFile({ name: 'x.pdf', size: 16 * MB }, exts)).toMatch(/15 MB/)
    expect(validateProjectFile({ name: 'x.ino', size: 1 }, exts, Array(10).fill({ size_bytes: 1 }))).toMatch(/at most 10/)
    expect(validateProjectFile({ name: 'x.pdf', size: 10 * MB }, exts, [{ size_bytes: 55 * MB }])).toMatch(/60 MB/)
    expect(validateProjectFile({ name: 'board.kicad_sch', size: 100 }, exts)).toBeNull()
  })
  it('formats sizes and timestamps', () => {
    expect(fmtBytes(512)).toBe('512 B')
    expect(fmtBytes(2048)).toBe('2 KB')
    expect(fmtTs(65.4)).toBe('01:05')
  })
})

describe('stages and scores', () => {
  it('always yields six ordered stage rows', () => {
    const rows = stageRows([{ name: 'analyse_video', state: 'skipped', message: 'No demo video' }])
    expect(rows.map((r) => r.name)).toEqual(['validate_files', 'extract_files', 'analyse_domain', 'analyse_video', 'verify_claims', 'build_report'])
    expect(rows[3]).toMatchObject({ state: 'skipped', message: 'No demo video', label: 'Demo video' })
    expect(rows[0].state).toBe('pending')
  })
  it('knows when a job is still running', () => {
    expect(isRunning({ status: 'queued' })).toBe(true)
    expect(isRunning({ status: 'done' })).toBe(false)
    expect(isRunning(null)).toBe(false)
  })
  it('maps scores to tones', () => {
    expect(scoreTone(null)).toBe('gray')
    expect(scoreTone(80)).toBe('green')
    expect(scoreTone(20)).toBe('red')
  })
})

describe('key frame selection', () => {
  it('keeps the first frame and the strongest scene changes', () => {
    const diffs = Array(30).fill(0.05)
    diffs[10] = 1.2; diffs[20] = 0.9
    const pick = selectFrames(diffs, 6)
    expect(pick[0]).toBe(0)
    expect(pick).toContain(10)
    expect(pick).toContain(20)
    expect(pick.length).toBe(6)
    expect([...pick].sort((a, b) => a - b)).toEqual(pick)
  })
  it('never returns more frames than samples or the budget', () => {
    expect(selectFrames([0, 0.1, 0.2], 12)).toEqual([0, 1, 2])
    expect(selectFrames(Array(200).fill(0.1), 12).length).toBe(12)
    expect(selectFrames([], 12)).toEqual([])
  })
  it('computes histogram distance', () => {
    expect(histDiff([0.5, 0.5], [1, 0])).toBe(1)
  })
})
