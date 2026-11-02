export const STAGES = ['validate_files', 'extract_files', 'analyse_domain', 'analyse_video', 'verify_claims', 'build_report']
export function normalizeYouTubeUrl(value) {
  const m = String(value || '').trim().match(/^https:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtube\.com\/shorts\/|youtu\.be\/)([A-Za-z0-9_-]{6,})/i)
  return m ? `https://www.youtube.com/watch?v=${m[1]}` : null
}
export function validateProjectFile(file, extensions = [], files = []) {
  const ext = `.${String(file?.name || '').split('.').pop().toLowerCase()}`
  if (!extensions.includes(ext)) return 'This file type is not allowed for the selected domain.'
  if (file.size > 15 * 1024 * 1024) return 'Each file must be 15 MB or smaller.'
  if (files.length >= 10) return 'A project can have at most 10 files.'
  if (files.reduce((n, f) => n + f.size, 0) + file.size > 60 * 1024 * 1024) return 'Project files cannot exceed 60 MB total.'
  return null
}
export function stageState(stage, stages = []) { return stages.find((x) => x.name === stage)?.state || 'pending' }
