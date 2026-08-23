import React, { useEffect, useState, useCallback } from 'react'
import { useAuth, createAuthedFetch } from '../../auth.jsx'

export default function ProfilePage() {
  const { candidateToken, logoutCandidate } = useAuth()
  const api = createAuthedFetch(candidateToken, logoutCandidate)

  const [profile, setProfile] = useState(null)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [resumeFile, setResumeFile] = useState(null)
  const [uploadingResume, setUploadingResume] = useState(false)

  // Posts
  const [posts, setPosts] = useState([])
  const [newPost, setNewPost] = useState('')
  const [postingPost, setPostingPost] = useState(false)

  const loadProfile = useCallback(async () => {
    try {
      const res = await api('/api/candidate/profile')
      if (res.ok) {
        const data = await res.json()
        setProfile(data)
        setForm({
          headline: data.headline || '',
          bio: data.bio || '',
          skills: (data.skills || []).join(', '),
          contact_email: data.contact_email || '',
          contact_phone: data.contact_phone || '',
        })
      }
    } catch (e) {
      setError(e.message)
    }
  }, [candidateToken])

  const loadPosts = useCallback(async () => {
    try {
      const res = await api('/api/candidate/posts')
      if (res.ok) {
        const data = await res.json()
        setPosts(data.posts || [])
      }
    } catch (e) {}
  }, [candidateToken])

  useEffect(() => { loadProfile(); loadPosts() }, [loadProfile, loadPosts])

  async function saveProfile() {
    setSaving(true)
    setError(null)
    try {
      const body = {
        headline: form.headline,
        bio: form.bio,
        skills: form.skills.split(',').map(s => s.trim()).filter(Boolean),
        contact_email: form.contact_email,
        contact_phone: form.contact_phone,
      }
      const res = await api('/api/candidate/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error((await res.json()).detail || 'Failed to save')
      const data = await res.json()
      setProfile(data)
      setEditing(false)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function uploadResume() {
    if (!resumeFile) return
    setUploadingResume(true)
    setError(null)
    try {
      const fd = new FormData()
      fd.append('file', resumeFile)
      const res = await api('/api/candidate/profile/resume', { method: 'POST', body: fd })
      if (!res.ok) throw new Error((await res.json()).detail || 'Upload failed')
      setResumeFile(null)
      await loadProfile()
    } catch (e) {
      setError(e.message)
    } finally {
      setUploadingResume(false)
    }
  }

  async function submitPost() {
    if (!newPost.trim()) return
    setPostingPost(true)
    try {
      const res = await api('/api/candidate/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: newPost.trim() }),
      })
      if (!res.ok) throw new Error((await res.json()).detail || 'Failed')
      setNewPost('')
      await loadPosts()
    } catch (e) {
      setError(e.message)
    } finally {
      setPostingPost(false)
    }
  }

  if (!profile) return <div className="panel"><div className="empty-state">Loading profile…</div></div>

  return (
    <div className="profile-page">
      {/* Profile Card */}
      <div className="panel profile-card">
        <div className="profile-card-header">
          <div className="profile-avatar">{(profile.headline || '?')[0]?.toUpperCase()}</div>
          <div className="profile-card-info">
            <h2 className="profile-headline">{profile.headline || 'Set your headline'}</h2>
            <p className="profile-bio">{profile.bio || 'Add a short bio about yourself'}</p>
          </div>
          <button className="edit-toggle-btn" onClick={() => setEditing(!editing)}>
            {editing ? 'Cancel' : '✏️ Edit'}
          </button>
        </div>

        {editing && (
          <div className="profile-edit-form">
            <label>Headline</label>
            <input type="text" value={form.headline} onChange={e => setForm({...form, headline: e.target.value})} placeholder="e.g. Full Stack Developer" />

            <label>Bio</label>
            <textarea rows={3} value={form.bio} onChange={e => setForm({...form, bio: e.target.value})} placeholder="Tell recruiters about yourself…" />

            <label>Skills (comma-separated)</label>
            <input type="text" value={form.skills} onChange={e => setForm({...form, skills: e.target.value})} placeholder="Python, React, Docker, …" />

            <label>Contact Email</label>
            <input type="text" value={form.contact_email} onChange={e => setForm({...form, contact_email: e.target.value})} placeholder="you@example.com" />

            <label>Contact Phone</label>
            <input type="text" value={form.contact_phone} onChange={e => setForm({...form, contact_phone: e.target.value})} placeholder="+91 …" />

            <button className="primary" onClick={saveProfile} disabled={saving}>
              {saving ? 'Saving…' : 'Save profile'}
            </button>
          </div>
        )}

        {!editing && profile.skills && profile.skills.length > 0 && (
          <div className="profile-skills">
            <h4>Skills</h4>
            <div className="chip-row">
              {profile.skills.map(s => <span key={s} className="chip matched">{s}</span>)}
            </div>
          </div>
        )}
      </div>

      {/* Resume Section */}
      <div className="panel">
        <h3>Resume</h3>
        {profile.resume ? (
          <div className="resume-info">
            <span className="resume-filename">📄 {profile.resume.filename}</span>
            <span className="resume-date">Uploaded {new Date(profile.resume.uploaded_at).toLocaleDateString()}</span>
          </div>
        ) : (
          <p className="panel-desc">No resume uploaded yet. Upload one to enable job applications.</p>
        )}

        <div className="resume-upload-row">
          <input
            type="file"
            accept=".pdf,.docx,.doc,.txt"
            onChange={e => setResumeFile(e.target.files[0])}
            id="resume-upload-input"
          />
          <label htmlFor="resume-upload-input" className="file-upload-label">
            {resumeFile ? resumeFile.name : 'Choose file'}
          </label>
          <button className="primary" onClick={uploadResume} disabled={!resumeFile || uploadingResume}>
            {uploadingResume ? 'Uploading…' : profile.resume ? 'Replace resume' : 'Upload resume'}
          </button>
        </div>
      </div>

      {/* Posts Section */}
      <div className="panel">
        <h3>Posts</h3>
        <p className="panel-desc">Share updates about your work and experience.</p>

        <div className="post-compose">
          <textarea
            rows={2}
            value={newPost}
            onChange={e => setNewPost(e.target.value)}
            placeholder="What's on your mind?"
          />
          <button className="primary" onClick={submitPost} disabled={postingPost || !newPost.trim()}>
            {postingPost ? 'Posting…' : 'Post'}
          </button>
        </div>

        {posts.length === 0 && <div className="empty-state">No posts yet.</div>}
        {posts.map(p => (
          <div key={p.id} className="post-item">
            <p className="post-content">{p.content}</p>
            <span className="post-date">{new Date(p.created_at).toLocaleString()}</span>
          </div>
        ))}
      </div>

      {error && <div className="error-msg">{error}</div>}
    </div>
  )
}
