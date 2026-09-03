import React, { useState } from 'react'
import './CertificationsSection.css'

export default function CertificationsSection({ certifications = [], onAdd, onDelete, apiCall }) {
  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [formData, setFormData] = useState({
    name: '',
    issuing_organization: '',
    issue_date: '',
    credential_url: '',
  })
  const [selectedFile, setSelectedFile] = useState(null)

  const resetForm = () => {
    setFormData({
      name: '',
      issuing_organization: '',
      issue_date: '',
      credential_url: '',
    })
    setSelectedFile(null)
    setShowForm(false)
    setError(null)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!formData.name.trim() || !formData.issuing_organization.trim()) {
      setError('Certification name and organization are required')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const fd = new FormData()
      fd.append('name', formData.name)
      fd.append('issuing_organization', formData.issuing_organization)
      if (formData.issue_date) fd.append('issue_date', formData.issue_date)
      if (formData.credential_url) fd.append('credential_url', formData.credential_url)
      if (selectedFile) fd.append('file', selectedFile)

      const res = await apiCall('/api/candidate/profile/certifications', {
        method: 'POST',
        body: fd,
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Failed to add certification')

      if (onAdd) onAdd(data.certifications)
      resetForm()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (index) => {
    if (!confirm('Delete this certification?')) return

    setLoading(true)
    setError(null)

    try {
      const res = await apiCall(`/api/candidate/profile/certifications/${index}`, {
        method: 'DELETE',
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Failed to delete certification')

      if (onDelete) onDelete(data.certifications)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const getFileIcon = (filePath) => {
    if (!filePath) return '📎'
    const ext = filePath.split('.').pop().toLowerCase()
    if (ext === 'pdf') return '📄'
    if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) return '🖼️'
    return '📎'
  }

  return (
    <div className="certifications-section">
      <div className="certifications-header">
        <h3>🏅 Certifications</h3>
        {!showForm && (
          <button className="btn-add" onClick={() => setShowForm(true)}>
            + Add Certification
          </button>
        )}
      </div>

      {showForm && (
        <form className="certifications-form" onSubmit={handleSubmit}>
          {error && <div className="error-message">{error}</div>}

          <div className="form-row">
            <div className="form-group">
              <label>Certification Name *</label>
              <input
                type="text"
                placeholder="e.g., AWS Solutions Architect"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                disabled={loading}
                required
              />
            </div>
            <div className="form-group">
              <label>Issuing Organization *</label>
              <input
                type="text"
                placeholder="e.g., Amazon Web Services"
                value={formData.issuing_organization}
                onChange={(e) => setFormData({ ...formData, issuing_organization: e.target.value })}
                disabled={loading}
                required
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Issue Date</label>
              <input
                type="date"
                value={formData.issue_date}
                onChange={(e) => setFormData({ ...formData, issue_date: e.target.value })}
                disabled={loading}
              />
            </div>
            <div className="form-group">
              <label>Credential URL</label>
              <input
                type="url"
                placeholder="https://..."
                value={formData.credential_url}
                onChange={(e) => setFormData({ ...formData, credential_url: e.target.value })}
                disabled={loading}
              />
            </div>
          </div>

          <div className="form-group">
            <label>Certificate File (PDF/Image)</label>
            <input
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.webp"
              onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
              disabled={loading}
            />
            {selectedFile && <p className="file-selected">✓ {selectedFile.name}</p>}
          </div>

          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Adding...' : 'Add Certification'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={resetForm} disabled={loading}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {certifications.length > 0 && (
        <div className="certifications-list">
          {certifications.map((cert, idx) => (
            <div key={idx} className="certification-card">
              <div className="cert-icon">{getFileIcon(cert.file_path)}</div>
              <div className="cert-content">
                <h4>{cert.name}</h4>
                <p className="org">{cert.issuing_organization}</p>
                {cert.issue_date && <p className="date">Issued: {cert.issue_date}</p>}
                {cert.credential_url && (
                  <a href={cert.credential_url} target="_blank" rel="noopener noreferrer" className="cert-link">
                    View Certificate →
                  </a>
                )}
                {cert.file_path && (
                  <a href={`/media/${cert.file_path}`} target="_blank" rel="noopener noreferrer" className="cert-link">
                    {getFileIcon(cert.file_path) === '📄' ? 'Download PDF' : 'View File'} →
                  </a>
                )}
              </div>
              <button
                className="btn-icon-danger"
                onClick={() => handleDelete(idx)}
                title="Delete certification"
                disabled={loading}
              >
                🗑️
              </button>
            </div>
          ))}
        </div>
      )}

      {certifications.length === 0 && !showForm && (
        <div className="empty-state">
          <p>No certifications added yet</p>
        </div>
      )}
    </div>
  )
}
