import React, { useEffect, useState, useCallback } from 'react'
import { useAuth, createAuthedFetch } from '../../auth.jsx'
import { useOutletContext } from 'react-router-dom'

export default function ProfilePage() {
  const { candidateToken, logoutCandidate } = useAuth()
  const api = createAuthedFetch(candidateToken, logoutCandidate)
  const { loadParentProfile } = useOutletContext() || {}

  const [profile, setProfile] = useState(null)
  const [branches, setBranches] = useState([])
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [resumeFile, setResumeFile] = useState(null)
  const [uploadingResume, setUploadingResume] = useState(false)

  // ATS check against the profile's current resume - branch/role picked
  // right here since the resume alone has no JD context.
  const [atsBranch, setAtsBranch] = useState('')
  const [atsRoles, setAtsRoles] = useState([])
  const [atsRoleId, setAtsRoleId] = useState('')
  const [checkingAts, setCheckingAts] = useState(false)
  const [atsResult, setAtsResult] = useState(null)
  const [atsError, setAtsError] = useState(null)

  // Deep analysis (grammar / technical depth / experience) - separate,
  // on-demand LLM call, not part of the fast score above.
  const [checkingDeepAnalysis, setCheckingDeepAnalysis] = useState(false)
  const [deepAnalysis, setDeepAnalysis] = useState(null)
  const [deepAnalysisError, setDeepAnalysisError] = useState(null)

  // "What should I add?" suggestions - also separate/on-demand.
  const [checkingSuggestions, setCheckingSuggestions] = useState(false)
  const [suggestions, setSuggestions] = useState(null)
  const [suggestionsError, setSuggestionsError] = useState(null)

  useEffect(() => {
    if (!atsBranch) { setAtsRoles([]); setAtsRoleId(''); return }
    fetch(`/api/candidate/roles?branch=${encodeURIComponent(atsBranch)}`)
      .then(res => res.json())
      .then(items => setAtsRoles(items || []))
      .catch(() => setAtsRoles([]))
  }, [atsBranch])

  async function checkAts() {
    if (!profile?.resume || !atsRoleId) {
      setAtsError('Pick a branch and role first.')
      return
    }
    setAtsError(null)
    setCheckingAts(true)
    setAtsResult(null)
    setDeepAnalysis(null)
    setSuggestions(null)
    try {
      const fd = new FormData()
      fd.append('resume_id', profile.resume.resume_id)
      fd.append('role_id', atsRoleId)
      const res = await api('/api/candidate/ats-score-existing-resume', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'ATS check failed')
      setAtsResult(data)
    } catch (e) {
      setAtsError(e.message)
    } finally {
      setCheckingAts(false)
    }
  }

  async function runDeepAnalysis() {
    if (!profile?.resume || !atsRoleId) return
    setDeepAnalysisError(null)
    setCheckingDeepAnalysis(true)
    try {
      const fd = new FormData()
      fd.append('resume_id', profile.resume.resume_id)
      fd.append('role_id', atsRoleId)
      const res = await api('/api/candidate/deep-analysis', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Deep analysis failed')
      setDeepAnalysis(data)
    } catch (e) {
      setDeepAnalysisError(e.message)
    } finally {
      setCheckingDeepAnalysis(false)
    }
  }

  async function runSuggestions() {
    if (!profile?.resume || !atsRoleId) return
    setSuggestionsError(null)
    setCheckingSuggestions(true)
    try {
      const fd = new FormData()
      fd.append('resume_id', profile.resume.resume_id)
      fd.append('role_id', atsRoleId)
      const res = await api('/api/candidate/resume-suggestions', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Suggestions failed')
      setSuggestions(data)
    } catch (e) {
      setSuggestionsError(e.message)
    } finally {
      setCheckingSuggestions(false)
    }
  }

  // Posts
  const [posts, setPosts] = useState([])
  const [newPost, setNewPost] = useState('')
  const [postingPost, setPostingPost] = useState(false)

  // Load branches
  useEffect(() => {
    fetch('/api/candidate/branches')
      .then(res => res.json())
      .then(data => setBranches(data || []))
      .catch(() => {})
  }, [])

  const loadProfile = useCallback(async () => {
    try {
      const res = await api('/api/candidate/profile')
      if (res.ok) {
        const data = await res.json()
        setProfile(data)
        setForm({
          headline: data.headline || '',
          bio: data.bio || '',
          branch: data.branch || '',
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
        branch: form.branch || null,
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
      if (loadParentProfile) {
        loadParentProfile() // Sync layout topbar
      }
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
            {profile.branch && (
              <span className="profile-branch-badge badge" style={{ display: 'inline-block', marginBottom: 8, background: 'var(--primary-light)', color: 'var(--primary-color)', padding: '2px 8px', borderRadius: 12, fontSize: 12, fontWeight: 'bold' }}>
                ⚙️ {branches.find(b => b.id === profile.branch)?.name || profile.branch}
              </span>
            )}
            <p className="profile-bio">{profile.bio || 'Add a short bio about yourself'}</p>
          </div>
          <button className="edit-toggle-btn" onClick={() => setEditing(!editing)}>
            {editing ? 'Cancel' : '✏️ Edit'}
          </button>
        </div>

        {editing && (
          <div className="profile-edit-form">
            <label>Headline</label>
            <input type="text" value={form.headline} onChange={e => setForm({...form, headline: e.target.value})} placeholder="e.g. Mechanical Engineer" />

            <label>Target Core Engineering Branch</label>
            <select
              value={form.branch}
              onChange={e => setForm({...form, branch: e.target.value})}
              style={{ width: '100%', marginBottom: 12, padding: 8, borderRadius: 6, border: '1px solid var(--border-color)' }}
            >
              <option value="">Select branch...</option>
              {branches.map(b => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>

            <label>Bio</label>
            <textarea rows={3} value={form.bio} onChange={e => setForm({...form, bio: e.target.value})} placeholder="Tell recruiters about yourself…" />

            <label>Skills (comma-separated)</label>
            <input type="text" value={form.skills} onChange={e => setForm({...form, skills: e.target.value})} placeholder="MATLAB, SolidWorks, FEA, …" />

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
        <div className="ats-action-row" style={{ marginTop: 12 }}>
          <div className="ats-target-picker" style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <select value={atsBranch} onChange={e => { setAtsBranch(e.target.value); setAtsRoleId('') }}>
              <option value="">Select branch</option>
              {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <select value={atsRoleId} onChange={e => setAtsRoleId(e.target.value)} disabled={!atsBranch}>
              <option value="">Select role</option>
              {atsRoles.map(r => <option key={r.id} value={r.id}>{r.title}</option>)}
            </select>
          </div>
          <button className="primary" onClick={checkAts} disabled={!profile.resume || !atsRoleId || checkingAts}>
            {checkingAts ? 'Checking ATS…' : 'Check ATS of current resume'}
          </button>
          {atsError && <p className="error-msg">{atsError}</p>}
        </div>

        {atsResult && (
          <div className="ats-result-panel" style={{ marginTop: 16 }}>
            <div className="ats-score-summary" style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8 }}>
              <span className="chip matched" style={{ fontSize: 16, fontWeight: 700 }}>{atsResult.ats_score}/100</span>
              <span>{atsResult.job_title}</span>
            </div>
            <div className="chip-row">
              {atsResult.matched_skills?.map(s => <span key={s} className="chip matched">{s}</span>)}
              {atsResult.missing_skills?.map(s => <span key={s} className="chip missing">{s}</span>)}
            </div>

            <div className="ats-extra-actions" style={{ marginTop: 12, display: 'flex', gap: 8 }}>
              <button onClick={runDeepAnalysis} disabled={checkingDeepAnalysis}>
                {checkingDeepAnalysis ? 'Analyzing…' : 'Check grammar & technical depth'}
              </button>
              <button onClick={runSuggestions} disabled={checkingSuggestions}>
                {checkingSuggestions ? 'Thinking…' : 'What should I add?'}
              </button>
            </div>

            {deepAnalysisError && <p className="error-msg">{deepAnalysisError}</p>}
            {deepAnalysis && (
              <div className="deep-analysis-panel" style={{ marginTop: 12 }}>
                {deepAnalysis.llm_configured === false ? (
                  <p className="panel-desc">{deepAnalysis.overall_summary}</p>
                ) : (
                  <>
                    <div className="deep-analysis-scores" style={{ display: 'flex', gap: 16, marginBottom: 8 }}>
                      <span>Grammar: {deepAnalysis.grammar_score}/100</span>
                      <span>Technical depth: {deepAnalysis.technical_depth_score}/100</span>
                      <span>Experience: {deepAnalysis.experience_score}/100</span>
                    </div>
                    {deepAnalysis.grammar_issues?.length > 0 && (
                      <ul className="grammar-issues-list">
                        {deepAnalysis.grammar_issues.map((g, i) => (
                          <li key={i}><strong>{g.issue}</strong> — {g.suggestion}</li>
                        ))}
                      </ul>
                    )}
                    {deepAnalysis.overall_summary && <p>{deepAnalysis.overall_summary}</p>}
                  </>
                )}
              </div>
            )}

            {suggestionsError && <p className="error-msg">{suggestionsError}</p>}
            {suggestions && (
              suggestions.llm_configured === false ? (
                <p className="panel-desc" style={{ marginTop: 12 }}>Resume suggestions aren't configured on this server yet (no LLM API key set).</p>
              ) : (
                <ul className="resume-suggestions-list" style={{ marginTop: 12 }}>
                  {suggestions.suggestions?.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              )
            )}
          </div>
        )}
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
