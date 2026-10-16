/**
 * Admin: create / refresh / remove the 20 fictional DEMO companies (recruiter
 * logins + open jobs for testing). New passwords are returned by the API only
 * once — they are shown here and can be downloaded as CSV, never stored in
 * plain text.
 */
import React, { useState } from 'react'
import { Download, FlaskConical, KeyRound, RefreshCw, Trash2 } from 'lucide-react'
import { Alert, Button, Card, Skeleton, downloadCsv, useToast } from '../../../ui/index.jsx'
import { useApi, useQuery } from '../../../ui/useApi.js'
import { DemoBadge } from '../../shared/companies.jsx'
import { ConfirmModal, MiniStat, fmtNum } from './adminKit.jsx'
import '../../shared/companies.css'

export default function DemoCompaniesCard() {
  const api = useApi('admin')
  const toast = useToast()
  const st = useQuery(() => api.get('/api/admin/demo/companies'), [api])
  const [busy, setBusy] = useState(null)
  const [result, setResult] = useState(null)
  const [confirm, setConfirm] = useState(false)
  const s = st.data

  const create = async () => {
    setBusy('create')
    try {
      const r = await api.post('/api/admin/demo/companies')
      setResult(r)
      toast(r.accounts_created ? `${r.companies} demo companies ready — ${r.accounts_created} new login${r.accounts_created === 1 ? '' : 's'}` : `${r.companies} demo companies refreshed`, 'success')
      st.reload()
    } catch (e) { toast(e.message, 'error') } finally { setBusy(null) }
  }
  const remove = async () => {
    setBusy('remove')
    try {
      const r = await api.del('/api/admin/demo/companies')
      setResult(null)
      setConfirm(false)
      toast(`Removed ${r.companies} demo companies, ${r.jobs} jobs and ${r.applications} application${r.applications === 1 ? '' : 's'}`, 'success')
      st.reload()
    } catch (e) { toast(e.message, 'error') } finally { setBusy(null) }
  }
  const newLogins = (result?.logins || []).filter((l) => l.password)
  const csv = () => downloadCsv('corelink-demo-recruiter-logins.csv',
    (result?.logins || []).map((l) => ({ company: l.company, email: l.email, password: l.password || '(unchanged — existing account)', jobs: l.jobs })),
    ['company', 'email', 'password', 'jobs'])

  return (
    <Card title={<><FlaskConical size={18} />Demo companies <DemoBadge compact /></>}
      subtitle="20 clearly fictional core-engineering companies, each with a recruiter login and 3–4 open jobs/internships, for testing the student and recruiter flows. Students see them with a “Demo” tag."
      action={<div className="cl-row cl-wrap" style={{ gap: 8 }}>
        <Button icon={s?.companies ? RefreshCw : FlaskConical} loading={busy === 'create'} disabled={!!busy} onClick={create}>{s?.companies ? 'Refresh demo companies' : 'Create demo companies'}</Button>
        <Button variant="danger" icon={Trash2} disabled={!!busy || !s?.companies} onClick={() => setConfirm(true)}>Remove demo data</Button>
      </div>}>
      {st.error && <Alert tone="error">{st.error.message}</Alert>}
      {!s && !st.error ? <Skeleton h={70} /> : s && (
        <div className="adm-mini-grid adm-mini-4" style={{ marginBottom: result ? 14 : 0 }}>
          <MiniStat icon={FlaskConical} tone="amber" value={fmtNum(s.companies)} label="Demo companies" />
          <MiniStat icon={KeyRound} tone="purple" value={fmtNum(s.recruiters)} label="Recruiter logins" />
          <MiniStat icon={RefreshCw} tone="teal" value={fmtNum(s.jobs)} label="Demo jobs" />
          <MiniStat icon={Download} tone="green" value={fmtNum(s.applications)} label="Applications to demo jobs" />
        </div>
      )}
      {result && (
        <div className="cl-stack" style={{ gap: 10 }}>
          {newLogins.length > 0
            ? <Alert tone="warn" icon={KeyRound}><b>Copy or download these passwords now — they are shown only once.</b> Only a secure hash is stored; refreshing later keeps existing passwords and will not show them again.</Alert>
            : <Alert>All demo accounts already existed, so no new passwords were generated (existing passwords are unchanged). Remove the demo data and create it again to get fresh logins.</Alert>}
          <div className="cl-row" style={{ justifyContent: 'space-between' }}>
            <small className="cl-muted">Recruiter login page: <code>/recruiter/login</code></small>
            <Button size="sm" variant="outline" icon={Download} onClick={csv}>Download CSV</Button>
          </div>
          <div className="co-logins">
            <table>
              <thead><tr><th>Company</th><th>Recruiter email</th><th>Password</th><th>Jobs</th></tr></thead>
              <tbody>
                {result.logins.map((l) => (
                  <tr key={l.email}>
                    <td data-label="Company">{l.company}</td>
                    <td data-label="Email"><code>{l.email}</code></td>
                    <td data-label="Password">{l.password ? <code>{l.password}</code> : <span className="cl-muted">unchanged</span>}</td>
                    <td data-label="Jobs">{l.jobs}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <ConfirmModal open={confirm} danger title="Remove all demo data?" confirmLabel="Remove demo data" busy={busy === 'remove'}
        text="This deletes the 20 demo companies, their recruiter accounts and jobs, and every application, interview, offer and saved job on those jobs. Real companies and jobs are not touched."
        requireText="DELETE" onConfirm={remove} onClose={() => setConfirm(false)} />
    </Card>
  )
}
