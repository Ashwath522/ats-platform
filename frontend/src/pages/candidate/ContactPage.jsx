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
        <h2>Support</h2>
        <p className="panel-desc">Need help? Reach out to the ATS Platform team.</p>
        <div className="support-info">
          <p>📧 support@atsplatform.io</p>
          <p>📞 +91 1234 567890</p>
        </div>
      </div>
    </div>
  )
}
