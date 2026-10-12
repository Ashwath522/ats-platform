import React, { useEffect, useState } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { Search, Bell, ChevronRight } from 'lucide-react'
import { haptic } from '../lib/platform.js'
import './AppShell.css'

/**
 * Mobile-app style shell (shopping-app pattern): sticky dark header with logo,
 * account chip and a prominent search bar, a horizontally scrolling quick-link
 * strip, and a bottom tab bar. On wide screens the tabs move into the header.
 *
 * props:
 *  - tabs: [{ to, label, icon: LucideIcon, badge? }]
 *  - quickLinks: [{ to, label }]
 *  - searchPlaceholder, onSearch(q)
 *  - account: { initials, label, sublabel, to, avatarUrl }
 *  - context: small text under the header ("Matching for: …")
 *  - actions: extra header buttons (ReactNode)
 */
export default function AppShell({
  tabs = [],
  quickLinks = [],
  searchPlaceholder = 'Search',
  onSearch,
  account,
  context,
  actions,
  children,
  brandSuffix,
  onBrandDoubleClick,
}) {
  const navigate = useNavigate()
  const location = useLocation()
  const [q, setQ] = useState(() => new URLSearchParams(location.search).get('q') || '')
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [location.pathname])

  function submit(e) {
    e.preventDefault()
    if (onSearch) onSearch(q.trim())
  }

  return (
    <div className="app-shell-v2">
      <header className={`as-header ${scrolled ? 'is-scrolled' : ''}`}>
        <div className="as-header-inner">
          <div className="as-row as-row-top">
            <button
              type="button"
              className="as-brand"
              onClick={() => navigate(tabs[0]?.to || '/')}
              onDoubleClick={onBrandDoubleClick}
              aria-label="CoreLink home"
            >
              <span className="as-brand-mark" aria-hidden="true">
                <svg viewBox="0 0 32 32" width="28" height="28">
                  <rect x="2" y="2" width="28" height="28" rx="9" fill="url(#asg)" />
                  <path d="M20.5 11.2a6.2 6.2 0 1 0 0 9.6" stroke="#0B1F33" strokeWidth="3.2" fill="none" strokeLinecap="round" />
                  <circle cx="21.4" cy="16" r="2" fill="#0B1F33" />
                  <defs>
                    <linearGradient id="asg" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0" stopColor="#FFC24B" />
                      <stop offset="1" stopColor="#F59E0B" />
                    </linearGradient>
                  </defs>
                </svg>
              </span>
              <span className="as-brand-text">
                CoreLink{brandSuffix && <em>{brandSuffix}</em>}
              </span>
            </button>

            <nav className="as-desktop-tabs" aria-label="Primary">
              {tabs.map((t) => (
                <NavLink key={t.to} to={t.to} className={({ isActive }) => `as-dtab ${isActive ? 'active' : ''}`}>
                  {t.label}
                </NavLink>
              ))}
            </nav>

            <div className="as-actions">
              {actions}
              {account && (
                <button type="button" className="as-account" onClick={() => account.to && navigate(account.to)}>
                  <span className="as-account-text">
                    <small>{account.sublabel || 'Hello'}</small>
                    <strong>{account.label}</strong>
                  </span>
                  <span className="as-avatar" aria-hidden="true">
                    {account.avatarUrl ? <img src={account.avatarUrl} alt="" /> : account.initials}
                  </span>
                </button>
              )}
            </div>
          </div>

          {onSearch && (
            <form className="as-search" onSubmit={submit} role="search">
              <Search size={18} className="as-search-icon" aria-hidden="true" />
              <input
                type="search"
                inputMode="search"
                enterKeyHint="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
              />
              <button type="submit" className="as-search-btn" aria-label="Search">
                <Search size={18} />
              </button>
            </form>
          )}
        </div>

        {(context || quickLinks.length > 0) && (
          <div className="as-strip">
            <div className="as-strip-inner">
              {context && <span className="as-context">{context}</span>}
              {quickLinks.map((l) => (
                <Link
                  key={l.to + l.label}
                  to={l.to}
                  className={`as-chip ${location.pathname + location.search === l.to ? 'active' : ''}`}
                >
                  {l.label}
                  <ChevronRight size={14} aria-hidden="true" />
                </Link>
              ))}
            </div>
          </div>
        )}
      </header>

      <main className="as-main">{children}</main>

      <nav className="as-tabbar" aria-label="Tabs">
        {tabs.map((t) => {
          const Icon = t.icon || Bell
          return (
            <NavLink
              key={t.to}
              to={t.to}
              onClick={() => haptic('light')}
              className={({ isActive }) => `as-tab ${isActive ? 'active' : ''}`}
            >
              <span className="as-tab-icon">
                <Icon size={22} strokeWidth={2} />
                {t.badge ? <span className="as-badge">{t.badge}</span> : null}
              </span>
              <span className="as-tab-label">{t.label}</span>
            </NavLink>
          )
        })}
      </nav>
    </div>
  )
}
