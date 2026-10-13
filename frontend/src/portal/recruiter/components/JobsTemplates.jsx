import React, { useMemo, useState } from 'react'
import { BookOpen, Briefcase, ChevronRight, ClipboardCheck, Factory, FlaskConical, GraduationCap, IndianRupee, Wrench } from 'lucide-react'
import { Button, EmptyState, Modal, Select, Tabs } from '../../../ui/index.jsx'
import { BRANCHES, getBranch } from '../../../branding/branches.js'
import { BRANCH_OPTIONS, BranchBadge, jobTypeLabel } from './RecruiterPipelineKit.jsx'

/* ── Role-template groups (from GET /api/candidate/roles) ───────────── */
const RD = /R&D|Design|VLSI|Propulsion|Avionics/i
const MFG = /Manufactur|Production|Plant|Process|Site|Construction/i
export const TEMPLATE_GROUPS = [
  { id: 'intern', label: 'Engineering Intern', desc: 'For internships and trainee roles', icon: GraduationCap, tone: '', job_type: 'internship', experience_level: 'fresher', match: () => true },
  { id: 'fulltime', label: 'Full-time Engineer', desc: 'For entry and mid-level positions', icon: Briefcase, tone: '', job_type: 'full-time', experience_level: '0-2', match: (r) => !RD.test(r.title) && !MFG.test(r.title) },
  { id: 'rd', label: 'Research & Development', desc: 'For R&D and innovation roles', icon: FlaskConical, tone: 'green', job_type: 'full-time', experience_level: '0-2', match: (r) => RD.test(r.title) },
  { id: 'mfg', label: 'Manufacturing & Production', desc: 'For manufacturing and plant roles', icon: Factory, tone: 'orange', job_type: 'full-time', experience_level: 'fresher', match: (r) => MFG.test(r.title) },
]

const internTitle = (t) => `${t.replace(/\s*\/.*$/, '').replace(/\s+Engineer$/i, '')} Intern`

/** Turn a role template into form pre-fill for a given group. */
export function templatePrefill(role, group) {
  const b = getBranch(role.branch)
  const title = group.id === 'intern' ? internTitle(role.title) : role.title
  return {
    title,
    branch: b.id,
    description: role.description,
    skills: b.skills.slice(0, 6),
    job_type: group.job_type,
    experience_level: group.experience_level,
  }
}

export function groupRoles(roles = []) {
  const core = roles.filter((r) => r.branch !== 'software')
  return Object.fromEntries(TEMPLATE_GROUPS.map((g) => [g.id, core.filter(g.match)]))
}

