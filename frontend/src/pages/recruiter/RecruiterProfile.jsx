import React, { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'

export default function RecruiterProfile() {
  const { username, api } = useOutletContext()
  const [companies, setCompanies] = useState([])
  const [loading, setLoading] = useState(true)

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

  return (
    <div className="recruiter-profile">
      <h1 style={{ fontSize: 28, margin: '0 0 24px 0' }}>Your Profile</h1>
      
      <div className="panel" style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <div style={{ width: 80, height: 80, borderRadius: '50%', backgroundColor: 'var(--primary)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32, fontWeight: 'bold' }}>
            {username.charAt(0).toUpperCase()}
          </div>
          <div>
            <h2 style={{ margin: '0 0 4px 0' }}>{username}</h2>
            <div style={{ color: 'var(--text-secondary)' }}>Recruiting Professional</div>
          </div>
        </div>
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
