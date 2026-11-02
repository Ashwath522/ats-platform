import { describe, expect, it } from 'vitest'
import { normalizeYouTubeUrl, validateProjectFile, stageState } from '../projectAnalysis.js'

describe('project analysis helpers', () => {
  it('normalizes supported YouTube URLs', () => {
    expect(normalizeYouTubeUrl('https://youtu.be/abc123_X')).toBe('https://www.youtube.com/watch?v=abc123_X')
    expect(normalizeYouTubeUrl('https://www.youtube.com/shorts/abc123')).toContain('abc123')
    expect(normalizeYouTubeUrl('https://example.com/video')).toBeNull()
  })
  it('checks project file limits', () => {
    expect(validateProjectFile({ name: 'x.py', size: 4 }, ['.py'], [])).toBeNull()
    expect(validateProjectFile({ name: 'x.exe', size: 4 }, ['.py'], [])).toMatch(/not allowed/i)
  })
  it('maps missing stages to pending', () => { expect(stageState('validate_files', [])).toBe('pending'); expect(stageState('build_report', [{ name: 'build_report', state: 'skipped' }])).toBe('skipped') })
})
