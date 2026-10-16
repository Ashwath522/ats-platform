import { describe, expect, it } from 'vitest'
import { buildProfileUpdate, mergeSkills, normalizeLinkedInUrl } from '../linkedin.js'
import { linkedinErrorMessage } from '../../portal/public/LinkedInCallback.jsx'
import { startLinkedIn, takeLinkedInState } from '../../portal/public/components/AuthKit.jsx'

if (typeof globalThis.window === 'undefined') globalThis.window = { location: { origin: 'https://corelink-pi.vercel.app' } }

function memStore() { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) } }

describe('normalizeLinkedInUrl', () => {
  it('accepts profile links in any common form', () => {
    expect(normalizeLinkedInUrl('https://www.linkedin.com/in/ashwath-m-767327297/?isSelfProfile=true')).toBe('https://www.linkedin.com/in/ashwath-m-767327297')
    expect(normalizeLinkedInUrl('linkedin.com/in/asha-rao')).toBe('https://www.linkedin.com/in/asha-rao')
    expect(normalizeLinkedInUrl('in.linkedin.com/in/asha-rao/')).toBe('https://www.linkedin.com/in/asha-rao')
    expect(normalizeLinkedInUrl('  ')).toBe('')
  })
  it('rejects other links', () => {
    for (const bad of ['https://www.linkedin.com/company/bosch', 'https://evil.com/in/x', 'javascript:alert(1)', 'asha rao']) expect(normalizeLinkedInUrl(bad)).toBeNull()
  })
})

describe('import merge', () => {
  it('dedupes skills case-insensitively and keeps existing data', () => {
    expect(mergeSkills(['SolidWorks', 'C'], ['solidworks', 'ANSYS'])).toEqual(['SolidWorks', 'C', 'ANSYS'])
    const profile = { skills: ['C'], experience: [{ title: 'Intern', company: 'Bosch', start: 'June 2024' }], education: [], full_name: 'Me' }
    const data = {
      full_name: 'Asha', headline: 'Student', location_text: 'Bengaluru', bio: 'Hi', skills: ['ANSYS'],
      experience: [{ title: 'Intern', company: 'bosch', start: 'June 2024' }, { title: 'Lead', company: 'SAE', start: '2023', end: 'Present' }],
      education: [{ level: 'degree', institution: 'Atria', degree: 'BE', field_of_study: 'Mech', start_year: '2021', end_year: '2025' }],
      linkedin_url: 'https://www.linkedin.com/in/asha',
    }
    const { body, education } = buildProfileUpdate(profile, data, { basics: true, about: false, skills: true, experience: true, education: true })
    expect(body.full_name).toBeUndefined() // never overwrite an existing name
    expect(body.headline).toBe('Student')
    expect(body.bio).toBeUndefined()
    expect(body.skills).toEqual(['C', 'ANSYS'])
    expect(body.experience).toHaveLength(2)
    expect(body.linkedin_url).toBe('https://www.linkedin.com/in/asha')
    expect(education[0]).toMatchObject({ institution: 'Atria', field_of_study: 'BE, Mech', end_year: '2025' })
  })
  it('adds nothing when nothing is picked', () => {
    expect(buildProfileUpdate({ linkedin_url: 'x' }, { skills: ['A'] }, {})).toEqual({ body: {}, education: null })
  })
})

describe('LinkedIn OAuth state', () => {
  it('builds the authorize URL and returns the saved state once', () => {
    const store = memStore()
    const url = new URL(startLinkedIn('cid123', 'candidate', store))
    expect(url.origin + url.pathname).toBe('https://www.linkedin.com/oauth/v2/authorization')
    expect(url.searchParams.get('client_id')).toBe('cid123')
    expect(url.searchParams.get('scope')).toBe('openid profile email')
    expect(url.searchParams.get('redirect_uri')).toBe(`${window.location.origin}/auth/linkedin/callback`)
    const saved = takeLinkedInState(store)
    expect(saved.state).toBe(url.searchParams.get('state'))
    expect(saved.role).toBe('candidate')
    expect(takeLinkedInState(store)).toBeNull()
  })
  it('explains LinkedIn errors and ignores a cancel', () => {
    expect(linkedinErrorMessage('user_cancelled_login')).toBeNull()
    expect(linkedinErrorMessage('unauthorized_scope_error', 'Scope "openid" is not authorized')).toMatch(/OpenID Connect/)
    expect(linkedinErrorMessage('invalid_request', 'The redirect_uri does not match')).toMatch(/redirect URLs/)
  })
})
