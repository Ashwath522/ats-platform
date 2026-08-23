import React, { useEffect, useState, useCallback } from 'react'
import { useAuth, createAuthedFetch } from '../../auth.jsx'

export default function ContactPage() {
  const { candidateToken, logoutCandidate } = useAuth()
  const api = createAuthedFetch(candidateToken, logoutCandidate)

  const [profile, setProfile] = useState(null)
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    try {
      const res = await api('/api/candidate/profile')
      if (res.ok) {
        const data = await res.json()
        setProfile(data)
        setEmail(data.contact_email || '')
        setPhone(data.contact_phone || '')
      }
    } catch (e) {}
  }, [candidateToken])

  useEffect(() => { load() }, [load])

  async function save() {
    setSaving(true)
    setSaved(false)
    setError(null)
    try {
      const res = await api('/api/candidate/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contact_email: email, contact_phone: phone }),
      })
      if (!res.ok) throw new Error((await res.json()).detail || 'Failed')
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="contact-page">
      <div className="panel">
        <h2>Contact Info</h2>
        <p className="panel-desc">Your contact details are visible to recruiters when you apply to jobs.</p>

        <label>Email</label>
        <input type="text" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" />

        <label>Phone</label>
        <input type="text" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+91 …" />

        <button className="primary" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save contact info'}
        </button>
        {saved && <div style={{ color: 'var(--accent)', fontSize: 13, marginTop: 8 }}>✓ Saved</div>}
        {error && <div className="error-msg">{error}</div>}
      </div>

      <div className="panel">
        <h2>Feedback & Suggestions</h2>
        <p className="panel-desc">Submit ideas, bug reports, or feature requests to the platform administrators.</p>
        <FeedbackForm username={profile?.contact_email || ''} />
      </div>
    </div>
  )
}

function FeedbackForm({ username }) {
  const [text, setText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(null)
  const [err, setErr] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!text.trim()) return
    setSubmitting(true)
    setSuccess(null)
    setErr(null)
    try {
      const fd = new FormData()
      fd.append('text', text.trim())
      fd.append('submitter', username || 'anonymous')

      const res = await fetch('/api/suggestions', {
        method: 'POST',
        body: fd
      })
      if (!res.ok) throw new Error((await res.json()).detail || 'Failed to submit feedback')
      setText('')
      setSuccess('Thank you! Your feedback has been submitted to the admin team.')
    } catch (e) {
      setErr(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ marginTop: 12 }}>
      <div className="form-group" style={{ marginBottom: 12 }}>
        <textarea
          placeholder="Share your thoughts..."
          value={text}
          onChange={e => setText(e.target.value)}
          rows="3"
          required
          style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid var(--border-color)' }}
        />
      </div>
      {success && <div style={{ color: 'green', fontSize: 13, marginBottom: 12 }}>{success}</div>}
      {err && <div className="error-banner" style={{ marginBottom: 12 }}>{err}</div>}
      <button type="submit" className="btn btn-secondary" disabled={submitting || !text.trim()}>
        {submitting ? 'Submitting...' : 'Send Feedback'}
      </button>
    </form>
  )
}
