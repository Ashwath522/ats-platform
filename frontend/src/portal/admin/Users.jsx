import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  Plus, ChevronDown, UserRound, UsersRound, GraduationCap, Building2, ShieldCheck, AlertTriangle, Ban, Search, List, LayoutGrid, Settings2,
  SlidersHorizontal, Mail, Trash2, RotateCcw, KeyRound, UserCog, Eye, X,
} from 'lucide-react'
import {
  Alert, Avatar, Button, DataTable, EmptyState, Field, Input, Menu, Modal, PageHeader, Pagination, Person, Select, Tabs, cx, fmtDate, useToast,
} from '../../ui/index.jsx'
import { useApi, useQuery } from '../../ui/useApi.js'
import {
  AccountPill, ConfirmModal, DateRangePicker, FilterSelect, MiniStat, UserTypeBadge, VerificationPill, fmtNum, qs, useDebounced,
} from './components/adminKit.jsx'
import { AddUserModal, SendEmailModal } from './components/UserModals.jsx'
import UserDetailsPanel from './components/UserDetailsPanel.jsx'

const COLS_KEY = 'cl_admin_user_columns'
const ALL_COLS = [
  { key: 'type', label: 'User Type' },
  { key: 'org', label: 'College / Company' },
  { key: 'dept', label: 'Branch / Department' },
  { key: 'joined', label: 'Joined On' },
  { key: 'verification', label: 'Verification' },
  { key: 'status', label: 'Status' },
  { key: 'last_login', label: 'Last Login' },
  { key: 'phone', label: 'Phone' },
]
const DEFAULT_HIDDEN = ['last_login', 'phone']
const EMPTY_FILTERS = { user_type: '', verification: '', status: '', role: '', branch: '', college: '' }

function loadHidden() {
  try {
    const v = JSON.parse(localStorage.getItem(COLS_KEY) || 'null')
    return Array.isArray(v) ? v : DEFAULT_HIDDEN
  } catch { return DEFAULT_HIDDEN }
}

