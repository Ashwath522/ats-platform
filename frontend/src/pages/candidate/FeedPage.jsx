import React, { useEffect, useState, useCallback } from 'react'
import { useAuth, createAuthedFetch } from '../../auth.jsx'

export default function FeedPage() {
  const { candidateToken, logoutCandidate } = useAuth()
  const api = createAuthedFetch(candidateToken, logoutCandidate)

  const [posts, setPosts] = useState([])
  const [loading, setLoading] = useState(true)
  const [newPost, setNewPost] = useState('')
  const [posting, setPosting] = useState(false)
  const [error, setError] = useState(null)

  const loadFeed = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api('/api/candidate/posts')
      if (res.ok) {
        const data = await res.json()
        setPosts(data.posts || [])
      } else {
        throw new Error('Failed to load home feed')
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [candidateToken])

  useEffect(() => {
    loadFeed()
  }, [loadFeed])

  async function submitPost(e) {
    e.preventDefault()
    if (!newPost.trim()) return
    setPosting(true)
    setError(null)
    try {
      const res = await api('/api/candidate/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: newPost.trim() }),
      })
      if (!res.ok) {
        throw new Error((await res.json()).detail || 'Failed to create post')
      }
      setNewPost('')
      await loadFeed()
    } catch (e) {
      setError(e.message)
    } finally {
      setPosting(false)
    }
  }

  function formatTime(isoStr) {
    const diffMs = new Date() - new Date(isoStr)
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMins / 60)
    const diffDays = Math.floor(diffHours / 24)

    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    return `${diffDays}d ago`
  }

  return (
    <div className="feed-page container">
      <div className="feed-header">
        <h2>Engineering Hub Feed</h2>
        <p className="feed-tagline">Stay updated with core engineering candidates worldwide.</p>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {/* Create Post form */}
      <form onSubmit={submitPost} className="create-post-card card">
        <textarea
          placeholder="Share an engineering milestone, project update, or learning resource..."
          value={newPost}
          onChange={e => setNewPost(e.target.value)}
          rows="3"
          maxLength="500"
          required
        />
        <div className="create-post-actions">
          <span className="char-count">{500 - newPost.length} characters left</span>
          <button type="submit" className="btn btn-primary" disabled={posting || !newPost.trim()}>
            {posting ? 'Posting...' : 'Share Update'}
          </button>
        </div>
      </form>

      {/* Posts List */}
      <div className="feed-list">
        {loading ? (
          // Distinctive skeleton loading states matching engineering theme
          <div className="feed-skeletons">
            {[1, 2, 3].map(i => (
              <div key={i} className="card skeleton-card">
                <div className="skeleton-avatar-row">
                  <div className="skeleton-circle" />
                  <div className="skeleton-text-group">
                    <div className="skeleton-line short" />
                    <div className="skeleton-line extra-short" />
                  </div>
                </div>
                <div className="skeleton-line long" />
                <div className="skeleton-line medium" />
              </div>
            ))}
          </div>
        ) : posts.length === 0 ? (
          <div className="feed-empty card">
            <span className="feed-empty-icon">📢</span>
            <h3>No updates yet</h3>
            <p>Be the first to share an engineering project update or career milestone!</p>
          </div>
        ) : (
          posts.map(post => (
            <div key={post.id} className="feed-card card">
              <div className="feed-card-header">
                <div className="feed-author-avatar">
                  {post.username ? post.username.substring(0, 2).toUpperCase() : 'EE'}
                </div>
                <div className="feed-author-meta">
                  <span className="feed-author-name">{post.username || 'Anonymous Candidate'}</span>
                  <span className="feed-author-headline">{post.headline}</span>
                  <span className="feed-post-time">{formatTime(post.created_at)}</span>
                </div>
              </div>
              <div className="feed-card-body">
                <p>{post.content}</p>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
