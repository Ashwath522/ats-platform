import React, { useCallback, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  BadgeCheck, Briefcase, Building2, Calendar, Camera, ChevronRight, Compass, Eye, Factory, Gem, Globe, ImagePlus, Link2, MapPin, Pencil,
  Target, Trash2, UserPlus, Users,
} from 'lucide-react'
import {
  Alert, Avatar, Badge, Button, Card, EmptyState, LogoTile, Modal, PageHeader, Skeleton, Tabs, ViewAll, useToast,
} from '../../ui/index.jsx'
import { useApi, useQuery } from '../../ui/useApi.js'
import { mediaUrl } from '../../lib/api.js'
import { useRecruiter } from './RecruiterShell.jsx'
import { FilePick, H } from './components/HiringCommon.jsx'
import { AddMemberModal, TeamTable } from './components/CompanyTeam.jsx'
import {
  BenefitsEditor, DetailsEditor, GalleryEditor, HiringEditor, LocationsEditor, ProfileSettings,
} from './components/CompanyEditors.jsx'

const TABS = [
  { id: 'overview', label: 'Overview' }, { id: 'details', label: 'Company Details' }, { id: 'locations', label: 'Locations' },
  { id: 'hiring', label: 'Hiring & Roles' }, { id: 'team', label: 'Team' }, { id: 'media', label: 'Media & Gallery' },
  { id: 'benefits', label: 'Benefits' }, { id: 'settings', label: 'Settings' },
]
const HL_ICONS = [Users, Building2, Calendar, Factory]
const HL_TONES = ['', '', 'purple', 'teal']
const MAX_IMG = 5 * 1024 * 1024

function Identity({ c, onUpload, onRemoveCover, busy }) {
  return (
    <section className="cl-card flush" style={{ overflow: 'hidden' }}>
      <div className="hr-cover">
        {c.cover_url && <img src={mediaUrl(c.cover_url)} alt={`${c.name} cover`} />}
        <div style={{ position: 'absolute', right: 12, bottom: 12, zIndex: 2, display: 'flex', gap: 8 }}>
          {c.cover_url && <button type="button" className="hr-cover-btn" style={{ position: 'static' }} onClick={onRemoveCover}><Trash2 size={14} /> Remove</button>}
          <FilePick onFile={(f) => onUpload('cover', f)}>{(open) => <button type="button" className="hr-cover-btn" style={{ position: 'static' }} onClick={open} disabled={busy === 'cover'}><Camera size={14} />{busy === 'cover' ? 'Uploading…' : 'Change Cover Photo'}</button>}</FilePick>
        </div>
      </div>
      <div className="hr-co-id">
        <div className="hr-co-logo">
          {c.logo_url ? <img src={mediaUrl(c.logo_url)} alt={`${c.name} logo`} /> : <LogoTile name={c.name} size={72} />}
          <FilePick onFile={(f) => onUpload('logo', f)}>{(open) => <button type="button" className="hr-co-logo-btn" onClick={open} aria-label="Upload company logo" title="Upload logo" disabled={busy === 'logo'}><Camera size={15} /></button>}</FilePick>
        </div>
        <div className="hr-co-name">
          <h2>{c.name}{c.verified && <BadgeCheck size={22} color="#2563eb" aria-label="Verified company" />}</h2>
          {c.tagline && <span className="tag">{c.tagline}</span>}
          <div className="hr-co-meta">
            {(c.industries || []).length > 0 && <span><Building2 size={15} />{c.industries.join('  |  ')}</span>}
          </div>
          <div className="hr-co-meta">
            {c.location_text && <span><MapPin size={15} />{c.location_text}</span>}
            {c.website && <a href={c.website} target="_blank" rel="noreferrer"><Globe size={15} />{c.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}</a>}
            {c.linkedin && <a href={c.linkedin} target="_blank" rel="noreferrer"><Link2 size={15} />LinkedIn</a>}
          </div>
        </div>
      </div>
    </section>
  )
}

function Highlights({ c }) {
  const custom = (c.highlights || []).slice(0, 3)
  const derived = custom.length ? custom : [
    c.size && { value: c.size.replace(/\s*employees/i, ''), label: 'Employees' },
    { value: String((c.locations || []).length || (c.location_text ? 1 : 0)), label: 'Office Locations' },
    c.founded && { value: c.founded, label: 'Founded' },
  ].filter(Boolean)
  const tiles = [...derived.slice(0, 3), { value: String(c.open_positions ?? 0), label: 'Open Positions', live: true }]
  return (
    <div className="hr-hl">
      {tiles.map((t, i) => {
        const I = t.live ? Briefcase : HL_ICONS[i]
        return (
          <div className="hr-hl-tile" key={`${t.label}-${i}`}>
            <span className={`cl-ico ${t.live ? 'green' : HL_TONES[i]}`}><I size={20} /></span>
            <div style={{ minWidth: 0 }}><strong>{t.value}</strong><small>{t.label}</small></div>
          </div>
        )
      })}
    </div>
  )
}

