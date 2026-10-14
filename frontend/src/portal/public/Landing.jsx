import React, { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  HardHat, ArrowRight, PlayCircle, Check, ChevronRight, Menu as MenuIcon, X, Factory, Building, Zap, CarFront, Users, Building2, FileText, BadgeCheck,
  Cog, Building2 as Civil, Cpu, FlaskConical, Plane, Car, Layers, FileUser, ScanSearch, Target, ShieldCheck, GraduationCap, UserRound, Briefcase, LayoutGrid,
} from 'lucide-react'
import { Brand, Button, DemoTag, Ring, cx } from '../../ui/index.jsx'
import { BRANCHES } from '../../branding/branches.js'
import { Announcement, usePublicInfo } from './components/AuthKit.jsx'

const BRANCH_ICONS = { Cog, Building2: Civil, Zap, Cpu, FlaskConical, Plane, Car, Layers }

const NAV = [
  { id: 'home', label: 'Home' },
  { id: 'students', label: 'For Students' },
  { id: 'recruiters', label: 'For Recruiters' },
  { id: 'branches', label: 'Core Branches' },
  { id: 'features', label: 'Features' },
  { id: 'about', label: 'About' },
]

/* Hero illustration of the product UI (not live data). */
const SKILLS_MATCH_EXAMPLE = { score: 88, items: ['Technical Skills', 'Projects & Internships', 'Core Domain Match', 'Industry Readiness'] }
const OPPORTUNITY_AREAS = [
  { icon: Factory, color: '#2563eb', bg: '#eef4ff', title: 'Manufacturing & Production', text: 'Production, Quality, Maintenance' },
  { icon: Building, color: '#ea7a12', bg: '#fff1e3', title: 'Construction & Infrastructure', text: 'Site, Planning, Design, Project Mgmt' },
  { icon: Zap, color: '#dc2626', bg: '#fdecec', title: 'Power & Energy', text: 'Generation, Transmission, Renewables' },
  { icon: CarFront, color: '#0f172a', bg: '#eef2f8', title: 'Automotive & EV', text: 'Design, R&D, Testing, Manufacturing' },
]

const STEPS = [
  { icon: FileUser, title: 'Create Profile', text: 'Add your academic details, branch, skills and real projects' },
  { icon: ScanSearch, title: 'Get AI Analysis', text: 'Our AI analyzes your resume, skills and projects for core roles' },
  { icon: Target, title: 'Find Opportunities', text: 'Get matched with core companies, internships and off-campus drives' },
  { icon: ShieldCheck, title: 'Apply & Get Hired', text: 'Attend interviews and track your application status' },
]

const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString('en-IN'))

