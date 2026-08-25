import React from 'react'

export default function RecruiterMessages() {
  return (
    <div className="recruiter-messages" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <h1 style={{ fontSize: 28, margin: '0 0 24px 0' }}>Messages</h1>
      
      <div className="panel" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div style={{ maxWidth: 400 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>💬</div>
          <h2 style={{ marginBottom: 12 }}>Messaging Coming Soon</h2>
          <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            We're building a seamless way for you to communicate directly with top talent. Direct candidate messaging and interview scheduling capabilities are currently in development.
          </p>
          <div style={{ marginTop: 24, padding: 12, backgroundColor: 'var(--background)', borderRadius: 8, fontSize: 13, color: 'var(--text-dim)' }}>
            Feature Preview: In the future, you'll be able to click "Message" on any candidate profile to start a conversation here.
          </div>
        </div>
      </div>
    </div>
  )
}
