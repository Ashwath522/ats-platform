/** Lazy loader for the college dataset (src/data/colleges.json is its own chunk). */
import { buildIndex, findCollege, matchColleges } from './collegeMatch.js'

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
  'atria.edu.in': '/assets/images/colleges/atria.png',
  'atria.edu': '/assets/images/colleges/atria.png',
  'atria': '/assets/images/colleges/atria.png',
  'atriauniversity.edu.in': '/assets/images/colleges/atria-university.png',
  'atria-university': '/assets/images/colleges/atria-university.png',
}

/** Favicon URL or custom logo for a college domain or identifier. */
export const collegeLogoUrl = (domainOrId, size = 128) => {
  if (!domainOrId) return ''
  const key = String(domainOrId).toLowerCase().trim()
  if (LOGO_OVERRIDES[key]) return LOGO_OVERRIDES[key]
  if (key.startsWith('/') || key.startsWith('http://') || key.startsWith('https://')) return domainOrId
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(key)}&sz=${size}`
}

