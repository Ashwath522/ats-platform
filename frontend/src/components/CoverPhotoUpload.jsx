import React, { useState } from 'react'
import './CoverPhotoUpload.css'

export default function CoverPhotoUpload({
  coverPhotoUrl,
  onUpload,
  endpoint = '/api/candidate/profile/cover-photo',
  apiCall,
}) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState(null)
  const [isHovering, setIsHovering] = useState(false)
  const inputRef = React.useRef(null)

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Validate file type
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) {
      setError('Please upload a valid image (PNG, JPG, WEBP, or GIF)')
      return
    }

    // Validate file size (5MB)
    if (file.size > 5 * 1024 * 1024) {
      setError('Image must be smaller than 5MB')
      return
    }

    setUploading(true)
    setError(null)

    try {
      const fd = new FormData()
      fd.append('file', file)

      const res = await apiCall(endpoint, {
        method: 'POST',
        body: fd,
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Upload failed')

      if (onUpload) {
        onUpload(data.cover_photo_url)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setUploading(false)
      if (inputRef.current) {
        inputRef.current.value = ''
      }
    }
  }

  return (
    <div className="cover-photo-container">
      <div
        className={`cover-photo-wrapper ${isHovering ? 'hovering' : ''} ${coverPhotoUrl ? 'has-image' : ''}`}
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
        onClick={() => !uploading && inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !uploading) {
            inputRef.current?.click()
          }
        }}
      >
        {coverPhotoUrl ? (
          <img src={coverPhotoUrl} alt="Cover Photo" className="cover-photo-image" />
        ) : (
          <div className="cover-photo-placeholder">
            <div className="placeholder-gradient"></div>
          </div>
        )}

        <div className="cover-overlay">
          <div className="overlay-content">
            <span className="upload-icon">🖼️</span>
            <span className="upload-text">
              {coverPhotoUrl ? 'Change Cover Photo' : 'Add Cover Photo'}
            </span>
          </div>
        </div>

        {uploading && <div className="cover-loading">Uploading...</div>}
      </div>

      {error && <div className="cover-error">{error}</div>}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={handleFileSelect}
        disabled={uploading}
        style={{ display: 'none' }}
      />
    </div>
  )
}
