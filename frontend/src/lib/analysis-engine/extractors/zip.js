import { unzipSync, strFromU8 } from 'fflate'
import { extract as extractText } from './text.js'
const textExt = new Set(['.txt','.md','.csv','.json','.ino','.c','.cpp','.h','.py','.js','.ts','.ipynb'])
export function zipGuard(entries) { let total = 0; for (const [name, data, compressed = 0] of entries) { total += data.length; if (total > 200 * 1024 * 1024 || (compressed && data.length / compressed > 100)) return `Archive rejected: unsafe compression ratio or uncompressed size.` } return null }
export async function extract({ file, name }) {
  const files = unzipSync(new Uint8Array(await file.arrayBuffer())); const entries = Object.entries(files).map(([n, d]) => [n, d, 0]); const guard = zipGuard(entries); if (guard) return { evidence: [], warnings: [guard] }
  const names = Object.keys(files).filter((n) => !n.endsWith('/')); const hints = names.filter((n) => /(^|\/)(platformio\.ini|package\.json|requirements\.txt|[^/]+\.kicad_pro|[^/]+\.ino)$/i.test(n)).map((n) => `contains ${n.split('/').pop()}`)
  const evidence = [{ id: `client_${crypto.randomUUID()}`, source_type: 'file', source_ref: name, locator: null, fact: `${name}: ${names.length} files; top-level folders: ${[...new Set(names.map((n) => n.split('/').slice(0,2).join('/')))].slice(0, 20).join(', ') || 'none'}${hints.length ? `; ${hints.join(', ')}` : ''}`, method: 'parsed', confidence: 'high', origin: 'client' }]
  let count = 0
  for (const [entry, data] of Object.entries(files)) { if (count >= 50 || data.length > 2 * 1024 * 1024 || /(^|\/)(node_modules|\.git)(\/|$)/.test(entry)) continue; const ext = `.${entry.split('.').pop().toLowerCase()}`; if (!textExt.has(ext)) continue; try { const r = await extractText({ file: new Blob([data]), name: entry, ext }); evidence.push(...r.evidence); count++ } catch {} }
  return { evidence, warnings: [] }
}
