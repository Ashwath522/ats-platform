/**
 * College matcher (pure — no React, no data import) used by CollegePicker.
 *
 * Ranking tiers (higher wins), then institution type (IIT > NIT > IIIT > Govt >
 * Deemed > Private), then dataset order:
 *   1000 exact name / alias / acronym ("iitb", "IIT B", "rvce", "pes")
 *    900 prefix of name / alias ("atr" → Atria…, "iit" → IIT …)
 *    700 every query word starts a word of one name/alias ("nit sur" → NIT Surathkal)
 *    450 every query word starts a word of name/alias + city/state ("engineering mysore")
 *    400 substring of a name / alias
 *    250 substring of city / state
 *    150 one-typo match on a word (≥ 5 letters, "manipl")
 */
const STOP = new Set(['of', 'and', 'the', 'for', 'in', 'at', 'de', 'to', 'be'])
// Official city name → older / common names people still type.
const CITY_ALT = {
  bengaluru: 'bangalore', mumbai: 'bombay', chennai: 'madras', kolkata: 'calcutta', mysuru: 'mysore',
  thiruvananthapuram: 'trivandrum', tiruchirappalli: 'trichy', kozhikode: 'calicut', mangaluru: 'mangalore',
  belagavi: 'belgaum', hubballi: 'hubli', gurugram: 'gurgaon', prayagraj: 'allahabad', varanasi: 'banaras benares',
  vadodara: 'baroda', puducherry: 'pondicherry', visakhapatnam: 'vizag', tumakuru: 'tumkur', shivamogga: 'shimoga',
  davanagere: 'davangere', 'chhatrapati sambhajinagar': 'aurangabad', kalaburagi: 'gulbarga', sonipat: 'sonepat',
  kochi: 'cochin', 'new delhi': 'delhi', 'greater noida': 'noida',
}
const TYPE_RANK = { IIT: 0, NIT: 1, IIIT: 2, Govt: 3, Deemed: 4, Private: 5 }

/** lowercase, strip accents, "&" → "and", punctuation → space, collapse spaces. */
export function normalize(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ').trim()
}
export const compact = (s) => normalize(s).replace(/ /g, '')

function acronym(name) {
  const w = normalize(name).split(' ').filter((x) => x && !STOP.has(x))
  return w.length >= 2 ? w.map((x) => x[0]).join('') : ''
}

function key(text) {
  const n = normalize(text)
  return { n, c: n.replace(/ /g, ''), w: n.split(' ').filter(Boolean) }
}

/** Precompute normalised keys once per dataset. */
export function buildIndex(list = []) {
  return list.map((c, i) => {
    const texts = [c.name, ...(c.aliases || [])]
    const acr = acronym(c.name)
    const keys = texts.map(key)
    if (acr.length >= 3) keys.push({ ...key(acr), acr: true })
    const city = normalize(c.city)
    const place = key([c.city, c.state, CITY_ALT[city] || ''].join(' '))
    return { c, i, keys, place, rank: TYPE_RANK[c.type] ?? 9 }
  })
}

function within1(a, b) {
  // Damerau-free single edit (insert / delete / substitute / adjacent swap) check.
  if (a === b) return true
  const la = a.length, lb = b.length
  if (Math.abs(la - lb) > 1) return false
  let i = 0
  while (i < la && i < lb && a[i] === b[i]) i++
  if (la === lb) return a.slice(i + 1) === b.slice(i + 1) || (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2))
  return la > lb ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1)
}

const allWordStarts = (tokens, words) => tokens.every((t) => words.some((w) => w.startsWith(t)))

function scoreEntry(e, qn, qc, tokens) {
  let best = 0
  for (const k of e.keys) {
    if (!k.n) continue
    if (k.n === qn || k.c === qc) return 1000
    if (!k.acr && (k.n.startsWith(qn) || k.c.startsWith(qc))) best = Math.max(best, 900)
    else if (k.acr && qc.length >= 2 && k.c.startsWith(qc)) best = Math.max(best, 880)
    else if (!k.acr && best < 700 && allWordStarts(tokens, k.w)) best = 700
    else if (!k.acr && best < 400 && qc.length >= 3 && (k.n.includes(qn) || k.c.includes(qc))) best = 400
  }
  if (best) return best
  if (tokens.length > 1 && e.keys.some((k) => !k.acr && allWordStarts(tokens, [...k.w, ...e.place.w]))) return 450
  if (qn.length >= 3 && e.place.n.includes(qn)) return 250
  if (tokens.length === 1 && qn.length >= 5 && e.keys.some((k) => k.w.some((w) => w.length >= 4 && within1(qn, w)))) return 150
  return 0
}

/** Rank colleges for a query. Returns at most `limit` college objects. */
export function matchColleges(index, query, limit = 8) {
  const qn = normalize(query)
  if (!qn) return []
  const qc = qn.replace(/ /g, '')
  const tokens = qn.split(' ').filter((t) => t && !STOP.has(t))
  if (!tokens.length) return []
  const typeHit = Object.keys(TYPE_RANK).find((t) => t.toLowerCase() === qc)
  const hits = []
  for (const e of index) {
    let s = scoreEntry(e, qn, qc, tokens)
    if (!s) continue
    if (typeHit && e.c.type === typeHit) s += 150 // "iit" → every IIT before IIT-like names
    hits.push([s, e])
  }
  hits.sort((a, b) => b[0] - a[0] || a[1].rank - b[1].rank || a[1].i - b[1].i)
  return hits.slice(0, limit).map(([, e]) => e.c)
}

/** Exact lookup by saved id, or by a name/alias string (for showing a logo next to free text). */
export function findCollege(index, { id, name } = {}) {
  if (id) {
    const e = index.find((x) => x.c.id === id)
    if (e) return e.c
  }
  const qc = compact(name)
  if (!qc) return null
  const e = index.find((x) => x.keys[0].c === qc) || index.find((x) => x.keys.some((k) => !k.acr && k.c === qc))
  return e ? e.c : null
}
