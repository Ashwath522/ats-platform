import React from 'react'
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { CompanyLogo, DemoBadge, faviconUrl } from '../companies.jsx'

describe('CompanyLogo', () => {
  it('builds the site-icon URL from the official domain', () => {
    expect(faviconUrl('bosch.com')).toBe('https://www.google.com/s2/favicons?domain=bosch.com&sz=128')
    expect(faviconUrl(null)).toBeNull()
  })

  it('shows the company site icon when a domain is known', () => {
    const html = renderToStaticMarkup(<CompanyLogo name="Bosch" domain="bosch.com" size={40} />)
    expect(html).toContain('src="https://www.google.com/s2/favicons?domain=bosch.com&amp;sz=128"')
    expect(html).toContain('alt="Bosch logo"')
  })

  it('falls back to the monogram tile without a domain (demo companies)', () => {
    const html = renderToStaticMarkup(<CompanyLogo name="Demo · Precision Gears Pvt Ltd" />)
    expect(html).not.toContain('<img')
    expect(html).toContain('cl-logo')
  })

  it('prefers an uploaded logo over the favicon', () => {
    const html = renderToStaticMarkup(<CompanyLogo name="Acme" domain="acme.com" src="/media/company-logos/a.png" />)
    expect(html).not.toContain('google.com/s2')
  })
})

describe('DemoBadge', () => {
  it('is clearly labelled', () => {
    expect(renderToStaticMarkup(<DemoBadge />)).toContain('Demo company')
    expect(renderToStaticMarkup(<DemoBadge compact />)).toContain('Demo')
  })
})
