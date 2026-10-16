import { describe, expect, it } from 'vitest'
import colleges from '../../data/colleges.json'
import { buildIndex, findCollege, matchColleges, normalize } from '../../lib/collegeMatch.js'
import { collegeMonogram } from '../CollegePicker.jsx'

const index = buildIndex(colleges)
const top = (q, n = 8) => matchColleges(index, q, n).map((c) => c.id)
const first = (q) => matchColleges(index, q, 1)[0]

describe('college matcher', () => {
  it('finds Atria by prefix and by full name', () => {
    expect(first('Atria').name).toBe('Atria Institute of Technology')
    expect(first('atr').name).toBe('Atria Institute of Technology')
    expect(first('Atria Institute of Technology').city).toBe('Bengaluru')
  })

  it('resolves short forms and spaced aliases', () => {
    expect(first('IIT B').name).toBe('Indian Institute of Technology Bombay')
    expect(first('iitb').name).toBe('Indian Institute of Technology Bombay')
    expect(first('IIT Bombay').id).toBe('iitb')
    expect(first('rvce').id).toBe('rvce')
    expect(first('rv').id).toBe('rvce')
    expect(first('pes').name).toBe('PES University')
    expect(first('PESU').name).toBe('PES University')
    expect(first('nitk').name).toMatch(/Surathkal/)
    expect(first('BMSCE').name).toBe('B.M.S. College of Engineering')
    expect(first('VIT').name).toBe('Vellore Institute of Technology')
    expect(first('VIT Pune').name).toBe('Vishwakarma Institute of Technology')
    expect(first('msrit').name).toMatch(/Ramaiah Institute of Technology/)
  })

  it('lists IITs for "IIT", in order, before IIITs', () => {
    const res = matchColleges(index, 'IIT', 8)
    expect(res).toHaveLength(8)
    expect(res.every((c) => c.type === 'IIT')).toBe(true)
    expect(res[0].id).toBe('iitb')
    const all = matchColleges(index, 'IIT', 100)
    expect(all.filter((c) => c.type === 'IIT')).toHaveLength(23)
    expect(all.findIndex((c) => c.type !== 'IIT')).toBeGreaterThanOrEqual(23)
  })

  it('ranks prefix > word-start > substring', () => {
    // "nit sur": word-starts of "NIT Surathkal" / "NIT Surat"
    expect(top('nit sur', 2).sort()).toEqual(['nitk', 'svnit'].sort())
    // substring hit only ("anipal" inside Manipal) ranks below prefix hits of other names
    const res = matchColleges(index, 'manipal', 8)
    expect(res[0].name).toMatch(/^Manipal/)
    expect(res.some((c) => c.name === 'Sikkim Manipal Institute of Technology')).toBe(true)
    expect(res.findIndex((c) => c.name === 'Sikkim Manipal Institute of Technology'))
      .toBeGreaterThan(res.findIndex((c) => c.name.startsWith('Manipal')))
  })

  it('ignores case, accents and punctuation; matches old city names', () => {
    expect(first('ÁTRÍA').name).toBe('Atria Institute of Technology')
    expect(first('b.m.s.').name).toBe('B.M.S. College of Engineering')
    expect(first('r.v.c.e').id).toBe('rvce')
    expect(normalize('  Dr. B. R. Ambedkar & Co ')).toBe('dr b r ambedkar and co')
    const blr = matchColleges(index, 'engineering bangalore', 8)
    expect(blr.length).toBeGreaterThan(0)
    expect(blr.every((c) => c.city === 'Bengaluru')).toBe(true)
  })

  it('tolerates a single typo on longer words', () => {
    expect(first('Thaper').name).toMatch(/Thapar/)
  })

  it('returns nothing for unknown text (free-text fallback) and caps results', () => {
    expect(matchColleges(index, 'Zzyzx Polytechnic Q', 8)).toEqual([])
    expect(matchColleges(index, '', 8)).toEqual([])
    expect(matchColleges(index, 'college', 8).length).toBeLessThanOrEqual(8)
  })

  it('finds a saved college by id or name', () => {
    expect(findCollege(index, { id: 'rvce' }).domain).toBe('rvce.edu.in')
    expect(findCollege(index, { name: 'atria institute of technology' }).id).toBe(first('Atria').id)
    expect(findCollege(index, { name: 'IIT Madras' }).id).toBe('iitm')
    expect(findCollege(index, { name: 'My Local Polytechnic' })).toBeNull()
  })

  it('builds short monograms', () => {
    expect(collegeMonogram('Rashtreeya Vidyalaya College of Engineering', findCollege(index, { id: 'rvce' }))).toBe('RVCE')
    expect(collegeMonogram('Some Unknown College of Arts')).toBe('SUC')
    expect(collegeMonogram('Anna')).toBe('AN')
  })
})

