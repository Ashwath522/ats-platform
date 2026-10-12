/** Certifications list + add/edit modal (existing /api/candidate/profile/certifications endpoints). */
import React, { useState } from 'react'
import { Award, ExternalLink, FileText, Pencil, Plus, Trash2 } from 'lucide-react'
import { Button, EmptyState, Field, IconButton, Input, Menu, Modal, useToast } from '../../../ui/index.jsx'
import { useApi } from '../../../ui/useApi.js'
import { mediaUrl } from '../../../lib/api.js'
import { useStudent } from '../StudentShell.jsx'

const fmtIssued = (d) => {
  if (!d) return ''
  const x = new Date(d)
  return Number.isNaN(x.getTime()) ? d : x.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
}

export function CertModal({ open, onClose, initial, editIndex }) {
  const api = useApi('candidate')
  const toast = useToast()
  const { setProfile } = useStudent()
  const [f, setF] = useState({})
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState({})
  React.useEffect(() => { if (open) { setF({ name: '', issuing_organization: '', issue_date: '', credential_url: '', ...(initial || {}) }); setFile(null); setErr({}) } }, [open, initial])
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))
  const submit = async () => {
    const e = {}
    if (!f.name?.trim()) e.name = 'Required'
    if (!f.issuing_organization?.trim()) e.issuing_organization = 'Required'
    if (f.credential_url && !/^https?:\/\//i.test(f.credential_url)) e.credential_url = 'Must start with http:// or https://'
    if (file && file.size > 10 * 1024 * 1024) e.file = 'Max 10 MB'
    setErr(e)
    if (Object.keys(e).length) return
    const fd = new FormData()
    fd.append('name', f.name.trim())
    fd.append('issuing_organization', f.issuing_organization.trim())
    if (f.issue_date) fd.append('issue_date', f.issue_date)
    if (f.credential_url) fd.append('credential_url', f.credential_url.trim())
    if (file) fd.append('file', file)
    setBusy(true)
    try {
      let p = await api.post('/api/candidate/profile/certifications', fd)
      if (editIndex != null) p = await api.del(`/api/candidate/profile/certifications/${editIndex}`)
      setProfile(p)
      toast(editIndex != null ? 'Certification updated' : 'Certification added', 'success')
      onClose()
    } catch (x) { toast(x.message, 'error') } finally { setBusy(false) }
  }
  return (
    <Modal open={open} onClose={onClose} title={editIndex != null ? 'Edit certification' : 'Add certification'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={submit}>Save</Button></>}>
      <div className="cl-grid cl-grid-2">
        <Field label="Certification / course *" error={err.name} className="span-2"><Input value={f.name || ''} onChange={set('name')} maxLength={120} placeholder="e.g. SolidWorks Associate (CSWA)" /></Field>
        <Field label="Issued by *" error={err.issuing_organization}><Input value={f.issuing_organization || ''} onChange={set('issuing_organization')} maxLength={100} placeholder="e.g. Dassault Systèmes / NPTEL" /></Field>
        <Field label="Issue date"><Input type="date" value={f.issue_date || ''} onChange={set('issue_date')} /></Field>
        <Field label="Credential URL" error={err.credential_url} className="span-2"><Input value={f.credential_url || ''} onChange={set('credential_url')} placeholder="https://…" /></Field>
        <Field label="Certificate file (PDF/PNG/JPG, optional)" error={err.file} className="span-2"><input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" onChange={(e) => setFile(e.target.files?.[0] || null)} /></Field>
      </div>
    </Modal>
  )
}

export function CertificationsList({ certs = [], compact }) {
  const api = useApi('candidate')
  const toast = useToast()
  const { setProfile } = useStudent()
  const [edit, setEdit] = useState(null)
  const remove = async (i) => {
    if (!window.confirm('Remove this certification?')) return
    try { setProfile(await api.del(`/api/candidate/profile/certifications/${i}`)); toast('Certification removed', 'success') } catch (e) { toast(e.message, 'error') }
  }
  return (
    <>
      {certs.length === 0 ? <EmptyState icon={Award} title="No certifications yet" text="Add courses and certifications related to your branch." action={<Button size="sm" icon={Plus} onClick={() => setEdit({ index: null })}>Add Certification</Button>} />
        : (
          <div className="cl-list">
            {certs.map((c, i) => (
              <div key={`${c.name}-${i}`} className="cl-list-item">
                <span className="cl-ico red"><Award size={19} /></span>
                <div className="cl-grow">
                  <strong style={{ color: 'var(--cl-ink)', display: 'block' }}>{c.name}</strong>
                  <small className="cl-muted">{c.issuing_organization}</small>
                </div>
                {!compact && c.issue_date && <span className="cl-muted st-hide-m" style={{ fontSize: 13 }}>Issued {fmtIssued(c.issue_date)}</span>}
                <IconButton icon={Pencil} label={`Edit ${c.name}`} onClick={() => setEdit({ index: i, initial: { name: c.name, issuing_organization: c.issuing_organization, issue_date: c.issue_date || '', credential_url: c.credential_url || '' } })} />
                <Menu label={`More for ${c.name}`} items={[
                  c.credential_url && { label: 'Open credential', icon: ExternalLink, onClick: () => window.open(c.credential_url, '_blank', 'noopener') },
                  c.file_path && { label: 'View certificate file', icon: FileText, onClick: () => window.open(mediaUrl(c.file_path), '_blank', 'noopener') },
                  { label: 'Remove', icon: Trash2, danger: true, onClick: () => remove(i) },
                ]} />
              </div>
            ))}
          </div>
        )}
      <CertModal open={!!edit} onClose={() => setEdit(null)} initial={edit?.initial} editIndex={edit?.index ?? null} />
    </>
  )
}

export function useCertModal() {
  const [open, setOpen] = useState(false)
  return { open, show: () => setOpen(true), modal: <CertModal open={open} onClose={() => setOpen(false)} editIndex={null} /> }
}