export default function AdminUsers() {
  const api = useApi('admin')
  const toast = useToast()
  const location = useLocation()
  const navigate = useNavigate()
  const params = new URLSearchParams(location.search)

  const [tab, setTab] = useState(params.get('tab') || 'all')
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [joined, setJoined] = useState({ start: '', end: '', preset: '' })
  const [q, setQ] = useState(params.get('q') || '')
  const [sort, setSort] = useState('joined_desc')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [view, setView] = useState(() => { try { return localStorage.getItem('cl_admin_user_view') || 'list' } catch { return 'list' } })
  const [hidden, setHidden] = useState(loadHidden)
  const [moreOpen, setMoreOpen] = useState(false)
  const [colsOpen, setColsOpen] = useState(false)
  const [selected, setSelected] = useState(() => new Set())
  const [detail, setDetail] = useState(params.get('user') || null)
  const [version, setVersion] = useState(0)
  const [addType, setAddType] = useState(null)
  const [confirm, setConfirm] = useState(null) // {kind, users, role}
  const [busy, setBusy] = useState(false)
  const [emailOpen, setEmailOpen] = useState(false)
  const [roleModal, setRoleModal] = useState(null) // {users}
  const [roleChoice, setRoleChoice] = useState('admin')
  const colsRef = useRef(null)

  // honour ?q= / ?user= / ?tab= when the top-bar search (or a link) changes the URL
  useEffect(() => {
    const p = new URLSearchParams(location.search)
    if (p.has('q')) setQ(p.get('q') || '')
    if (p.get('user')) setDetail(p.get('user'))
    if (p.get('tab')) setTab(p.get('tab'))
  }, [location.search])

  useEffect(() => { try { localStorage.setItem(COLS_KEY, JSON.stringify(hidden)) } catch { /* ignore */ } }, [hidden])
  useEffect(() => { try { localStorage.setItem('cl_admin_user_view', view) } catch { /* ignore */ } }, [view])
  useEffect(() => {
    if (!colsOpen) return
    const off = (e) => { if (colsRef.current && !colsRef.current.contains(e.target)) setColsOpen(false) }
    document.addEventListener('mousedown', off)
    return () => document.removeEventListener('mousedown', off)
  }, [colsOpen])

  const dq = useDebounced(q, 300)
  useEffect(() => { setPage(1) }, [tab, filters, joined.start, joined.end, dq, sort, pageSize])

  const list = useQuery(
    () => api.get(`/api/admin/portal/users${qs({ tab, ...filters, joined_from: joined.start, joined_to: joined.end, q: dq.trim(), sort, page, page_size: pageSize })}`),
    [api, tab, filters, joined.start, joined.end, dq, sort, page, pageSize, version],
  )
  const data = list.data
  const rows = data?.items || []
  const counts = data?.counts || {}
  const k = data?.kpis

  // open the first user's details on wide screens (matches the reference layout)
  const autoOpened = useRef(false)
  useEffect(() => {
    if (autoOpened.current || detail || !rows.length) return
    autoOpened.current = true
    if (window.matchMedia?.('(min-width: 1181px)').matches) setDetail(rows[0].id)
  }, [rows, detail])

  const refresh = useCallback(() => { setVersion((v) => v + 1) }, [])
  const setF = (key) => (v) => setFilters((f) => ({ ...f, [key]: v }))
  const activeFilterCount = Object.values(filters).filter(Boolean).length + (joined.start ? 1 : 0)

  /* ── actions ─────────────────────────────────────────────────────── */
  const callAction = async (u, action, extra = {}) => api.post(`/api/admin/portal/users/${u.id}/actions`, { action, ...extra })

  const onAction = (action, u) => {
    if (action === 'view') return setDetail(u.id)
    if (action === 'verify') {
      return callAction(u, 'verify').then(() => { toast(`${u.name} marked as verified`, 'success'); refresh() }).catch((e) => toast(e.message, 'error'))
    }
    if (action === 'reactivate') {
      return callAction(u, 'reactivate').then(() => { toast(`${u.name} reactivated`, 'success'); refresh() }).catch((e) => toast(e.message, 'error'))
    }
    if (action === 'change_role') { setRoleChoice(u.type === 'admin' ? 'recruiter' : 'admin'); return setRoleModal({ users: [u] }) }
    setConfirm({ kind: action, users: [u] })
  }

  const runConfirm = async () => {
    const { kind, users } = confirm
    setBusy(true)
    try {
      if (users.length === 1 && kind !== 'bulk_verify') {
        const u = users[0]
        if (kind === 'delete') {
          await api.del(`/api/admin/portal/users/${u.id}`)
          toast(`${u.name} deleted`, 'success')
          if (detail === u.id) setDetail(null)
        } else if (kind === 'reset_password') {
          const res = await callAction(u, 'reset_password')
          if (res.email_sent) toast(`Password reset email sent to ${res.to}`, 'success')
          else if (res.dev_only?.reset_token) toast(`Email not configured — dev reset token: ${res.dev_only.reset_token}`, 'info')
          else toast(res.warning || 'Reset token created but the email could not be sent', 'error')
        } else {
          await callAction(u, kind)
          toast(`${u.name} ${kind === 'suspend' ? 'suspended' : 'updated'}`, 'success')
        }
      } else {
        const action = kind === 'bulk_verify' ? 'verify' : kind
        const res = await api.post('/api/admin/portal/users/bulk', { ids: users.map((u) => u.id), action })
        reportBulk(res, action)
        setSelected(new Set())
        if (action === 'delete' && users.some((u) => u.id === detail)) setDetail(null)
      }
      setConfirm(null)
      refresh()
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const reportBulk = (res, action) => {
    const verb = { verify: 'verified', suspend: 'suspended', reactivate: 'reactivated', delete: 'deleted', change_role: 'updated', email: 'emailed' }[action] || 'updated'
    if (res.ok.length) toast(`${res.ok.length} user${res.ok.length === 1 ? '' : 's'} ${verb}`, 'success')
    if (res.failed.length) toast(`${res.failed.length} skipped: ${res.failed.slice(0, 2).map((f) => `${f.id} — ${f.error}`).join('; ')}`, 'error')
  }

  const runRole = async () => {
    setBusy(true)
    try {
      const users = roleModal.users
      if (users.length === 1) {
        await callAction(users[0], 'change_role', { role: roleChoice })
        toast(`${users[0].name} is now ${roleChoice === 'admin' ? 'an admin' : 'a recruiter'}`, 'success')
      } else {
        const res = await api.post('/api/admin/portal/users/bulk', { ids: users.map((u) => u.id), action: 'change_role', role: roleChoice })
        reportBulk(res, 'change_role')
        setSelected(new Set())
      }
      setRoleModal(null)
      refresh()
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const sendBulkEmail = async ({ subject, body }) => {
    setBusy(true)
    try {
      const res = await api.post('/api/admin/portal/users/bulk', { ids: [...selected], action: 'email', subject, body })
      reportBulk(res, 'email')
      setEmailOpen(false)
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const selectedUsers = useMemo(() => {
    const byId = new Map(rows.map((r) => [r.id, r]))
    return [...selected].map((id) => byId.get(id) || { id, name: id })
  }, [selected, rows])
  const selStaff = selectedUsers.filter((u) => u.type === 'recruiter' || u.type === 'admin')

  /* ── table columns ───────────────────────────────────────────────── */
  const kebab = (u) => {
    if (u.id.startsWith('r-')) return [{ label: 'Review in Moderation', icon: ShieldCheck, to: '/admin/moderation?tab=requests' }]
    return [
      { label: 'View details', icon: Eye, onClick: () => onAction('view', u) },
      u.verification !== 'verified' && { label: 'Verify', icon: ShieldCheck, onClick: () => onAction('verify', u) },
      u.status === 'suspended'
        ? { label: 'Reactivate', icon: RotateCcw, onClick: () => onAction('reactivate', u) }
        : { label: 'Suspend', icon: Ban, onClick: () => onAction('suspend', u) },
      { label: 'Reset password', icon: KeyRound, onClick: () => onAction('reset_password', u) },
      (u.type === 'recruiter' || u.type === 'admin') && { label: u.type === 'admin' ? 'Change role to Recruiter' : 'Change role to Admin', icon: UserCog, onClick: () => onAction('change_role', u) },
      { label: 'Delete', icon: Trash2, danger: true, onClick: () => onAction('delete', u) },
    ]
  }
  const columns = [
    { key: 'user', header: 'User', render: (u) => <Person name={u.name} sub={u.email || '—'} src={u.avatar} size={38} /> },
    { key: 'type', header: 'User Type', render: (u) => <UserTypeBadge type={u.type} /> },
    { key: 'org', header: 'College / Company', render: (u) => <span className="adm-cell2">{u.org || '—'}</span> },
    { key: 'dept', header: 'Branch / Department', render: (u) => <span className="adm-cell2">{u.dept || '—'}</span>, hideOnMobile: true },
    { key: 'joined', header: 'Joined On', render: (u) => <span style={{ whiteSpace: 'nowrap' }}>{fmtDate(u.joined)}</span> },
    { key: 'verification', header: 'Verification', render: (u) => <VerificationPill value={u.verification} /> },
    { key: 'status', header: 'Status', render: (u) => <AccountPill value={u.status} /> },
    { key: 'last_login', header: 'Last Login', render: (u) => (u.last_login ? fmtDate(u.last_login) : 'Never') },
    { key: 'phone', header: 'Phone', render: (u) => u.phone || '—' },
    {
      key: 'actions', header: 'Actions', render: (u) => (
        <span className="adm-actions" onClick={(e) => e.stopPropagation()}>
          <Button size="sm" variant="outline" onClick={() => onAction('view', u)}>View</Button>
          <Menu items={kebab(u)} label={`More actions for ${u.name}`} />
        </span>
      ),
    },
  ].filter((c) => !hidden.includes(c.key))

  const tabs = [
    { id: 'all', label: 'All Users', count: counts.all },
    { id: 'candidates', label: 'Candidates', count: counts.candidates },
    { id: 'recruiters', label: 'Recruiters', count: counts.recruiters },
    { id: 'admins', label: 'Admins', count: counts.admins },
    { id: 'pending', label: 'Pending', count: counts.pending },
    { id: 'suspended', label: 'Suspended', count: counts.suspended },
  ]
  const facets = data?.facets || { branches: [], colleges: [] }

  const confirmText = confirm && {
    suspend: { title: `Suspend ${confirm.users.length > 1 ? `${confirm.users.length} users` : confirm.users[0].name}?`, text: 'Suspended users are signed out immediately and cannot log in until reactivated. Their data is kept.', label: 'Suspend', danger: true },
    delete: { title: `Delete ${confirm.users.length > 1 ? `${confirm.users.length} users` : confirm.users[0].name}?`, text: 'This permanently deletes the account. For students this removes their profile, applications, projects, interviews and offers (right-to-be-forgotten); the audit trail is kept without personal links. Recruiters who own job postings cannot be deleted — suspend them instead. This cannot be undone.', label: 'Delete permanently', danger: true, require: 'DELETE' },
    reset_password: { title: `Send a password reset to ${confirm.users[0].name}?`, text: `A reset code valid for 15 minutes will be emailed to ${confirm.users[0].email || 'their email address'}. Their current password keeps working until they reset it.`, label: 'Send reset email' },
    bulk_verify: { title: `Verify ${confirm.users.length} user${confirm.users.length === 1 ? '' : 's'}?`, text: 'Marks the selected accounts as verified by an administrator. This is recorded in the audit log.', label: 'Verify users' },
  }[confirm.kind]

  return (
    <div className="adm-page">
      <PageHeader
        title="User Management"
        subtitle="Manage all platform users including candidates, recruiters, and admins. View, verify, update, or restrict access."
        actions={(
          <Menu items={[
            { label: 'Add Recruiter', icon: Building2, onClick: () => setAddType('recruiter') },
            { label: 'Add Admin', icon: ShieldCheck, onClick: () => setAddType('admin') },
            { label: 'Add Candidate', icon: GraduationCap, onClick: () => setAddType('candidate') },
          ]}>
            <Button size="lg" icon={Plus} iconRight={ChevronDown} aria-haspopup="menu">Add New User</Button>
          </Menu>
        )}
      />

      <div className={cx('adm-users', !detail && 'no-panel')} style={!detail ? { gridTemplateColumns: 'minmax(0, 1fr)' } : undefined}>
        <div className="adm-users-main">
          <div className="adm-mini-grid">
            <MiniStat icon={UsersRound} value={k ? fmtNum(k.total) : '…'} label="Total Users" active={tab === 'all'} onClick={() => setTab('all')} />
            <MiniStat icon={GraduationCap} value={k ? fmtNum(k.candidates) : '…'} label="Candidates" sub={k && `${k.candidates_pct}% of total`} active={tab === 'candidates'} onClick={() => setTab('candidates')} />
            <MiniStat icon={Building2} tone="purple" value={k ? fmtNum(k.recruiters) : '…'} label="Recruiters" sub={k && `${k.recruiters_pct}% of total`} active={tab === 'recruiters'} onClick={() => setTab('recruiters')} />
            <MiniStat icon={ShieldCheck} tone="green" value={k ? fmtNum(k.verified) : '…'} label="Verified Users" sub={k && `${k.verified_pct_active}% of active`} onClick={() => { setFilters((f) => ({ ...f, verification: 'verified' })); setTab('all') }} />
            <MiniStat icon={AlertTriangle} tone="amber" value={k ? fmtNum(k.pending) : '…'} label="Pending Verification" sub={k && `${k.pending_pct}% of total`} active={tab === 'pending'} onClick={() => setTab('pending')} />
            <MiniStat icon={Ban} tone="red" value={k ? fmtNum(k.suspended) : '…'} label="Suspended Users" sub={k && `${k.suspended_pct}% of total`} active={tab === 'suspended'} onClick={() => setTab('suspended')} />
          </div>

          <div className="cl-card adm-listcard">
            <Tabs tabs={tabs} value={tab} onChange={setTab} />
            <div className="adm-filterbar">
              <FilterSelect label="All User Types" value={filters.user_type} onChange={setF('user_type')} options={[{ value: 'candidate', label: 'Candidates' }, { value: 'recruiter', label: 'Recruiters' }, { value: 'admin', label: 'Admins' }]} />
              <FilterSelect label="All Verification Status" value={filters.verification} onChange={setF('verification')} options={[{ value: 'verified', label: 'Verified' }, { value: 'pending', label: 'Pending' }]} />
              <FilterSelect label="All Account Status" value={filters.status} onChange={setF('status')} options={[{ value: 'active', label: 'Active' }, { value: 'suspended', label: 'Suspended' }, { value: 'awaiting_approval', label: 'Awaiting approval' }]} />
              <FilterSelect label="All Roles" value={filters.role} onChange={setF('role')} options={[{ value: 'student', label: 'Student' }, { value: 'recruiter', label: 'Recruiter' }, { value: 'company_owner', label: 'Company owner' }, { value: 'admin', label: 'Super Admin' }]} />
              <DateRangePicker compact align="left" allowClear placeholder="Joined: any date" ariaLabel="Joined date range" value={joined} onChange={setJoined} />
              <Button variant="outline" icon={SlidersHorizontal} onClick={() => setMoreOpen((o) => !o)} aria-expanded={moreOpen}>More Filters{filters.branch || filters.college ? ' •' : ''}</Button>
            </div>
            {moreOpen && (
              <div className="adm-more">
                <FilterSelect label="Any branch" value={filters.branch} onChange={setF('branch')} options={facets.branches.map((b) => ({ value: b.id, label: b.label }))} />
                <Field label="College contains"><Input value={filters.college} onChange={(e) => setF('college')(e.target.value)} placeholder="e.g. NIT" maxLength={100} /></Field>
                <div className="cl-row" style={{ alignItems: 'flex-end' }}>
                  <Button variant="ghost" icon={X} disabled={!activeFilterCount} onClick={() => { setFilters(EMPTY_FILTERS); setJoined({ start: '', end: '', preset: '' }) }}>Clear all filters</Button>
                </div>
              </div>
            )}
            <div className="adm-toolbar">
              <Input icon={Search} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, email, college, company…" aria-label="Search users" maxLength={100} />
              <label className="adm-sort">Sort by:
                <select className="cl-select" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort users">
                  <option value="joined_desc">Joined Date (Newest)</option>
                  <option value="joined_asc">Joined Date (Oldest)</option>
                  <option value="name_asc">Name (A–Z)</option>
                  <option value="name_desc">Name (Z–A)</option>
                </select>
              </label>
              <div className="adm-viewtoggle" role="group" aria-label="View">
                <button type="button" className={view === 'list' ? 'active' : ''} aria-pressed={view === 'list'} aria-label="List view" onClick={() => setView('list')}><List size={18} /></button>
                <button type="button" className={view === 'grid' ? 'active' : ''} aria-pressed={view === 'grid'} aria-label="Grid view" onClick={() => setView('grid')}><LayoutGrid size={18} /></button>
              </div>
              <div className="cl-menu" ref={colsRef}>
                <button type="button" className="cl-icon-btn boxed" style={{ width: 40, height: 40 }} aria-label="Column settings" aria-expanded={colsOpen} onClick={() => setColsOpen((o) => !o)}><Settings2 size={18} /></button>
                {colsOpen && (
                  <div className="cl-menu-pop" role="dialog" aria-label="Show or hide columns" style={{ padding: 10, minWidth: 220 }}>
                    <strong style={{ display: 'block', fontSize: 13, padding: '2px 4px 8px' }}>Show columns</strong>
                    {ALL_COLS.map((c) => (
                      <label key={c.key} className="cl-row" style={{ gap: 8, padding: '6px 4px', fontSize: 13.5, cursor: 'pointer' }}>
                        <input type="checkbox" className="cl-check" checked={!hidden.includes(c.key)} onChange={() => setHidden((h) => (h.includes(c.key) ? h.filter((x) => x !== c.key) : [...h, c.key]))} />
                        {c.label}
                      </label>
                    ))}
                    <button type="button" className="cl-link" style={{ padding: '6px 4px' }} onClick={() => setHidden(DEFAULT_HIDDEN)}>Reset to default</button>
                  </div>
                )}
              </div>
            </div>

            {list.error && <Alert tone="error">Could not load users: {list.error.message} <button type="button" className="cl-link" onClick={list.reload}>Retry</button></Alert>}

            {view === 'list' ? (
              <div className="adm-users-table">
                <DataTable columns={columns} rows={rows} loading={list.loading && !data} selectable selected={selected} onSelect={setSelected}
                  onRowClick={(u) => setDetail(u.id)}
                  empty={<EmptyState icon={UserRound} title="No users match these filters" text="Try clearing filters or searching for a different name." />} />
              </div>
            ) : (
              <>
                {!rows.length && !list.loading && <EmptyState icon={UserRound} title="No users match these filters" />}
                <div className="adm-cards">
                  {rows.map((u) => (
                    <div key={u.id} className={cx('cl-card adm-ucard', (detail === u.id || selected.has(u.id)) && 'selected')} onClick={() => setDetail(u.id)}
                      role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setDetail(u.id)}>
                      <input type="checkbox" className="cl-check" aria-label={`Select ${u.name}`} checked={selected.has(u.id)} onClick={(e) => e.stopPropagation()}
                        onChange={() => setSelected((s) => { const n = new Set(s); n.has(u.id) ? n.delete(u.id) : n.add(u.id); return n })} />
                      <div className="cl-row"><Avatar name={u.name} src={u.avatar} size={44} /><div style={{ minWidth: 0 }}><strong className="cl-ellipsis" style={{ display: 'block', color: 'var(--cl-ink)' }}>{u.name}</strong><small className="cl-muted cl-ellipsis" style={{ display: 'block' }}>{u.email || '—'}</small></div></div>
                      <div className="cl-row cl-wrap" style={{ gap: 6 }}><UserTypeBadge type={u.type} /><VerificationPill value={u.verification} /><AccountPill value={u.status} /></div>
                      <div className="adm-ucard-meta"><span>{u.org || '—'}</span><span>{u.dept || '—'}</span><span>Joined {fmtDate(u.joined)}</span></div>
                      <div className="cl-row" onClick={(e) => e.stopPropagation()}><Button size="sm" variant="outline" onClick={() => setDetail(u.id)}>View</Button><span className="cl-grow" /><Menu items={kebab(u)} label={`More actions for ${u.name}`} /></div>
                    </div>
                  ))}
                </div>
              </>
            )}
            <Pagination page={page} pages={Math.max(1, Math.ceil((data?.total || 0) / pageSize))} total={data?.total || 0} pageSize={pageSize} setPage={setPage} setPageSize={setPageSize} noun="users" />
          </div>

          <div className="cl-card adm-bulk" aria-label="Bulk actions">
            <div className="adm-bulk-title"><strong>Bulk Actions</strong><span>{selected.size} user{selected.size === 1 ? '' : 's'} selected{selected.size ? <> · <button type="button" className="cl-link" onClick={() => setSelected(new Set())}>Clear</button></> : null}</span></div>
            <Button variant="secondary" icon={ShieldCheck} disabled={!selected.size} onClick={() => setConfirm({ kind: 'bulk_verify', users: selectedUsers })}>Verify Users</Button>
            <Button variant="secondary" icon={Mail} disabled={!selected.size} onClick={() => setEmailOpen(true)}>Send Email</Button>
            <Button variant="secondary" icon={UserCog} iconRight={ChevronDown} disabled={!selStaff.length} title={selected.size && !selStaff.length ? 'Only recruiter and admin roles can be changed' : undefined}
              onClick={() => { setRoleChoice('admin'); setRoleModal({ users: selStaff }) }}>Change Role</Button>
            {tab === 'suspended'
              ? <Button variant="secondary" icon={RotateCcw} disabled={!selected.size} onClick={() => api.post('/api/admin/portal/users/bulk', { ids: [...selected], action: 'reactivate' }).then((r) => { reportBulk(r, 'reactivate'); setSelected(new Set()); refresh() }).catch((e) => toast(e.message, 'error'))}>Reactivate</Button>
              : <Button variant="secondary" icon={Ban} disabled={!selected.size} onClick={() => setConfirm({ kind: 'suspend', users: selectedUsers })}>Suspend User</Button>}
            <Button variant="danger" icon={Trash2} disabled={!selected.size} onClick={() => setConfirm({ kind: 'delete', users: selectedUsers })}>Delete Users</Button>
          </div>
        </div>

        {detail && <UserDetailsPanel uid={detail} api={api} version={version} onClose={() => { setDetail(null); if (params.get('user')) navigate('/admin/users', { replace: true }) }} onAction={onAction} onChanged={refresh} />}
      </div>

      <AddUserModal open={!!addType} type={addType} api={api} onClose={() => setAddType(null)} onCreated={(u) => { refresh(); if (u?.id) setDetail(u.id) }} />
      <SendEmailModal open={emailOpen} count={selected.size} busy={busy} onClose={() => setEmailOpen(false)} onSend={sendBulkEmail} />
      <ConfirmModal open={!!confirm} title={confirmText?.title} text={confirmText?.text} confirmLabel={confirmText?.label} danger={confirmText?.danger}
        requireText={confirmText?.require} busy={busy} onConfirm={runConfirm} onClose={() => setConfirm(null)}>
        {confirm && confirm.users.length > 1 && <p style={{ fontSize: 13 }}>{confirm.users.slice(0, 6).map((u) => u.name).join(', ')}{confirm.users.length > 6 ? ` and ${confirm.users.length - 6} more` : ''}</p>}
      </ConfirmModal>
      <Modal open={!!roleModal} onClose={() => setRoleModal(null)} title="Change role"
        footer={<><Button variant="secondary" onClick={() => setRoleModal(null)}>Cancel</Button><Button loading={busy} onClick={runRole}>Change role</Button></>}>
        <div className="cl-stack" style={{ gap: 12 }}>
          <p className="cl-muted" style={{ fontSize: 13.5 }}>
            {roleModal?.users.length === 1 ? `${roleModal.users[0].name} is currently ${roleModal.users[0].type === 'admin' ? 'an admin' : 'a recruiter'}.` : `${roleModal?.users.length} staff accounts selected.`}{' '}
            Only recruiter ↔ admin changes are allowed; you cannot change your own role or demote the last admin. The user is signed out and must log in again.
          </p>
          <Field label="New role"><Select value={roleChoice} onChange={(e) => setRoleChoice(e.target.value)} options={[{ value: 'recruiter', label: 'Recruiter' }, { value: 'admin', label: 'Admin' }]} /></Field>
        </div>
      </Modal>
    </div>
  )
}