export default function Landing() {
  const info = usePublicInfo()
  const navigate = useNavigate()
  const [menu, setMenu] = useState(false)
  const [signin, setSignin] = useState(false)
  const [active, setActive] = useState('home')

  // highlight the nav item of the section in view
  useEffect(() => {
    const els = NAV.map((n) => document.getElementById(n.id)).filter(Boolean)
    if (!('IntersectionObserver' in window) || !els.length) return undefined
    const io = new IntersectionObserver((entries) => {
      const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
      if (vis) setActive(vis.target.id)
    }, { rootMargin: '-80px 0px -55% 0px' })
    els.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [])
  useEffect(() => {
    if (!signin) return undefined
    const off = (e) => { if (!e.target.closest('.pub-signin')) setSignin(false) }
    const esc = (e) => e.key === 'Escape' && setSignin(false)
    document.addEventListener('mousedown', off)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', off); document.removeEventListener('keydown', esc) }
  }, [signin])

  const jump = (id) => (e) => {
    e.preventDefault()
    setMenu(false)
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setActive(id)
  }

  const showStats = info?.show_stats !== false
  const stats = [
    { icon: Users, value: info ? fmt(info.students) : '…', label: 'Engineering students' },
    { icon: Building2, value: info ? fmt(info.companies) : '…', label: 'Verified hiring companies' },
    { icon: FileText, value: info ? fmt(info.open_jobs) : '…', label: 'Open core job opportunities' },
    { icon: BadgeCheck, value: info ? fmt(info.verified_projects) : '…', label: 'Verified student projects' },
  ]

  return (
    <div className="cl-app pub pub-landing">
      <Announcement info={info} />
      <header className="pub-nav">
        <div className="pub-wrap pub-nav-in">
          <Brand to="/" size={36} />
          <nav className={cx('pub-links', menu && 'open')} aria-label="Sections">
            {NAV.map((n) => <a key={n.id} href={`#${n.id}`} className={active === n.id ? 'active' : ''} aria-current={active === n.id ? 'true' : undefined} onClick={jump(n.id)}>{n.label}</a>)}
          </nav>
          <div className="pub-nav-cta">
            <div className="pub-signin">
              <Button variant="secondary" aria-haspopup="menu" aria-expanded={signin} onClick={() => setSignin((s) => !s)}>Sign In</Button>
              {signin && (
                <div className="pub-signin-pop" role="menu">
                  <Link role="menuitem" to="/candidate/login"><GraduationCap size={18} color="var(--cl-blue)" /><span>Student<small>Engineering students & graduates</small></span></Link>
                  <Link role="menuitem" to="/recruiter/login"><Briefcase size={18} color="#6d3fd6" /><span>Recruiter<small>Approved company accounts</small></span></Link>
                  <Link role="menuitem" to="/admin/login"><UserRound size={18} color="#5b6b82" /><span>Admin<small>CoreLink platform staff</small></span></Link>
                </div>
              )}
            </div>
            <Button className="pub-hide-m" to="/candidate/login?mode=signup">Get Started</Button>
            <button type="button" className="cl-icon-btn pub-menu-btn" aria-label={menu ? 'Close menu' : 'Open menu'} aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
              {menu ? <X size={22} /> : <MenuIcon size={22} />}
            </button>
          </div>
        </div>
      </header>

      <main>
        <section id="home" className="pub-hero">
          <div className="pub-hero-img"><img src="/assets/images/crops/hero-plant-engineers.jpg" alt="Two engineers in hard hats reviewing plans at a process plant" /></div>
          <div className="pub-wrap pub-hero-in">
            <div className="pub-hero-copy">
              <span className="pub-pill"><HardHat size={17} /> Built for Core Engineers</span>
              <h1>From Campus to <span>Core Careers</span></h1>
              <p className="pub-hero-text">An AI-powered platform that helps core engineering students showcase real skills, verify projects, and connect with top opportunities in Mechanical, Civil, EEE, ECE and more.</p>
              <div className="pub-hero-ctas">
                <Button to="/candidate/login?mode=signup" iconRight={ArrowRight}>Get Started</Button>
                <Button variant="secondary" icon={PlayCircle} onClick={jump('features')}>See How It Works</Button>
              </div>
            </div>
            <div className="pub-hero-cards">
              <div className="pub-glass" aria-label="Example skills match">
                <h3>Skills Match <DemoTag title="Example of the profile match score students see after AI analysis" /></h3>
                <div className="pub-skill">
                  <Ring value={SKILLS_MATCH_EXAMPLE.score} size={78} stroke={7} color="#0b5cff" label={`${SKILLS_MATCH_EXAMPLE.score}%`} />
                  <ul>{SKILLS_MATCH_EXAMPLE.items.map((t) => <li key={t}><Check size={13} />{t}</li>)}</ul>
                </div>
              </div>
              <div className="pub-glass">
                <h3>Top Opportunities</h3>
                <div className="pub-opps">
                  {OPPORTUNITY_AREAS.map((o) => (
                    <Link key={o.title} to="/candidate/login?mode=signup" aria-label={`${o.title} opportunities — sign up to browse`}>
                      <span className="ico" style={{ background: o.bg, color: o.color }}><o.icon size={18} /></span>
                      <span style={{ minWidth: 0 }}><strong>{o.title}</strong><small>{o.text}</small></span>
                      <ChevronRight size={15} color="#334155" />
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          </div>
          <div id="branches" className="pub-wrap pub-branches" aria-label="Core engineering branches">
            {BRANCHES.map((b) => {
              const Icon = BRANCH_ICONS[b.icon] || LayoutGrid
              return (
                <Link key={b.id} to="/candidate/login?mode=signup" className="pub-branch" title={`${b.long} — sign up to see matching roles`}>
                  <span className="ico" style={{ background: b.soft, color: b.color }}><Icon size={28} /></span>
                  <span><strong>{b.long.replace(' Engineering', '')}</strong><small>{b.tagline}</small></span>
                </Link>
              )
            })}
          </div>
        </section>

        <section className="pub-band" aria-label="CoreLink in numbers">
          <div className="pub-wrap pub-band-in">
            {showStats ? (
              <div className="pub-stats">
                {stats.map((s) => <div key={s.label} className="pub-stat"><s.icon size={34} /><span><strong>{s.value}</strong><span>{s.label}</span></span></div>)}
              </div>
            ) : (
              <div className="pub-stats">
                {[['AI resume & project analysis', ScanSearch], ['Verified company recruiters', ShieldCheck], ['Branch-wise job matching', Target], ['AI mock interviews', Cpu]].map(([t, I]) => (
                  <div key={t} className="pub-stat"><I size={30} /><span><strong style={{ fontSize: 15 }}>{t}</strong></span></div>
                ))}
              </div>
            )}
            {info?.company_names?.length > 0 && (
              <div className="pub-trust">
                <p>Companies hiring on CoreLink</p>
                <ul>{info.company_names.map((n) => <li key={n}>{n}</li>)}</ul>
              </div>
            )}
          </div>
        </section>

        <section className="pub-wrap pub-lower">
          <div id="features" className="pub-how">
            <span className="pub-pill"><BadgeCheck size={16} /> Simple • Focused • Effective</span>
            <h2>How CoreLink Works</h2>
            <p>A complete platform for core engineering careers.</p>
            <ol className="pub-steps" style={{ listStyle: 'none', padding: 0, margin: '26px 0 0' }}>
              {STEPS.map((s, i) => (
                <li key={s.title} className="pub-step">
                  <span className="pub-step-ico"><s.icon size={24} /></span>
                  <h3><i>{i + 1}</i>{s.title}</h3>
                  <p>{s.text}</p>
                </li>
              ))}
            </ol>
          </div>
          <article id="students" className="pub-role students">
            <img src="/assets/images/crops/landing-student.jpg" alt="Engineering student with a laptop" loading="lazy" />
            <div className="pub-role-body">
              <GraduationCap size={26} />
              <h2>For Students</h2>
              <p>Build a strong profile, showcase your projects and get noticed by top core companies.</p>
              <Button to="/candidate/login?mode=signup" iconRight={ArrowRight}>Create Free Account</Button>
              <ul>
                {['ATS-friendly resume analysis', 'Project verification for real work', 'Branch-specific job matching', 'Access to internships and full-time roles'].map((t) => <li key={t}><Check size={12} />{t}</li>)}
              </ul>
            </div>
          </article>
          <article id="recruiters" className="pub-role recruiters">
            <img src="/assets/images/crops/landing-recruiter.jpg" alt="Recruiter holding a tablet" loading="lazy" />
            <div className="pub-role-body">
              <Building2 size={26} />
              <h2>For Recruiters</h2>
              <p>Find job-ready core engineering talent with verified skills and real projects.</p>
              <Button onClick={() => navigate('/recruiter/login?mode=request')} iconRight={ArrowRight}>Hire Talent</Button>
              <ul>
                {['AI-powered candidate screening', 'Verified academic and project data', 'Branch-wise talent pool', 'End-to-end hiring workflow'].map((t) => <li key={t}><Check size={12} />{t}</li>)}
              </ul>
            </div>
          </article>
        </section>
      </main>

      <footer id="about" className="pub-footer">
        <div className="pub-wrap pub-footer-in">
          <div>
            <Brand to="/" size={32} />
            <p>CoreLink connects core engineering students — Mechanical, Civil, Electrical, Electronics, Chemical, Aerospace, Automobile and Metallurgy — with companies hiring for real engineering work. Profiles are built on verified projects and skills, not keywords.</p>
          </div>
          <div>
            <h4>Students</h4>
            <ul><li><Link to="/candidate/login?mode=signup">Create account</Link></li><li><Link to="/candidate/login">Sign in</Link></li><li><a href="#features" onClick={jump('features')}>How it works</a></li></ul>
          </div>
          <div>
            <h4>Recruiters</h4>
            <ul><li><Link to="/recruiter/login?mode=request">Request access</Link></li><li><Link to="/recruiter/login">Sign in</Link></li><li><a href="#branches" onClick={jump('branches')}>Core branches</a></li></ul>
          </div>
          <div>
            <h4>Contact</h4>
            <ul>
              {info?.support_email ? <li><a href={`mailto:${info.support_email}`}>{info.support_email}</a></li> : <li><Link to="/recruiter/login?mode=request">Contact us</Link></li>}
              <li><Link to="/admin/login">Admin</Link></li>
            </ul>
          </div>
        </div>
        <div className="pub-wrap pub-footer-bottom"><span>© {new Date().getFullYear()} CoreLink</span><span><Link to="/privacy">Privacy</Link> · <Link to="/terms">Terms</Link> · Built for core engineering careers</span></div>
      </footer>
    </div>
  )
}
