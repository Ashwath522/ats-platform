import React, { useRef } from 'react'

export default function FileDrop({ file, onFileSelected }) {
  const inputRef = useRef(null)
  return (
    <div
      className={`file-drop ${file ? 'has-file' : ''}`}
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.docx,.doc,.txt"
        style={{ display: 'none' }}
        onChange={(e) => onFileSelected(e.target.files[0])}
      />
      {file ? `Selected: ${file.name}` : 'Click to select resume (PDF or DOCX)'}
    </div>
  )
}