describe('college dataset', () => {
  it('is reasonably sized', () => {
    expect(colleges.length).toBeGreaterThanOrEqual(400)
    expect(JSON.stringify(colleges).length).toBeLessThan(100_000)
  })
  it('has unique ids and unique normalised names', () => {
    const ids = colleges.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    ids.forEach((id) => expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/))
    const names = colleges.map((c) => normalize(c.name))
    expect(new Set(names).size).toBe(names.length)
  })
  it('has valid fields and hostname-shaped domains', () => {
    const TYPES = new Set(['IIT', 'NIT', 'IIIT', 'Govt', 'Deemed', 'Private'])
    for (const c of colleges) {
      expect(c.name.length).toBeGreaterThan(3)
      expect(TYPES.has(c.type)).toBe(true)
      expect(c.city).toBeTruthy()
      expect(c.state).toBeTruthy()
      expect(Array.isArray(c.aliases)).toBe(true)
      if (c.domain) expect(c.domain).toMatch(/^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/)
    }
  })
  it('contains every IIT and NIT', () => {
    expect(colleges.filter((c) => c.type === 'IIT')).toHaveLength(23)
    expect(colleges.filter((c) => c.type === 'NIT')).toHaveLength(31)
    const iits = ['Bombay', 'Delhi', 'Madras', 'Kanpur', 'Kharagpur', 'Roorkee', 'Guwahati', 'Hyderabad', 'Indore', 'BHU', 'ISM',
      'Ropar', 'Bhubaneswar', 'Gandhinagar', 'Jodhpur', 'Patna', 'Mandi', 'Tirupati', 'Palakkad', 'Jammu', 'Dharwad', 'Bhilai', 'Goa']
    iits.forEach((x) => expect(colleges.some((c) => c.type === 'IIT' && c.name.includes(x))).toBe(true))
    const nits = ['Tiruchirappalli', 'Surathkal', 'Warangal', 'Calicut', 'Rourkela', 'Allahabad', 'Jaipur', 'Nagpur', 'Surat', 'Bhopal',
      'Kurukshetra', 'Durgapur', 'Silchar', 'Hamirpur', 'Jalandhar', 'Jamshedpur', 'Patna', 'Raipur', 'Srinagar', 'Agartala', 'Delhi',
      'Goa', 'Puducherry', 'Uttarakhand', 'Meghalaya', 'Manipur', 'Mizoram', 'Nagaland', 'Sikkim', 'Arunachal Pradesh', 'Andhra Pradesh']
    nits.forEach((x) => expect(colleges.some((c) => c.type === 'NIT' && c.name.includes(x))).toBe(true))
  })
  it('includes key institutions', () => {
    for (const q of ['IISc', 'BITS Pilani', 'COEP', 'VJTI', 'Jadavpur', 'CEG', 'PSG', 'DTU', 'NSUT', 'SJCE', 'NIE', 'KLE Tech', 'SRM',
      'Amrita', 'Thapar', 'LPU', 'Chandigarh University', 'KIIT', 'Nirma', 'MIT-WPU', 'PICT', 'NMIT', 'CMRIT', 'Sir MVIT', 'DSCE'])
      expect(findCollege(index, { name: q }), q).toBeTruthy()
  })
})
