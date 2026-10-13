/**
 * Curated learning-resource catalogue for the Resources page (11).
 *
 * There is no resources backend yet, so the catalogue is built here from the
 * branch definitions in src/branding/branches.js (topics, tools, domains).
 * Each item is a study guide: an outline the student can download as a
 * Markdown file plus links that search well-known free sources (NPTEL,
 * YouTube). Nothing is hosted, so no file sizes are claimed.
 *
 * SAMPLE_POPULARITY is illustrative only (shown with <DemoTag/>) — replace it
 * with real view/download counts when a resources API exists.
 */
import { BRANCHES, getBranch, branchThumb } from '../../../branding/branches.js'

export const CATEGORIES = [
  { id: 'all', label: 'All Resources' },
  { id: 'study', label: 'Study Materials' },
  { id: 'interview', label: 'Interview Prep' },
  { id: 'project', label: 'Project References' },
  { id: 'software', label: 'Software Tutorials' },
  { id: 'career', label: 'Career Guidance' },
  { id: 'saved', label: 'Saved' },
]
export const CATEGORY_LABEL = { study: 'Notes', interview: 'Interview', project: 'Project', software: 'Tutorial', career: 'Career' }
export const FORMAT_LABEL = { notes: 'Notes', video: 'Video', guide: 'Guide' }

const OUTLINES = {
  study: (t) => [`${t}: core definitions and laws`, 'Important formulas and units', 'Worked examples (step by step)', 'Common mistakes in exams', 'Previous-year style questions', `Interview questions on ${t}`],
  software: (t) => [`Installing and setting up ${t}`, 'Interface tour and key shortcuts', 'First project: a guided walkthrough', 'Industry workflows and best practices', 'Exporting results and documenting work', `Listing ${t} on your resume`],
  project: (t) => [`Choosing a ${t} project scope`, 'Literature review and problem statement', 'Design calculations and tools used', 'Prototype / simulation and validation', 'Report structure and presentation', 'What recruiters look for in the project'],
  interview: (t) => [`Most asked ${t} questions`, 'How to structure answers (STAR / concept → example)', 'Quick revision sheet', 'Mock answers with feedback points', 'Follow-up questions to expect'],
  career: (t) => [t, 'Step-by-step checklist', 'Examples and templates', 'Common mistakes to avoid', 'Where CoreLink helps'],
}

const GENERAL = [
  { cat: 'career', format: 'guide', title: 'Resume Guide for Core Engineering Students', desc: 'How to write a strong one-page resume with projects, tools and measurable results.' },
  { cat: 'career', format: 'guide', title: 'Internship Search Playbook', desc: 'Where to find core internships, how to cold-email and how to follow up.' },
  { cat: 'career', format: 'guide', title: 'Following Up After an Interview', desc: 'Short, professional follow-up messages that show interest without being pushy.' },
  { cat: 'career', format: 'video', title: 'LinkedIn Profile for Engineers', desc: 'Headline, about section and featured projects that recruiters notice.' },
  { cat: 'interview', format: 'guide', title: 'HR Interview Questions & Model Answers', desc: 'Tell me about yourself, strengths, weaknesses, why this company — with structures.' },
  { cat: 'interview', format: 'video', title: 'Aptitude Test Preparation', desc: 'Quantitative, logical reasoning and verbal sections common in campus drives.' },
  { cat: 'interview', format: 'guide', title: 'Group Discussion Tips', desc: 'How to open, contribute and summarise in a GD round.' },
  { cat: 'software', format: 'video', title: 'AutoCAD for Beginners', desc: 'Complete tutorial with practical drafting examples.' },
  { cat: 'software', format: 'video', title: 'MATLAB Fundamentals', desc: 'Matrices, scripts, plotting and Simulink basics for engineers.' },
]

const DAY = 86400000
const BASE = Date.UTC(2026, 9, 12)
const seeded = (s) => [...s].reduce((a, c) => (a * 33 + c.charCodeAt(0)) >>> 0, 5381)

function make(branchId, cat, format, title, desc, idx) {
  const h = seeded(`${branchId}:${title}`)
  const minutes = format === 'video' ? 30 + (h % 7) * 10 : 15 + (h % 5) * 5
  return {
    id: `${branchId}-${cat}-${idx}-${h.toString(36)}`,
    branch: branchId,
    cat,
    format,
    title,
    desc,
    minutes,
    added: new Date(BASE - (h % 45) * DAY).toISOString(),
    outline: OUTLINES[cat](title.replace(/ (Notes|Tutorial|Interview Questions|Project Guide)$/, '')),
    thumbIndex: idx,
  }
}

function build() {
  const out = []
  BRANCHES.forEach((b) => {
    b.topics.forEach((t, i) => out.push(make(b.id, 'study', 'notes', `${t} Notes`, `Concepts, formulas, solved problems and previous-year style questions on ${t.toLowerCase()}.`, i)))
    b.skills.slice(0, 4).forEach((s, i) => out.push(make(b.id, 'software', 'video', `${s} Tutorial`, `Step-by-step guide to ${s} with a hands-on ${b.label.toLowerCase()} example.`, i + 5)))
    b.domains.forEach((d, i) => out.push(make(b.id, 'project', 'guide', `${d} Project Guide`, `Mini-project ideas, documentation structure and evaluation checklist for ${d.toLowerCase()}.`, i + 9)))
    b.topics.slice(0, 2).forEach((t, i) => out.push(make(b.id, 'interview', 'guide', `${t} Interview Questions`, `Frequently asked ${t.toLowerCase()} questions with model answers.`, i + 13)))
  })
  GENERAL.forEach((g, i) => out.push(make('all', g.cat, g.format, g.title, g.desc, i)))
  return out.sort((a, b) => b.added.localeCompare(a.added))
}

export const CATALOGUE = build()

/** Illustrative popularity numbers (DemoTag) — deterministic per item. */
export const SAMPLE_POPULARITY = Object.fromEntries(CATALOGUE.map((r) => [r.id, 1500 + (seeded(r.id) % 110) * 100]))
export const fmtCount = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n))

export function thumbFor(r, fallbackBranch) {
  if (r.cat === 'career' || (r.cat === 'interview' && r.branch === 'all')) return '/assets/images/crops/thumb-hr-panel.jpg'
  return branchThumb(getBranch(r.branch === 'all' ? fallbackBranch?.id : r.branch), r.thumbIndex)
}

export const branchLabel = (id) => (id === 'all' ? 'All Branches' : getBranch(id).label)

export function searchLinks(r) {
  const topic = r.title.replace(/ (Notes|Tutorial|Project Guide)$/, '')
  return [
    { label: 'NPTEL lectures', href: `https://www.google.com/search?q=${encodeURIComponent(`site:nptel.ac.in ${topic}`)}` },
    { label: 'Video tutorials', href: `https://www.youtube.com/results?search_query=${encodeURIComponent(`${topic} engineering`)}` },
  ]
}

/** Markdown study outline the student can download. */
export function outlineMarkdown(r) {
  const lines = [
    `# ${r.title}`, '', `_${CATEGORY_LABEL[r.cat]} · ${branchLabel(r.branch)} · CoreLink Learning Resources_`, '', r.desc, '', '## Outline', '',
    ...r.outline.map((o, i) => `${i + 1}. ${o}`), '', '## Free sources', '', ...searchLinks(r).map((l) => `- [${l.label}](${l.href})`), '',
    '## Notes', '', '_Use this space for your own notes._', '',
  ]
  return lines.join('\n')
}