function PublicPreview({ c, open, onClose }) {
  if (!open) return null
  return (
    <Modal open onClose={onClose} size="lg" title="Public profile preview">
      <p className="hr-sub" style={{ marginBottom: 12 }}>This is how students see your company on job pages{c.preferences?.public_profile === false ? ' — currently hidden (Settings tab)' : ''}.</p>
      <div className="hr-public">
        <div className="hr-cover" style={{ height: 120 }}>{c.cover_url && <img src={mediaUrl(c.cover_url)} alt="" />}</div>
        <div className="hr-co-id">
          <div className="hr-co-logo" style={{ width: 96, height: 88 }}>{c.logo_url ? <img src={mediaUrl(c.logo_url)} alt="" /> : <LogoTile name={c.name} size={56} />}</div>
          <div className="hr-co-name"><h2 style={{ fontSize: 20 }}>{c.name}{c.verified && <BadgeCheck size={18} color="#2563eb" />}</h2>{c.tagline && <span className="tag">{c.tagline}</span>}</div>
        </div>
        <div className="cl-col" style={{ padding: '0 20px 20px', gap: 14 }}>
          {c.about && <p style={{ fontSize: 14, lineHeight: 1.6 }}>{c.about}</p>}
          {(c.hiring_focus || []).length > 0 && <div className="hr-chipwrap">{c.hiring_focus.map((f) => <span key={f} className="hr-focus">{f}</span>)}</div>}
          <div className="cl-row cl-wrap hr-small" style={{ gap: 16 }}>
            {c.location_text && <span><MapPin size={13} /> {c.location_text}</span>}
            {c.size && <span><Users size={13} /> {c.size}</span>}
            <span><Briefcase size={13} /> {c.open_positions} open position{c.open_positions === 1 ? '' : 's'}</span>
          </div>
          {(c.benefits || []).length > 0 && <div><strong className="hr-ink">Benefits</strong><div className="hr-chipwrap" style={{ marginTop: 6 }}>{c.benefits.map((b) => <Badge key={b} tone="green">{b}</Badge>)}</div></div>}
        </div>
      </div>
    </Modal>
  )
}

