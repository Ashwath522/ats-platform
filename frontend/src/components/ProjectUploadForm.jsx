import React, { useState } from 'react'

export default function ProjectUploadForm({ api, onUploadSuccess, initialSummary }) {
  const [file, setFile] = useState(null)
  const [description, setDescription] = useState('')
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState(null)
  const [successMsg, setSuccessMsg] = useState(null)
  const [summary, setSummary] = useState(initialSummary || '')

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!file) {
      setError('Please select a project file to upload (PDF, DOCX, ZIP, or code).')
      return
    }

    setUploading(true)
    setError(null)
    setSuccessMsg(null)

    const formData = new FormData()
    formData.append('file', file)
    formData.append('description', description)

    try {
      const res = await api('/api/candidate/project-upload', {
        method: 'POST',
        body: formData,
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.detail || 'Failed to upload project')
      }

      setSuccessMsg('Project uploaded and technical summary generated successfully!')
      if (data.project_summary) {
        setSummary(data.project_summary)
      }
      setFile(null)
      if (onUploadSuccess) {
        onUploadSuccess(data)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 space-y-4">
      <div>
        <h3 className="text-base font-semibold text-slate-100">Project Portfolio & Code Upload</h3>
        <p className="text-xs text-slate-400 mt-1">
          Upload documentation or codebase (PDF, DOCX, ZIP, or code files) along with a brief description.
        </p>
      </div>

      {error && (
        <div className="p-3 bg-red-900/30 border border-red-500/40 text-red-300 text-xs rounded-xl">
          {error}
        </div>
      )}

      {successMsg && (
        <div className="p-3 bg-emerald-900/30 border border-emerald-500/40 text-emerald-300 text-xs rounded-xl">
          {successMsg}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-slate-300 mb-1">
            Project Description
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Briefly describe what this project does, your role, and key technologies used..."
            rows={3}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-300 mb-1">
            Upload File (PDF, DOCX, ZIP, Code)
          </label>
          <input
            type="file"
            accept=".pdf,.docx,.doc,.zip,.txt,.py,.js,.jsx,.ts,.tsx,.java,.cpp,.c"
            onChange={(e) => setFile(e.target.files[0] || null)}
            className="block w-full text-xs text-slate-400 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-indigo-600/20 file:text-indigo-300 hover:file:bg-indigo-600/30 cursor-pointer"
          />
          {file && (
            <p className="text-xs text-slate-400 mt-1">
              Selected: <span className="text-slate-200 font-mono">{file.name}</span> ({(file.size / 1024).toFixed(1)} KB)
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={uploading}
          className="px-5 py-2 text-xs font-bold rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {uploading ? 'Uploading Project...' : 'Upload Project Portfolio'}
        </button>
      </form>
    </div>
  )
}
