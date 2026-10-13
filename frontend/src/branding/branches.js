/**
 * Core-branch catalogue: labels, colours, icons and the imagery each branch
 * shows across the app (dashboard hero, page banners, card thumbnails).
 *
 * IMAGE RULES
 * - Everything under /assets/images/crops/ is cut from the approved design
 *   pack (docs/ui-reference) by docs/ui-reference/crop_images.py — no
 *   invented or substituted photos.
 * - A branch can get its own photos later: drop files into
 *   src/assets/branches/<id>/ named hero.jpg or <page>.jpg (dashboard,
 *   profile, resume, projects, opportunities, applications, interview,
 *   resources, settings). They are picked up automatically at build time
 *   (import.meta.glob) and win over the approved crops. Prompts to generate
 *   them in the same style: docs/branch-images/PROMPTS.md
 */

// Build-time map of optional user-supplied branch photos.
const CUSTOM = import.meta.glob('../assets/branches/*/*.{jpg,jpeg,png,webp}', { eager: true, query: '?url', import: 'default' })
function custom(branchId, name) {
  for (const ext of ['jpg', 'jpeg', 'png', 'webp']) {
    const hit = CUSTOM[`../assets/branches/${branchId}/${name}.${ext}`]
    if (hit) return hit
  }
  return null
}

const C = (name) => `/assets/images/crops/${name}.jpg`