export default function CompanyProfile() {
  const api = useApi('recruiter')
  const toast = useToast()
  const { company: shellCompany, setCompany: setShellCompany } = useRecruiter() || {}
  const own = useQuery(() => api.get(`${H}/company`), [api])
  const company = own.data || shellCompany
  const setOwn = own.setData
  const setCompany = useCallback((c) => { setOwn(c); setShellCompany?.(c) }, [setOwn, setShellCompany])
  const [params, setParams] = useSearchParams()
  const tab = TABS.some((t) => t.id === params.get('tab')) ? params.get('tab') : 'overview'
  const setTab = (t) => { setParams({ tab: t }, { replace: true }); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  const team = useQuery(() => api.get(`${H}/team`), [api])
  const account = useQuery(() => api.get(`${H}/account`), [api])
  const [busy, setBusy] = useState(null)
  const [dlg, setDlg] = useState(null)

  async function upload(kind, file) {
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) return toast('Use a PNG, JPG or WebP image', 'error')
    if (file.size > MAX_IMG) return toast('Images must be under 5 MB', 'error')
    const fd = new FormData(); fd.append('file', file)
    setBusy(kind)
    try { const c = await api.post(`${H}/company/${kind}`, fd); setCompany?.(c); toast(kind === 'logo' ? 'Logo updated' : 'Cover photo updated', 'success') } catch (e) { toast(e.message, 'error') } finally { setBusy(null) }
  }
  async function removeCover() {
    try { const c = await api.del(`${H}/company/cover`); setCompany?.(c); toast('Cover photo removed', 'success') } catch (e) { toast(e.message, 'error') }
  }

  if (!company) {
    return (
      <div className="hr-page">
        <PageHeader title="Company Profile" subtitle="Manage your company information, branding, locations, and hiring preferences." />
        {own.error ? <Alert tone="error">{own.error.message} <button type="button" className="cl-link" onClick={own.reload}>Retry</button></Alert>
          : <div className="cl-stack"><Skeleton h={260} /><Skeleton h={300} /></div>}
      </div>
    )
  }
  const c = company
  const members = team.data?.items || []
  const prefs = c.preferences || {}
  const prefRows = [
    ['Employment Types', prefs.employment_types], ['Experience Levels', prefs.experience], ['Location Preference', prefs.locations], ['Campus Hiring', prefs.campus],
  ]

  return (
    <div className="hr-page">
      <PageHeader
        title="Company Profile"
        subtitle="Manage your company information, branding, locations, and hiring preferences. Showcase your organization to top engineering talent."
        actions={<>
          <Button variant="outline" icon={Eye} onClick={() => setDlg('public')}>View Public Profile</Button>
          <Button icon={Pencil} onClick={() => setTab('details')}>Edit Company Profile</Button>
        </>}
      />

      <div className="hr-co-top">
        <Identity c={c} onUpload={upload} onRemoveCover={removeCover} busy={busy} />
        <Card title="About" action={<button type="button" className="cl-icon-btn" aria-label="Edit about" title="Edit about" onClick={() => setTab('details')}><Pencil size={16} /></button>} className="hr-co-about">
          {c.about ? <p>{c.about}</p> : <p className="cl-muted">Tell candidates what your company builds and why engineers love working there.</p>}
          <div className="hr-co-facts">
            <div className="hr-co-fact"><span className="cl-ico"><Users size={18} /></span><div>Company Size<strong>{c.size || '—'}</strong></div></div>
            <div className="hr-co-fact"><span className="cl-ico"><Calendar size={18} /></span><div>Founded<strong>{c.founded || '—'}</strong></div></div>
          </div>
        </Card>
      </div>

      <div className="hr-tabs-bar" style={{ marginTop: 14 }}>
        <Tabs className="hr-co-tabs" tabs={TABS} value={tab} onChange={setTab} />
      </div>

      {tab === 'overview' && (
        <div className="hr-co-top">
          <div className="cl-stack" style={{ minWidth: 0 }}>
            <Card title="Key Highlights" action={<ViewAll onClick={() => setTab('details')}>Edit</ViewAll>}><Highlights c={c} /></Card>
            <div className="hr-mvv">
              {[[Target, 'Our Mission', c.mission, ''], [Compass, 'Our Vision', c.vision, ''], [Gem, 'Our Values', null, 'purple']].map(([I, t, text, tone]) => (
                <section className="cl-card" key={t}>
                  <span className={`cl-ico ${tone}`} style={{ flex: '0 0 auto' }}><I size={20} /></span>
                  <div style={{ minWidth: 0 }}>
                    <h4>{t}</h4>
                    {t === 'Our Values'
                      ? ((c.values || []).length ? <ul>{c.values.map((v) => <li key={v}>{v}</li>)}</ul> : <p>Add your values. <button type="button" className="cl-link" onClick={() => setTab('details')}>Edit</button></p>)
                      : text ? <p>{text}</p> : <p>Not added yet. <button type="button" className="cl-link" onClick={() => setTab('details')}>Add</button></p>}
                  </div>
                </section>
              ))}
            </div>
            <div className="cl-grid cl-grid-2" style={{ alignItems: 'start' }}>
              <Card title="Office Locations" action={<ViewAll onClick={() => setTab('locations')}>Manage Locations</ViewAll>}>
                {(c.locations || []).length === 0 ? <EmptyState icon={MapPin} title="No offices yet" text="Add your plants and offices." action={<Button size="sm" variant="outline" onClick={() => setTab('locations')}>Add office</Button>} />
                  : c.locations.map((l) => (
                    <button type="button" key={l.name} className="hr-loc" style={{ width: '100%', background: 'none', border: 0, borderBottom: '1px solid var(--cl-line-2)', textAlign: 'left', font: 'inherit', cursor: 'pointer' }} onClick={() => setTab('locations')}>
                      <span className="cl-ico"><MapPin size={18} /></span>
                      <span className="txt"><strong>{l.name}{l.main && <Badge tone="blue">Main Office</Badge>}</strong><span className="cl-ellipsis" style={{ display: 'block' }}>{l.address || '—'}</span></span>
                      {l.tag && <Badge className="hr-loc-tag" title={l.tag}>{l.tag}</Badge>}
                      <ChevronRight size={16} color="var(--cl-blue)" />
                    </button>
                  ))}
              </Card>
              <div className="cl-stack">
                <Card title="Hiring Focus Areas" action={<ViewAll onClick={() => setTab('hiring')}>Edit</ViewAll>}>
                  {(c.hiring_focus || []).length ? <div className="hr-chipwrap">{c.hiring_focus.map((f) => <span key={f} className="hr-focus">{f}</span>)}</div> : <p className="hr-sub">Add the engineering domains you hire for.</p>}
                </Card>
                <Card title="Hiring Preferences" action={<ViewAll onClick={() => setTab('hiring')}>Edit</ViewAll>}>
                  <dl className="hr-prefs">
                    {prefRows.map(([k, v]) => <React.Fragment key={k}><dt>{k}</dt><dd>{v || <span className="cl-muted">Not set</span>}</dd></React.Fragment>)}
                  </dl>
                </Card>
              </div>
            </div>
          </div>

          <aside className="cl-stack" style={{ minWidth: 0 }}>
            <Card title="Company Information" action={<button type="button" className="cl-icon-btn" aria-label="Edit company information" onClick={() => setTab('details')}><Pencil size={16} /></button>}>
              <dl className="hr-info">
                <dt>Legal Name</dt><dd>{c.legal_name || '—'}</dd>
                <dt>Industry</dt><dd>{(c.industries || []).join(', ') || '—'}</dd>
                <dt>Company Type</dt><dd>{c.company_type || '—'}</dd>
                <dt>Headquarters</dt><dd>{c.headquarters || '—'}</dd>
                <dt>Website</dt><dd>{c.website ? <a href={c.website} target="_blank" rel="noreferrer">{c.website.replace(/^https?:\/\//, '')}</a> : '—'}</dd>
                <dt>LinkedIn</dt><dd>{c.linkedin ? <a href={c.linkedin} target="_blank" rel="noreferrer">{c.linkedin.replace(/^https?:\/\//, '')}</a> : '—'}</dd>
                <dt>Verification</dt><dd>{c.verified ? <Badge tone="green" dot>Verified by CoreLink</Badge> : <Badge tone="amber" dot>Not verified</Badge>}</dd>
              </dl>
            </Card>
            <Card title="Media & Gallery" action={<ViewAll onClick={() => setTab('media')}>Manage Media</ViewAll>}>
              {(c.gallery || []).length === 0 ? (
                <button type="button" className="hr-gal-add" style={{ width: '100%', aspectRatio: 'auto', height: 96 }} onClick={() => setTab('media')}><ImagePlus size={20} />Add photos of your plants, labs and teams</button>
              ) : (
                <div className="hr-gallery" style={{ gridTemplateColumns: 'repeat(5, minmax(0,1fr))' }}>
                  {c.gallery.slice(0, 4).map((g) => <button type="button" key={g.path} className="hr-gal-item" onClick={() => setTab('media')} aria-label="Open gallery"><img src={mediaUrl(g.url)} alt="" /></button>)}
                  {c.gallery.length > 4 ? <button type="button" className="hr-gal-more" onClick={() => setTab('media')}><b>+{c.gallery.length - 4}</b>More</button>
                    : <button type="button" className="hr-gal-more" onClick={() => setTab('media')}><ImagePlus size={18} />Add</button>}
                </div>
              )}
            </Card>
            <Card title="Company Team" action={<ViewAll onClick={() => setTab('team')}>Manage Team</ViewAll>}>
              {team.loading && !team.data ? <Skeleton h={120} /> : (
                <>
                  {account.data && (
                    <div className="hr-team-row"><Avatar name={account.data.name} src={account.data.avatar_url} size={34} /><div className="txt"><strong>{account.data.name} (you)</strong>{account.data.job_title || 'Account owner'}</div><span className="em">{account.data.email}</span></div>
                  )}
                  {members.slice(0, 3).map((m) => (
                    <div className="hr-team-row" key={m.id}><Avatar name={m.name} size={34} /><div className="txt"><strong>{m.name}</strong>{m.title || m.access_level}</div><span className="em">{m.email}</span></div>
                  ))}
                  {members.length === 0 && <Button size="sm" variant="outline" icon={UserPlus} style={{ marginTop: 8 }} onClick={() => setDlg('add')}>Invite a colleague</Button>}
                </>
              )}
            </Card>
          </aside>
        </div>
      )}

      {tab === 'details' && <DetailsEditor company={c} setCompany={setCompany} />}
      {tab === 'locations' && <LocationsEditor company={c} setCompany={setCompany} />}
      {tab === 'hiring' && <HiringEditor company={c} setCompany={setCompany} />}
      {tab === 'benefits' && <BenefitsEditor company={c} setCompany={setCompany} />}
      {tab === 'media' && <GalleryEditor company={c} setCompany={setCompany} />}
      {tab === 'settings' && <ProfileSettings company={c} setCompany={setCompany} />}
      {tab === 'team' && (
        <Card title="Company Team" subtitle="Colleagues who hire with you. Access levels control what they can change."
          action={<Button variant="outline" icon={UserPlus} onClick={() => setDlg('add')}>Add Team Member</Button>}>
          <TeamTable team={team} owner={account.data} />
        </Card>
      )}
      {team.error && tab === 'overview' && <div style={{ marginTop: 12 }}><Alert tone="error">{team.error.message}</Alert></div>}

      <PublicPreview c={c} open={dlg === 'public'} onClose={() => setDlg(null)} />
      <AddMemberModal open={dlg === 'add'} onClose={() => setDlg(null)} onAdded={() => team.reload()} />
    </div>
  )
}
