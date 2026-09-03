import React, { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import AvatarUpload from '../../components/AvatarUpload.jsx'
import CoverPhotoUpload from '../../components/CoverPhotoUpload.jsx'

export default function RecruiterProfile() {
  const { username, api } = useOutletContext()
  const [companies, setCompanies] = useState([])
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState(null)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({
    headline: '',
    bio: '',
    company_name: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  // Load recruiter profile
  useEffect(() => {
    async function loadProfile() {
      try {
        const res = await api('/api/recruiter/profile')
        if (res.ok) {
          const data = await res.json()
          setProfile(data)
          setForm({
            headline: data.headline || '',
            bio: data.bio || '',
            company_name: data.company_name || '',
          })
        }
      } catch (e) {
        console.error(e)
      }
    }
    loadProfile()
  }, [api])

  useEffect(() => {
    async function loadCompanies() {
      try {
        const res = await api('/api/recruiter/companies')
        if (res.ok) {
          setCompanies(await res.json())
        }
      } catch (e) {
        console.error(e)
      } finally {
        setLoading(false)
      }
    }
    loadCompanies()
  }, [api])

  async function saveProfile() {
    setSaving(true)
    setError(null)
    try {
      const res = await api('/api/recruiter/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          headline: form.headline.trim(),
          bio: form.bio.trim(),
          company_name: form.company_name.trim(),
        }),
      })
      if (!res.ok) throw new Error('Failed to save profile')
      const data = await res.json()
      setProfile(data)
      setEditing(false)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  if (!profile) return <div className="panel"><div className="empty-state">Loading profile…</div></div>

  return (
    <div className="recruiter-profile">
      {/* Cover Photo */}
      <div className="panel" style={{ padding: 0, border: 'none', marginBottom: 0 }}>
        <CoverPhotoUpload
          coverPhotoUrl={profile.cover_photo_url}
          onUpload={() => window.location.reload()}
          endpoint="/api/recruiter/profile/cover-photo"
          apiCall={api}
        />
      </div>

      <h1 style={{ fontSize: 28, margin: '24px 0 24px 0' }}>Your Profile</h1>

      {/* Profile Card */}
      <div className="panel" style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 24, marginBottom: 20 }}>
          <AvatarUpload
            avatarUrl={profile.avatar_url}
            username={profile.headline || username}
            onUpload={() => window.location.reload()}
            endpoint="/api/recruiter/profile/avatar"
            apiCall={api}
            size="medium"
          />
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: '0 0 4px 0' }}>{profile.headline || username}</h2>
            {profile.company_name && <div style={{ color: 'var(--text-secondary)', marginBottom: 8 }}>👔 {profile.company_name}</div>}
            <p style={{ color: 'var(--text-secondary)', margin: 0 }}>
              {profile.bio || 'Add a bio to let candidates know more about you'}
            </p>
          </div>
          <button className="edit-toggle-btn" onClick={() => setEditing(!editing)}>
            {editing ? 'Cancel' : '✏️ Edit'}
          </button>
        </div>

        {editing && (
          <div className="profile-edit-form" style={{ borderTop: '1px solid var(--border)', paddingTop: 20 }}>
            {error && <div style={{ background: 'var(--danger-bg)', color: 'var(--danger)', padding: 12, borderRadius: 6, marginBottom: 12 }}>{error}</div>}

            <label style={{ display: 'block', marginBottom: 12 }}>Headline</label>
            <input
              type="text"
              value={form.headline}
              onChange={(e) => setForm({ ...form, headline: e.target.value })}
              placeholder="e.g. Senior Recruiter at TechCorp"
              style={{ width: '100%', padding: 10, marginBottom: 12, border: '1px solid var(--border)', borderRadius: 6 }}
            />

            <label style={{ display: 'block', marginBottom: 12 }}>Company Name</label>
            <input
              type="text"
              value={form.company_name}
              onChange={(e) => setForm({ ...form, company_name: e.target.value })}
              placeholder="e.g. TechCorp Inc."
              style={{ width: '100%', padding: 10, marginBottom: 12, border: '1px solid var(--border)', borderRadius: 6 }}
            />

            <label style={{ display: 'block', marginBottom: 12 }}>Bio</label>
            <textarea
              rows={3}
              value={form.bio}
              onChange={(e) => setForm({ ...form, bio: e.target.value })}
              placeholder="Tell candidates about your team and hiring approach..."
              style={{ width: '100%', padding: 10, marginBottom: 12, border: '1px solid var(--border)', borderRadius: 6, fontFamily: 'inherit' }}
            />

            <button
              onClick={saveProfile}
              disabled={saving}
              style={{
                background: 'var(--primary)',
                color: 'white',
                border: 'none',
                padding: '10px 20px',
                borderRadius: 6,
                cursor: saving ? 'not-allowed' : 'pointer',
                opacity: saving ? 0.6 : 1,
              }}
            >
              {saving ? 'Saving…' : 'Save Profile'}
            </button>
          </div>
        )}
      </div>

      <h2 style={{ fontSize: 20, marginBottom: 16 }}>Company Presence</h2>
      {loading ? (
        <div className="empty-state">Loading company details...</div>
      ) : companies.length === 0 ? (
        <div className="panel empty-state">
          No company identity configured. You can set this up in the Legacy Matches tab if needed.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {companies.map(c => (
            <div key={c.id} className="panel">
              <h3 style={{ margin: '0 0 8px 0', fontSize: 18 }}>{c.name}</h3>
              <p style={{ color: 'var(--text-secondary)', margin: 0 }}>
                {c.current_title ? `Actively hiring: ${c.current_title}` : 'No active roles in legacy system.'}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
