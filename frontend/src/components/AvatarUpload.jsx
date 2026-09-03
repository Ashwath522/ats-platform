import React, { useState } from 'react'
import './AvatarUpload.css'

export default function AvatarUpload({
  avatarUrl,
  username = 'User',
  onUpload,
  endpoint = '/api/candidate/profile/avatar',
  apiCall,
  size = 'medium',
}) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState(null)
  const [isHovering, setIsHovering] = useState(false)
  const inputRef = React.useRef(null)

  const getInitials = () => {
    return username
      .split(' ')
      .map((word) => word[0])
      .join('')
      .toUpperCase()
      .substring(0, 2)
  }

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
        onUpload(data.avatar_url)
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

  const sizeClasses = {
    small: 'avatar-small',
    medium: 'avatar-medium',
    large: 'avatar-large',
  }

  return (
    <div className={`avatar-upload-container ${sizeClasses[size]}`}>
      <div
        className={`avatar-wrapper ${isHovering ? 'hovering' : ''} ${avatarUrl ? 'has-image' : ''}`}
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
        {avatarUrl ? (
          <img src={avatarUrl} alt="Avatar" className="avatar-image" />
        ) : (
          <div className="avatar-initials">{getInitials()}</div>
        )}

        <div className="avatar-overlay">
          <div className="overlay-content">
            <span className="upload-icon">📷</span>
            <span className="upload-text">Change Photo</span>
          </div>
        </div>

        {uploading && <div className="avatar-loading">Uploading...</div>}
      </div>

      {error && <div className="avatar-error">{error}</div>}

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
