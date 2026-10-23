import { describe, expect, it } from 'vitest'
import { buildDeepLink, truecallerSupported } from '../truecaller.js'

describe('truecaller', () => {
  it('only offers the web flow on Android phone browsers', () => {
    expect(truecallerSupported('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36')).toBe(true)
    expect(truecallerSupported('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148 Safari/604.1')).toBe(false)
    expect(truecallerSupported('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Safari/605.1.15')).toBe(false)
    expect(truecallerSupported('Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 Chrome/126 Safari/537.36')).toBe(false) // tablet
  })
  it('builds the Truecaller deep link with our nonce and partner key', () => {
    const u = new URL(buildDeepLink({ nonce: 'abc', partnerKey: 'pk1', partnerName: 'CoreLink', origin: 'https://corelink-pi.vercel.app' }).replace('truecallersdk:', 'https:'))
    expect(u.pathname).toBe('/web_verify')
    expect(u.searchParams.get('requestNonce')).toBe('abc')
    expect(u.searchParams.get('partnerKey')).toBe('pk1')
    expect(u.searchParams.get('privacyUrl')).toBe('https://corelink-pi.vercel.app/privacy')
    expect(u.searchParams.get('type')).toBe('btmsheet')
  })
})
