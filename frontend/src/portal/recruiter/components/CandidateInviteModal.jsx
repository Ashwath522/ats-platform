import React, { useEffect, useState } from 'react'
import { Send } from 'lucide-react'
import { Alert, Button, Field, Modal, Select, Textarea, useToast } from '../../../ui/index.jsx'
import { API } from './RecruiterPipelineKit.jsx'

/** Email a (searched) candidate a link to one of the recruiter's open jobs. */
export default function CandidateInviteModal({ open, onClose, api, candidate }) {
  const toast = useToast()
  const jobs = candidate?.invitable_jobs || []
  const [jobId, setJobId] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  useEffect(() => { if (open) { setJobId(jobs[0] ? String(jobs[0].id) : ''); setMessage(''); setErr(null) } }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  async function send() {
    if (!jobId) return setErr('Choose a job to share.')
    setBusy(true); setErr(null)
    try {
      const r = await api.post(`${API}/candidates/${candidate.candidate_id}/invite`, { job_id: Number(jobId), message: message.trim() || null })
      toast(r.message, 'success')
      onClose()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  return (
    <Modal open={open} onClose={onClose} title={`Invite ${candidate?.name || 'candidate'} to apply`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button icon={Send} loading={busy} disabled={!jobs.length} onClick={send}>Send invitation</Button></>}>
      <div className="cl-col" style={{ gap: 12 }}>
        <p className="cl-muted">We email the candidate a link to the job. Their contact details stay private — you'll see them once they apply.</p>
        {jobs.length ? (<>
          <Field label="Job"><Select value={jobId} onChange={(e) => setJobId(e.target.value)} options={jobs.map((j) => ({ value: String(j.id), label: `${j.title} (${j.code})` }))} /></Field>
          <Field label="Personal message (optional)" hint={`${message.length}/1500`}><Textarea rows={4} maxLength={1500} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Your CAD project caught our eye — we'd love you to apply." /></Field>
        </>) : <Alert tone="warn">You have no open jobs this candidate hasn't applied to. Publish a job first.</Alert>}
        {err && <Alert tone="error">{err}</Alert>}
      </div>
    </Modal>
  )
}