export function TemplatePickerModal({ open, onClose, roles, loading, initialGroup = 'intern', onUse }) {
  const [group, setGroup] = useState(initialGroup)
  const [branch, setBranch] = useState('')
  React.useEffect(() => { if (open) setGroup(initialGroup) }, [open, initialGroup])
  const grouped = useMemo(() => groupRoles(roles), [roles])
  const g = TEMPLATE_GROUPS.find((x) => x.id === group)
  const list = (grouped[group] || []).filter((r) => !branch || r.branch === branch)
  return (
    <Modal open={open} onClose={onClose} size="lg" title="Job templates">
      <div className="cl-col" style={{ gap: 12 }}>
        <Tabs tabs={TEMPLATE_GROUPS.map((t) => ({ id: t.id, label: t.label, count: (grouped[t.id] || []).length }))} value={group} onChange={setGroup} />
        <div className="cl-row cl-wrap" style={{ justifyContent: 'space-between' }}>
          <p className="cl-muted">{g?.desc}. Creates a {jobTypeLabel(g?.job_type).toLowerCase()} posting you can edit before publishing.</p>
          <Select aria-label="Filter templates by branch" style={{ width: 220 }} value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="All branches" options={BRANCH_OPTIONS} />
        </div>
        {loading ? <p className="cl-muted">Loading templates…</p> : list.length === 0 ? (
          <EmptyState title="No templates for this branch" text="Try another branch or category — or start from a blank job." />
        ) : (
          <div className="cl-list">
            {list.map((r) => (
              <div className="cl-list-item" key={r.id}>
                <div className="cl-grow">
                  <div className="cl-row" style={{ gap: 8 }}><strong style={{ color: 'var(--cl-ink)' }}>{g.id === 'intern' ? internTitle(r.title) : r.title}</strong><BranchBadge branch={r.branch} /></div>
                  <p className="cl-muted" style={{ fontSize: 13, marginTop: 4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{r.description}</p>
                </div>
                <Button size="sm" variant="outline" onClick={() => { onUse(templatePrefill(r, g)); onClose() }}>Use</Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  )
}

/* ── Hiring guidelines ──────────────────────────────────────────────── */
export const GUIDES = [
  { id: 'jd', label: 'How to write a good job description', icon: BookOpen },
  { id: 'skills', label: 'Recommended skills by branch', icon: Wrench },
  { id: 'process', label: 'Interview process guidelines', icon: ClipboardCheck },
  { id: 'comp', label: 'Compensation benchmarks', icon: IndianRupee },
]

function money(v, cur = 'INR') {
  if (v == null) return '—'
  if (cur === 'INR') return `₹${(v / 100000).toFixed(1)} LPA`
  return `${cur} ${Math.round(v).toLocaleString()}`
}

export function GuidelineModal({ id, onClose, jobs = [] }) {
  const guide = GUIDES.find((g) => g.id === id)
  const comp = useMemo(() => {
    const by = {}
    jobs.filter((j) => j.salary_min != null || j.salary_max != null).forEach((j) => {
      const k = `${j.job_type || 'unspecified'}|${j.currency || 'INR'}`
      ;(by[k] = by[k] || []).push(j)
    })
    return Object.entries(by).map(([k, list]) => {
      const [type, cur] = k.split('|')
      const mins = list.map((j) => j.salary_min).filter((v) => v != null)
      const maxs = list.map((j) => j.salary_max).filter((v) => v != null)
      const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null)
      return { type, cur, n: list.length, min: avg(mins), max: avg(maxs) }
    })
  }, [jobs])
  return (
    <Modal open={!!guide} onClose={onClose} size="lg" title={guide?.label} footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
      <div className="rp-guide-body">
        {id === 'jd' && (<>
          <p>Engineering students decide in seconds whether a role fits their branch and skills. A clear description also improves CoreLink's AI match scores, because the ATS compares résumés against your text.</p>
          <h4>Structure</h4>
          <ul>
            <li><b>Title:</b> use the standard role name (e.g. “Mechanical Design Intern”, “Process Engineer – GET”), not internal codes.</li>
            <li><b>Mission:</b> 2–3 sentences on the product, plant or system the hire will work on.</li>
            <li><b>Responsibilities:</b> 4–6 concrete tasks (“model fixtures in SolidWorks”, “run load-flow studies in ETAP”).</li>
            <li><b>Required skills:</b> list tools and fundamentals separately — they power AI matching and “Top Skills in Demand”.</li>
            <li><b>Eligibility:</b> branches, graduation years, CGPA cut-off and backlog policy, stated once and clearly.</li>
            <li><b>Logistics:</b> location, work mode, duration (for internships), stipend/CTC range and joining timeline.</li>
          </ul>
          <h4>Avoid</h4>
          <ul>
            <li>Unrealistic experience asks for fresher roles (e.g. “3+ years” for a GET role).</li>
            <li>Gendered or exclusionary language and age limits — keep criteria job-related.</li>
            <li>Copy-pasting long software-centric templates for core engineering roles.</li>
          </ul>
        </>)}
        {id === 'skills' && (<>
          <p>Commonly expected tools and fundamentals for entry-level core engineering roles, by branch. Add the ones that matter for your role as required skills.</p>
          {BRANCHES.map((b) => (
            <div key={b.id} style={{ marginTop: 12 }}>
              <h4 style={{ color: b.color }}>{b.long}</h4>
              <div className="cl-chips">{b.skills.map((s) => <span key={s} className="cl-chip soft">{s}</span>)}</div>
              <p className="cl-muted" style={{ fontSize: 13, marginTop: 6 }}>Core topics: {b.topics.join(', ')}</p>
            </div>
          ))}
        </>)}
        {id === 'process' && (<>
          <p>CoreLink keeps a human in control of every hiring decision. A typical flow for a campus or fresher role:</p>
          <h4>Pipeline</h4>
          <ul>
            <li><b>1 · AI screening (Under Review):</b> résumés are scored against your description. Scores rank candidates — they never reject anyone automatically.</li>
            <li><b>2 · Shortlist:</b> you review and shortlist. Every status change is written to the audit log with your name.</li>
            <li><b>3 · Project verification:</b> verified student projects and repo checks give evidence of hands-on skill.</li>
            <li><b>4 · AI interview:</b> unlock it for shortlisted candidates whose project has been verified (“Move to next stage” does this for you).</li>
            <li><b>5 · Human rounds:</b> schedule technical, project discussion, managerial and HR rounds from Interviews.</li>
            <li><b>6 · Offer:</b> send offers from Offers &amp; Hiring and track acceptance and joining.</li>
          </ul>
          <h4>Good practice</h4>
          <ul>
            <li>Use the same rounds and scoring rubric for every candidate in a requisition.</li>
            <li>Ask project-based questions — “walk me through your design choices” beats trivia.</li>
            <li>Give feedback within a week; respond to every candidate who interviewed.</li>
            <li>Record a short reason when rejecting — it is stored with the decision for compliance.</li>
          </ul>
        </>)}
        {id === 'comp' && (<>
          <p>Benchmarks below are computed from the salary ranges on <b>your own</b> requisitions, so you can keep offers consistent across roles. Add salary ranges to more jobs to improve them.</p>
          {comp.length === 0 ? <EmptyState title="No salary data yet" text="Add a salary range to your jobs to see benchmarks here." /> : (
            <div className="cl-table-wrap" style={{ marginTop: 12 }}>
              <table className="cl-table">
                <thead><tr><th>Job type</th><th>Jobs</th><th>Avg. minimum</th><th>Avg. maximum</th></tr></thead>
                <tbody>{comp.map((c) => <tr key={c.type + c.cur}><td>{jobTypeLabel(c.type)}</td><td>{c.n}</td><td>{money(c.min, c.cur)}</td><td>{money(c.max, c.cur)}</td></tr>)}</tbody>
              </table>
            </div>
          )}
          <h4>Tips</h4>
          <ul>
            <li>Publish a range — postings with a stated range get more qualified applicants.</li>
            <li>Keep internship stipends and full-time CTC separate; state stipend per month.</li>
            <li>Align offers for the same role and location to avoid internal inequity.</li>
          </ul>
        </>)}
      </div>
    </Modal>
  )
}

export function GuideList({ onOpen }) {
  return (
    <div className="rp-guides">
      {GUIDES.map((g) => {
        const I = g.icon
        return <button key={g.id} type="button" onClick={() => onOpen(g.id)}><I size={17} />{g.label}<ChevronRight size={16} /></button>
      })}
    </div>
  )
}
