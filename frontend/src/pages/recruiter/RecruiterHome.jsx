import React, { useEffect, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { MessageSquare, ThumbsUp, Send } from 'lucide-react'

export default function RecruiterHome() {
  const { api, username } = useOutletContext()
  const [stats, setStats] = useState({ activeJobs: 0, newApplicants: 0, shortlisted: 0 })
  const [loading, setLoading] = useState(true)
  const [jobs, setJobs] = useState([])
  const [posts, setPosts] = useState([])
  const [newPostContent, setNewPostContent] = useState('')
  const [posting, setPosting] = useState(false)

  useEffect(() => {
    async function loadData() {
      try {
        const jobsRes = await api('/api/recruiter/jobs')
        if (!jobsRes.ok) throw new Error('Failed to load jobs')
        const jobsData = await jobsRes.json()
        setJobs(jobsData)

        let active = 0
        let newApp = 0
        let short = 0
        
        jobsData.forEach(j => {
          if (j.status === 'open') active++
        })

        for (const job of jobsData) {
          try {
            const appRes = await api(`/api/recruiter/jobs/${job.id}/applicants`)
            if (appRes.ok) {
              const appData = await appRes.json()
              appData.applicants.forEach(a => {
                if (a.status === 'ats_check') newApp++
                if (a.status === 'shortlisted') short++
              })
            }
          } catch (e) {}
        }
        
        setStats({
          activeJobs: active,
          newApplicants: newApp,
          shortlisted: short
        })

        const postsRes = await api('/api/recruiter/posts')
        if (postsRes.ok) {
          setPosts(await postsRes.json())
        }
      } catch (e) {
        console.error(e)
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [api])

  async function handlePost() {
    if (!newPostContent.trim()) return
    setPosting(true)
    try {
      const res = await api('/api/recruiter/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: newPostContent })
      })
      if (res.ok) {
        const post = await res.json()
        setPosts([post, ...posts])
        setNewPostContent('')
      }
    } catch (e) {
      console.error(e)
    } finally {
      setPosting(false)
    }
  }

  return (
    <div className="recruiter-home">
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 28, margin: '0 0 8px 0' }}>Good morning, {username}</h1>
        <p style={{ color: 'var(--text-secondary)', margin: 0 }}>Here is your hiring overview for today.</p>
      </div>

      <div className="stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 20, marginBottom: 40 }}>
        <div className="panel" style={{ padding: 24, textAlign: 'center' }}>
          <div style={{ fontSize: 36, fontWeight: 'bold', color: 'var(--primary)', marginBottom: 8 }}>{loading ? '-' : stats.activeJobs}</div>
          <div style={{ color: 'var(--text-secondary)', fontSize: 14, textTransform: 'uppercase', letterSpacing: 1 }}>Active Jobs</div>
        </div>
        <div className="panel" style={{ padding: 24, textAlign: 'center' }}>
          <div style={{ fontSize: 36, fontWeight: 'bold', color: 'var(--primary)', marginBottom: 8 }}>{loading ? '-' : stats.newApplicants}</div>
          <div style={{ color: 'var(--text-secondary)', fontSize: 14, textTransform: 'uppercase', letterSpacing: 1 }}>New Applicants</div>
        </div>
        <div className="panel" style={{ padding: 24, textAlign: 'center' }}>
          <div style={{ fontSize: 36, fontWeight: 'bold', color: 'var(--primary)', marginBottom: 8 }}>{loading ? '-' : stats.shortlisted}</div>
          <div style={{ color: 'var(--text-secondary)', fontSize: 14, textTransform: 'uppercase', letterSpacing: 1 }}>Shortlisted</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 32 }}>
        <div>
          <h2 style={{ marginBottom: 16 }}>CoreLink Feed</h2>
          
          <div className="panel" style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 13, fontWeight: 'bold', marginBottom: 12, color: 'var(--text-secondary)' }}>Share something with your professional network</div>
            <textarea 
              rows={3} 
              style={{ width: '100%', marginBottom: 12 }} 
              placeholder="What's happening in your company? Share a hiring announcement or update..."
              value={newPostContent}
              onChange={e => setNewPostContent(e.target.value)}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn btn-primary btn-sm" onClick={handlePost} disabled={posting || !newPostContent.trim()}>
                <Send size={16} style={{ marginRight: 6 }} /> Post
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {posts.length === 0 ? (
              <div className="empty-state panel">No posts in your network yet. Be the first to share an update!</div>
            ) : (
              posts.map(post => (
                <div key={post.id} className="panel" style={{ padding: 20 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                    <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--primary)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold' }}>
                      {post.recruiter_username.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div style={{ fontWeight: 'bold' }}>{post.recruiter_username}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{new Date(post.created_at).toLocaleDateString()}</div>
                    </div>
                  </div>
                  <p style={{ margin: '0 0 16px 0', lineHeight: 1.5 }}>{post.content}</p>
                  <div style={{ display: 'flex', gap: 16, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                    <button className="btn btn-ghost btn-sm" style={{ padding: 4, color: 'var(--text-secondary)' }}><ThumbsUp size={16} style={{ marginRight: 6 }} /> Like</button>
                    <button className="btn btn-ghost btn-sm" style={{ padding: 4, color: 'var(--text-secondary)' }}><MessageSquare size={16} style={{ marginRight: 6 }} /> Comment</button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div>
          <h2 style={{ marginBottom: 16 }}>Hiring Activity</h2>
          <div className="panel">
            {jobs.length === 0 ? (
              <div className="empty-state" style={{ padding: 32 }}>
                <p>No active jobs yet.</p>
                <Link to="/recruiter/jobs" className="btn btn-primary" style={{ marginTop: 16 }}>Create your first job</Link>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {jobs.slice(0, 3).map(job => (
                  <div key={job.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 16, borderBottom: '1px solid var(--border)' }}>
                    <div>
                      <h4 style={{ margin: '0 0 4px 0' }}>{job.title}</h4>
                      <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{job.location_text || 'Remote'}</div>
                    </div>
                    <Link to={`/recruiter/jobs?id=${job.id}`} className="btn btn-secondary btn-sm">Pipeline</Link>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

