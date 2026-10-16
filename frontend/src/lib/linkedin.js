/** LinkedIn profile-link + PDF-import helpers (pure, unit-tested). */

const URL_RE = /^(?:https?:\/\/)?(?:[a-z]{2,3}\.|www\.)?linkedin\.com\/in\/([A-Za-z0-9\-_%]{3,100})\/?(?:[?#].*)?$/i

/** '' → ''; valid profile link → https://www.linkedin.com/in/<slug>; otherwise null. */
export function normalizeLinkedInUrl(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const m = raw.match(URL_RE)
  return m ? `https://www.linkedin.com/in/${m[1]}` : null
}

const key = (s) => String(s || '').trim().toLowerCase()

/** Case-insensitive union, keeping the existing order first. */
export function mergeSkills(existing = [], incoming = []) {
  const seen = new Set()
  const out = []
  for (const s of [...existing, ...incoming]) {
    const k = key(s)
    if (k && !seen.has(k)) { seen.add(k); out.push(String(s).trim()) }
  }
  return out
}

/** Add new rows; a row matching an existing one (by the given fields) is skipped. */
export function mergeRows(existing = [], incoming = [], fields = []) {
  const sig = (r) => fields.map((f) => key(r?.[f])).join('|')
  const seen = new Set(existing.map(sig))
  return [...existing, ...incoming.filter((r) => { const s = sig(r); if (seen.has(s)) return false; seen.add(s); return true })]
}

/**
 * Build the PUT /api/candidate/profile body + education list from the
 * reviewed import. `pick` says which sections the student ticked.
 */
export function buildProfileUpdate(profile = {}, data = {}, pick = {}) {
  const body = {}
  if (pick.basics) {
    if (data.full_name && !profile.full_name) body.full_name = data.full_name
    if (data.headline) body.headline = data.headline
    if (data.location_text) body.location_text = data.location_text
  }
  if (pick.about && data.bio) body.bio = data.bio
  if (pick.skills && data.skills?.length) body.skills = mergeSkills(profile.skills || [], data.skills)
  if (pick.experience && data.experience?.length) {
    const rows = data.experience.map((j) => ({ title: j.title, company: j.company, start: j.start, end: j.end, description: [j.location, j.description].filter(Boolean).join(' · ') }))
    body.experience = mergeRows(profile.experience || [], rows, ['title', 'company', 'start'])
  }
  if (data.linkedin_url && !profile.linkedin_url) body.linkedin_url = data.linkedin_url
  let education = null
  if (pick.education && data.education?.length) {
    const rows = data.education.map((e) => ({
      level: e.level || 'degree', institution: e.institution,
      field_of_study: [e.degree, e.field_of_study].filter(Boolean).join(', '),
      start_year: e.start_year || '', end_year: e.end_year || '', grade: e.grade || '',
    }))
    education = mergeRows(profile.education || [], rows, ['institution', 'start_year'])
  }
  return { body, education }
}
