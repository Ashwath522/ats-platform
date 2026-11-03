/** Lazy loader for the college dataset (src/data/colleges.json is its own chunk). */
import { buildIndex, findCollege, matchColleges } from './collegeMatch.js'
// Imported (not in /public) so Vite gives each file a content hash: replacing a
// logo changes its URL, so browsers and the service worker never show a stale one.
import atriaInstituteLogo from '../assets/colleges/atria-institute-of-technology.png'
import atriaUniversityLogo from '../assets/colleges/atria-university.png'

let promise = null
let index = null

export function loadColleges() {
  if (!promise) {
    promise = import('../data/colleges.json')
      .then((m) => { index = buildIndex(m.default || m); return index })
      .catch((e) => { promise = null; throw e })
  }
  return promise
}
export const collegeIndexSync = () => index
export const searchColleges = (q, limit = 8) => (index ? matchColleges(index, q, limit) : [])
export const lookupCollege = (ref) => (index ? findCollege(index, ref) : null)

/** Custom logo overrides for institutions where external favicon bots fail or have low-res icons. */
const LOGO_OVERRIDES = {
  'atria.edu.in': atriaInstituteLogo,
  'atria.edu': atriaInstituteLogo,
  'atria': atriaInstituteLogo,
  'www.atria.edu': atriaInstituteLogo,
  'www.atria.edu.in': atriaInstituteLogo,
  'atriauniversity.edu.in': atriaUniversityLogo,
  'atria-university': atriaUniversityLogo,
  'atriauniversity.edu': atriaUniversityLogo,
  'www.atriauniversity.edu.in': atriaUniversityLogo,
}

/** Favicon URL or custom logo for a college domain or identifier. */
export const collegeLogoUrl = (domainOrId, size = 128) => {
  if (!domainOrId) return ''
  const key = String(domainOrId).toLowerCase().trim()
  if (LOGO_OVERRIDES[key]) return LOGO_OVERRIDES[key]
  const host = key.replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0]   // "https://www.atria.edu/" → "atria.edu"
  if (LOGO_OVERRIDES[host]) return LOGO_OVERRIDES[host]
  if (key.startsWith('/') || key.startsWith('http://') || key.startsWith('https://')) return domainOrId
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(key)}&sz=${size}`
}

