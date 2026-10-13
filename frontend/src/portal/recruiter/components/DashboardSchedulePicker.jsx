import React, { useEffect, useState } from 'react'
import { CalendarDays } from 'lucide-react'
import { Alert, Button, EmptyState, Modal, SearchInput } from '../../../ui/index.jsx'
import ScheduleInterviewModal from './ScheduleInterviewModal.jsx'

/**
 * Pick one or more shortlisted applications, then hand them to the shared
 * ScheduleInterviewModal. `options`: [{application_id, candidate_name, job_title}]
 */
export default function DashboardSchedulePicker({ open, onClose, options = [], onScheduled }) {
  const [sel, setSel] = useState(new Set())
  const [q, setQ] = useState('')
  const [step, setStep] = useState('pick')
  useEffect(() => { if (open) { setSel(new Set()); setStep('pick'); setQ('') } }, [open])
  const list = options.filter((o) => !q || `${o.candidate_name} ${o.job_title}`.toLowerCase().includes(q.toLowerCase()))
  const chosen = options.filter((o) => sel.has(o.application_id))
  const toggle = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  return (
    <>
      <Modal open={open && step === 'pick'} onClose={onClose} title="Schedule interviews"
        footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button icon={CalendarDays} disabled={!chosen.length} onClick={() => setStep('schedule')}>Continue ({chosen.length})</Button></>}>
        {options.length === 0 ? (
          <EmptyState title="No shortlisted candidates" text="Shortlist applicants first — then you can schedule their interview rounds here." />
        ) : (
          <div className="cl-col" style={{ gap: 10 }}>
            <Alert>Choose the shortlisted candidates to invite. Multiple interviews are booked back-to-back.</Alert>
            <SearchInput value={q} onChange={setQ} placeholder="Filter by name or job…" />
            <div className="rp-picker" role="group" aria-label="Shortlisted candidates">
              {list.map((o) => (
                <label key={o.application_id}>
                  <input type="checkbox" className="cl-check" checked={sel.has(o.application_id)} onChange={() => toggle(o.application_id)} />
                  <span><strong>{o.candidate_name}</strong><small>{o.job_title}</small></span>
                </label>
              ))}
            </div>
          </div>
        )}
      </Modal>
      <ScheduleInterviewModal open={open && step === 'schedule'} onClose={onClose} applications={chosen} onScheduled={onScheduled} />
    </>
  )
}
