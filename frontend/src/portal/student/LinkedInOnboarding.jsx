import React, { useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { ArrowRight, FileUp, Link2, Loader2, ShieldCheck } from 'lucide-react'
import { useAuth } from '../../auth.jsx'
import { useApi } from '../../ui/useApi.js'
import { Alert, Button, Card, Chip, Field, Input } from '../../ui/index.jsx'
import { AuthLayout, CardBrand } from '../public/components/AuthKit.jsx'
import { buildProfileUpdate, normalizeLinkedInUrl } from '../../lib/linkedin.js'

const SECTIONS = [
  ['basics', 'Name, headline & location'],
  ['about', 'About / summary'],
  ['skills', 'Skills'],
  ['experience', 'Experience'],
  ['education', 'Education'],
  ['certifications', 'Certifications'],
]

/**
 * /candidate/onboarding/linkedin — optional "Speed up your profile" step.
 * A pasted LinkedIn link is only stored. The LinkedIn PDF (More → Save to PDF)
 * is read on our server and shown for review; nothing is saved until the
 * student presses Save. Everything can be skipped.
 */
export default function LinkedInOnboarding() {
  const { candidateToken } = useAuth()
  const api = useApi('candidate')
  const navigate = useNavigate()
  const fileRef = useRef(null)
  const [profile, setProfile] = useState(null)
  const [url, setUrl] = useState('')
  const [urlErr, setUrlErr] = useState('')
  const [preview, setPreview] = useState(null)
  const [pick, setPick] = useState({ basics: true, about: true, skills: true, experience: true, education: true, certifications: true })
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!candidateToken) return
    api.get('/api/candidate/profile', { cache: false }).then((p) => { setProfile(p); setUrl(p?.linkedin_url || '') }).catch(() => setProfile({}))
  }, [candidateToken]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!candidateToken) return <Navigate to="/candidate/login" replace />

  const upload = async (e) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setError(''); setBusy('upload')
    try {
      const fd = new FormData()
      fd.append('file', f)
      const d = await api.post('/api/candidate/profile/linkedin-import', fd)
      setPreview(d)
      if (d.linkedin_url && !url) setUrl(d.linkedin_url)
    } catch (x) { setError(x.message) } finally { setBusy('') }
  }

  const save = async () => {
    const link = normalizeLinkedInUrl(url)
    if (link === null) { setUrlErr('Paste your profile link, like linkedin.com/in/your-name'); return }
    setError(''); setBusy('save')
    try {
      const { body, education } = buildProfileUpdate(profile || {}, preview || {}, preview ? pick : {})
      if (link !== (profile?.linkedin_url || '')) body.linkedin_url = link
      if (Object.keys(body).length) await api.put('/api/candidate/profile', body)
      if (education) await api.put('/api/candidate/profile/education', education)
      if (preview && pick.certifications) {
        const have = new Set((profile?.certifications || []).map((c) => String(c.name || '').toLowerCase()))
        for (const c of preview.certifications || []) {
          if (!c.name || have.has(c.name.toLowerCase())) continue
          const fd = new FormData()
          fd.append('name', c.name)
          fd.append('issuing_organization', c.issuing_organization || 'Listed on LinkedIn')
          await api.post('/api/candidate/profile/certifications', fd)
        }
      }
      navigate('/candidate/profile', { replace: true })
    } catch (x) { setError(x.message) } finally { setBusy('') }
  }

  const count = (k) => {
    if (!preview) return 0
    if (k === 'basics') return [preview.full_name, preview.headline, preview.location_text].filter(Boolean).length
    if (k === 'about') return preview.bio ? 1 : 0
    return (preview[k] || []).length
  }

  return (
    <AuthLayout image="/assets/images/crops/login-student.jpg" imageAlt="" wide>
      <CardBrand />
      <h1>Speed up your profile</h1>
      <p className="pub-auth-sub">Both steps are optional — you can skip and fill your profile later.</p>
      {profile?.linkedin_verified && <p style={{ margin: '0 0 12px' }}><Chip tone="blue"><ShieldCheck size={14} /> LinkedIn verified</Chip></p>}

      <div className="cl-stack" style={{ gap: 16 }}>
        <Card title="1. Your LinkedIn link" icon={Link2} subtitle="Saved as a link on your profile for recruiters. We never download your LinkedIn page.">
          <Field error={urlErr}>
            <Input value={url} placeholder="linkedin.com/in/your-name" inputMode="url" autoComplete="url"
              onChange={(e) => { setUrl(e.target.value); setUrlErr('') }}
              onBlur={() => { const n = normalizeLinkedInUrl(url); if (n === null) setUrlErr('That doesn’t look like a LinkedIn profile link'); else if (n) setUrl(n) }} />
          </Field>
        </Card>

        <Card title="2. Fill details from your LinkedIn PDF" icon={FileUp}
          subtitle="On LinkedIn: open your profile → More (or Resources) → Save to PDF. Upload that file here — we read it once and don’t keep it.">
          <input ref={fileRef} type="file" accept="application/pdf,.pdf" hidden onChange={upload} />
          <Button variant="secondary" icon={busy === 'upload' ? Loader2 : FileUp} disabled={!!busy} onClick={() => fileRef.current?.click()}>
            {busy === 'upload' ? 'Reading PDF…' : preview ? 'Upload a different PDF' : 'Upload LinkedIn PDF'}
          </Button>
          {preview?.warnings?.map((w) => <div key={w} style={{ marginTop: 12 }}><Alert tone="warn">{w}</Alert></div>)}
          {preview && (
            <div className="cl-stack" style={{ gap: 10, marginTop: 14 }}>
              <strong>Choose what to add (existing details are kept):</strong>
              {SECTIONS.map(([k, label]) => (
                <label key={k} className="cl-row" style={{ gap: 10, alignItems: 'flex-start', opacity: count(k) ? 1 : 0.5 }}>
                  <input type="checkbox" checked={!!pick[k] && count(k) > 0} disabled={!count(k)} onChange={(e) => setPick((p) => ({ ...p, [k]: e.target.checked }))} style={{ marginTop: 3 }} />
                  <span>
                    <b>{label}</b> <span className="cl-muted">({count(k) || 'none found'})</span>
                    <PreviewLine k={k} d={preview} />
                  </span>
                </label>
              ))}
            </div>
          )}
        </Card>

        {error && <Alert tone="error">{error}</Alert>}
        <div className="cl-row" style={{ gap: 10, justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <Button variant="ghost" onClick={() => navigate('/candidate/feed', { replace: true })} disabled={busy === 'save'}>Skip for now</Button>
          <Button iconRight={ArrowRight} loading={busy === 'save'} disabled={!!busy || (!preview && !url.trim())} onClick={save}>Save to profile</Button>
        </div>
      </div>
    </AuthLayout>
  )
}

function PreviewLine({ k, d }) {
  let text = ''
  if (k === 'basics') text = [d.full_name, d.headline, d.location_text].filter(Boolean).join(' · ')
  else if (k === 'about') text = d.bio
  else if (k === 'skills') text = (d.skills || []).join(', ')
  else if (k === 'experience') text = (d.experience || []).map((j) => `${j.title} — ${j.company} (${j.start}–${j.end})`).join('; ')
  else if (k === 'education') text = (d.education || []).map((e) => `${e.institution}${e.end_year ? ` (${e.end_year})` : ''}`).join('; ')
  else if (k === 'certifications') text = (d.certifications || []).map((c) => c.name).join(', ')
  if (!text) return null
  return <small className="cl-muted" style={{ display: 'block', marginTop: 2, overflowWrap: 'anywhere' }}>{text.length > 220 ? `${text.slice(0, 220)}…` : text}</small>
}
