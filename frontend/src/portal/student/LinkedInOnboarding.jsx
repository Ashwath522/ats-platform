import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStudent } from './StudentShell.jsx'
import { useApi } from '../../ui/useApi.js'

export default function LinkedInOnboarding() {
  const { profile } = useStudent() || {}; const api = useApi('candidate'); const navigate = useNavigate(); const [url, setUrl] = useState(profile?.linkedin_url || ''); const [preview, setPreview] = useState(null); const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  const save = async () => { setBusy(true); try { await api.put('/api/candidate/profile', { linkedin_url: url }); navigate('/candidate/feed') } catch (e) { setError(e.message) } finally { setBusy(false) } }
  const upload = async (e) => { const f = e.target.files[0]; if (!f) return; const fd = new FormData(); fd.append('file', f); setBusy(true); try { setPreview(await api.post('/api/candidate/profile/linkedin-import', fd)) } catch (x) { setError(x.message) } finally { setBusy(false) } }
  return <div className="app-shell"><div className="panel" style={{ maxWidth: 640, margin: '40px auto', padding: 28 }}><h1>Speed up your profile</h1><p>Everything here is optional. Paste your profile link or upload LinkedIn’s PDF export for a preview.</p><label>LinkedIn profile URL<input value={url} onChange={e => setUrl(e.target.value)} placeholder="linkedin.com/in/your-name" /></label><label>Upload LinkedIn PDF<input type="file" accept="application/pdf" onChange={upload} /></label>{preview && <pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(preview, null, 2)}</pre>}{error && <p className="pub-field-err">{error}</p>}<button className="primary" disabled={busy} onClick={save}>Save to profile</button><button className="secondary" onClick={() => navigate('/candidate/feed')}>Skip for now</button></div></div>
}
