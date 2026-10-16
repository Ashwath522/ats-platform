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

/** Favicon URL for a college domain (logos are never stored locally). */
export const collegeLogoUrl = (domain, size = 128) =>
  domain ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=${size}` : ''