export const BRANCHES = [
  {
    id: 'mechanical',
    label: 'Mechanical',
    long: 'Mechanical Engineering',
    color: '#2563EB',
    soft: '#EFF4FF',
    icon: 'Cog',
    tagline: 'Design • Manufacturing • Production • R&D',
    hero: C('hero-mech-cad-robotics'),
    pageHeroes: {
      dashboard: C('hero-mech-cad-opps'),
      profile: C('hero-mech-profile-cover'),
      resume: C('hero-mech-resume'),
      projects: C('hero-mech-cad-robotics'),
      opportunities: C('hero-mech-cad-opps'),
      applications: C('hero-mech-applications'),
      interview: C('hero-mech-ai-interview'),
      resources: C('hero-mech-cad-gearbox'),
      settings: C('hero-mech-settings'),
    },
    thumbs: [C('thumb-mech-gearbox'), C('thumb-mech-cnc-fixture'), C('thumb-mech-gears'), C('thumb-mech-machine-design')],
    skills: ['SolidWorks', 'AutoCAD', 'ANSYS', 'MATLAB', 'CATIA', 'GD&T', 'CNC Programming', 'Thermal Analysis'],
    topics: ['Thermodynamics', 'Fluid Mechanics', 'Machine Design', 'Strength of Materials', 'Manufacturing Processes'],
    domains: ['Design & Manufacturing', 'Thermal Systems', 'CAD & Simulation', 'Robotics & Automation'],
  },
  {
    id: 'civil',
    label: 'Civil',
    long: 'Civil Engineering',
    color: '#0D9488',
    soft: '#ECFDF8',
    icon: 'Building2',
    tagline: 'Design • Construction • Planning • Infrastructure',
    hero: C('hero-plant-engineers'),
    pageHeroes: {},
    thumbs: [C('thumb-civil-steel-frame'), C('hero-plant-engineers'), C('thumb-sim-fea')],
    skills: ['AutoCAD', 'STAAD.Pro', 'ETABS', 'Revit', 'Primavera', 'Surveying', 'Concrete Design', 'Estimation'],
    topics: ['Structural Analysis', 'Concrete Design (IS 456)', 'Geotechnical Engineering', 'Transportation', 'Surveying'],
    domains: ['Structural Design', 'Construction Management', 'Transportation', 'Geotechnical'],
  },
  {
    id: 'eee',
    label: 'Electrical',
    long: 'Electrical & Electronics Engineering',
    color: '#F59E0B',
    soft: '#FFF7E6',
    icon: 'Zap',
    tagline: 'Power Systems • Control • Instrumentation • Utilities',
    hero: null,
    pageHeroes: {},
    thumbs: [C('thumb-eee-solar'), C('thumb-ece-robot-arm'), C('thumb-ece-lab-2')],
    skills: ['MATLAB/Simulink', 'PLC Programming', 'Power Systems', 'Control Systems', 'ETAP', 'SCADA', 'PSpice', 'AutoCAD Electrical'],
    topics: ['Power Systems', 'Control Systems', 'Electrical Machines', 'Power Electronics', 'Switchgear & Protection'],
    domains: ['Power & Energy', 'Renewables', 'Automation & PLC', 'Electrical Design'],
  },
  {
    id: 'ece',
    label: 'Electronics & Comm.',
    long: 'Electronics & Communication Engineering',
    color: '#7C3AED',
    soft: '#F4EFFF',
    icon: 'Cpu',
    tagline: 'VLSI • Embedded • Telecom • IoT • Hardware',
    hero: C('hero-ece-chiplab'),
    pageHeroes: {},
    thumbs: [C('thumb-ece-robot-arm'), C('thumb-ece-lab-1'), C('thumb-ece-lab-2'), C('thumb-eee-solar')],
    skills: ['Verilog', 'VHDL', 'Embedded C', 'Arduino', 'PCB Design', 'MATLAB', 'Cadence', 'IoT'],
    topics: ['Digital Electronics', 'VLSI Design', 'Embedded Systems', 'Communication Systems', 'Signals & Systems'],
    domains: ['VLSI & Chip Design', 'Embedded Systems', 'Telecom & RF', 'IoT & Hardware'],
  },
  {
    id: 'chemical',
    label: 'Chemical',
    long: 'Chemical Engineering',
    color: '#E11D48',
    soft: '#FFF0F3',
    icon: 'FlaskConical',
    tagline: 'Process • Plant Design • Energy • Manufacturing',
    hero: C('hero-plant-engineers'),
    pageHeroes: {},
    thumbs: [C('hero-plant-engineers'), C('thumb-sim-fea-2'), C('thumb-meta-manufacturing')],
    skills: ['Aspen HYSYS', 'Aspen Plus', 'DWSIM', 'MATLAB', 'Process Simulation', 'HAZOP', 'P&ID', 'COMSOL'],
    topics: ['Mass Transfer', 'Heat Transfer', 'Reaction Engineering', 'Process Control', 'Thermodynamics'],
    domains: ['Process Engineering', 'Plant Design', 'Energy & Petrochemicals', 'Pharma & Specialty Chemicals'],
  },
  {
    id: 'aerospace',
    label: 'Aerospace',
    long: 'Aerospace Engineering',
    color: '#0EA5E9',
    soft: '#EAF7FE',
    icon: 'Plane',
    tagline: 'Aerodynamics • Propulsion • Structures • Avionics',
    hero: null,
    pageHeroes: {},
    thumbs: [C('thumb-aero-airfoil'), C('thumb-sim-fea'), C('thumb-sim-fea-2')],
    skills: ['ANSYS Fluent', 'CFD', 'CATIA', 'MATLAB', 'XFLR5', 'NASTRAN', 'Composites', 'Flight Mechanics'],
    topics: ['Aerodynamics', 'Propulsion', 'Aircraft Structures', 'Flight Mechanics', 'Avionics'],
    domains: ['Aerodynamics & CFD', 'Aircraft Structures', 'Propulsion', 'Space Systems'],
  },
  {
    id: 'automobile',
    label: 'Automobile',
    long: 'Automobile Engineering',
    color: '#10B981',
    soft: '#E9FBF3',
    icon: 'Car',
    tagline: 'Vehicle Design • EV • Powertrain • Testing',
    hero: null,
    pageHeroes: {},
    thumbs: [C('thumb-auto-manifold'), C('thumb-mech-gearbox'), C('thumb-mech-lab-3')],
    skills: ['CATIA', 'NX', 'MATLAB/Simulink', 'GT-Power', 'CAN Bus', 'Vehicle Dynamics', 'Battery Systems', 'DFMEA'],
    topics: ['IC Engines', 'Vehicle Dynamics', 'EV Powertrain', 'Automotive Electronics', 'Chassis Design'],
    domains: ['Automotive & EV', 'Powertrain', 'Vehicle Testing', 'Body & Chassis'],
  },
  {
    id: 'metallurgy',
    label: 'Metallurgy & Materials',
    long: 'Metallurgical & Materials Engineering',
    color: '#64748B',
    soft: '#F1F5F9',
    icon: 'Layers',
    tagline: 'Materials • Heat Treatment • Testing • Processing',
    hero: null,
    pageHeroes: {},
    thumbs: [C('thumb-meta-cnc-machining'), C('thumb-meta-manufacturing'), C('thumb-mech-cnc-fixture')],
    skills: ['Metallography', 'SEM/XRD', 'Heat Treatment', 'Thermo-Calc', 'NDT', 'Welding', 'Casting', 'Materials Testing'],
    topics: ['Physical Metallurgy', 'Phase Diagrams', 'Heat Treatment', 'Mechanical Behaviour', 'Corrosion'],
    domains: ['Materials Testing', 'Steel & Foundry', 'Welding & Joining', 'Advanced Materials'],
  },
]

export const BRANCH_BY_ID = Object.fromEntries(BRANCHES.map((b) => [b.id, b]))

const ALIASES = {
  mech: 'mechanical', mechanical: 'mechanical', 'mechanical engineering': 'mechanical',
  civil: 'civil', 'civil engineering': 'civil',
  eee: 'eee', electrical: 'eee', 'electrical / eee': 'eee', 'electrical & electronics': 'eee', 'electrical engineering': 'eee',
  ece: 'ece', 'electronics & communication': 'ece', 'electronics and communication': 'ece', electronics: 'ece', 'electronics & comm.': 'ece',
  chemical: 'chemical', 'chemical engineering': 'chemical',
  aerospace: 'aerospace', aero: 'aerospace', aeronautical: 'aerospace',
  automobile: 'automobile', automotive: 'automobile', auto: 'automobile',
  metallurgy: 'metallurgy', 'metallurgy & materials': 'metallurgy', materials: 'metallurgy', 'metallurgical & materials': 'metallurgy',
}

/** Resolve any branch id / label the backend or user typed to a catalogue entry. */
export function getBranch(value) {
  if (!value) return BRANCH_BY_ID.mechanical
  const key = String(value).trim().toLowerCase()
  if (BRANCH_BY_ID[key]) return BRANCH_BY_ID[key]
  if (ALIASES[key]) return BRANCH_BY_ID[ALIASES[key]]
  const hit = Object.keys(ALIASES).find((a) => key.includes(a))
  return hit ? BRANCH_BY_ID[ALIASES[hit]] : BRANCH_BY_ID.mechanical
}

/**
 * Best hero media for a branch + page, in priority order:
 * your own photo (src/assets/branches/<id>/<page|hero>.jpg) → page-specific
 * approved crop → branch hero crop → collage of the branch's approved thumbnails.
 */
export function heroMedia(branch, page) {
  const b = typeof branch === 'string' ? getBranch(branch) : branch
  const own = (page && custom(b.id, page)) || custom(b.id, 'hero')
  const approved = own || (page && b.pageHeroes[page]) || b.hero
  return { src: approved, collage: approved ? null : b.thumbs.slice(0, 3), branch: b, isCustom: !!own }
}

/** Thumbnail for card n of a branch (wraps around). Custom thumb-1.jpg… override. */
export function branchThumb(branch, n = 0) {
  const b = typeof branch === 'string' ? getBranch(branch) : branch
  return custom(b.id, `thumb-${(n % 6) + 1}`) || b.thumbs[n % b.thumbs.length]
}
