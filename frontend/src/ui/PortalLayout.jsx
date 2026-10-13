import React, { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Bell, ChevronDown, Menu as MenuIcon, Search, LogOut, X } from 'lucide-react'
import { Avatar, Brand, LogoTile, Menu, cx, timeAgo } from './index.jsx'
import { useApi } from './useApi.js'
import { haptic } from '../lib/platform.js'

/**
 * Shared shell for the student, recruiter and admin areas:
 * left sidebar (drawer on tablets/phones) + sticky top bar with search,
 * notifications and the account menu + bottom tab bar on phones.
 */
export default function PortalLayout({
  role,
  brandSub,
  nav,
  bottomNav = [],
  tabs = [],
  user,
  userMenu = [],
  onLogout,
  searchPlaceholder = 'Search…',
  onSearch,
  outletContext,
  children,
}) {
  const [drawer, setDrawer] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const [q, setQ] = useState('')
  const location = useLocation()

  useEffect(() => { setDrawer(false); window.scrollTo({ top: 0 }) }, [location.pathname])
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const NavItem = ({ item }) => {
    const Icon = item.icon
    return (
      <NavLink to={item.to} end={item.end} className={({ isActive }) => cx('cl-nav-item', (item.match ? item.match(location) : isActive) && 'active')}>
        <Icon size={20} strokeWidth={1.9} />
        <span>{item.label}</span>
      </NavLink>
    )
  }

  return (
    <div className="cl-app">
      <div className="cl-shell">
        {drawer && <div className="cl-scrim" onClick={() => setDrawer(false)} aria-hidden="true" />}
        <aside className={cx('cl-sidebar', drawer && 'open')} aria-label="Main navigation">
          <div className="cl-row" style={{ justifyContent: 'space-between' }}>
            <Brand sub={brandSub} to={nav[0]?.to || '/'} />
            {drawer && <button type="button" className="cl-icon-btn" aria-label="Close menu" onClick={() => setDrawer(false)}><X size={20} /></button>}
          </div>
          <nav className="cl-nav">{nav.map((it) => <NavItem key={it.to + it.label} item={it} />)}</nav>
          {bottomNav.length > 0 && <nav className="cl-nav cl-nav-bottom">{bottomNav.map((it) => <NavItem key={it.to} item={it} />)}</nav>}
        </aside>

        <div className="cl-main">
          <header className={cx('cl-topbar', scrolled && 'scrolled')}>
            <button type="button" className="cl-icon-btn cl-menu-btn" aria-label="Open menu" onClick={() => setDrawer(true)}><MenuIcon size={22} /></button>
            {onSearch ? (
              <form className="cl-search" role="search" onSubmit={(e) => { e.preventDefault(); onSearch(q.trim()) }}>
                <Search size={18} />
                <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={searchPlaceholder} aria-label={searchPlaceholder} enterKeyHint="search" />
              </form>
            ) : <div className="cl-grow" />}
            <div className="cl-top-actions">
              <NotificationBell role={role} />
              <Menu
                items={[...userMenu, onLogout && { label: 'Log out', icon: LogOut, onClick: onLogout, danger: true }]}
              >
                <button type="button" className="cl-user" aria-label="Account menu">
                  {user?.logo ? <LogoTile name={user.name} src={user.src} size={40} /> : <Avatar name={user?.name} src={user?.src} size={40} />}
                  <span className="cl-user-text"><strong>{user?.name}</strong><small>{user?.sub}</small></span>
                  <ChevronDown size={18} className="cl-user-text" />
                </button>
              </Menu>
            </div>
          </header>
          <main className="cl-content cl-page-enter" key={location.pathname}>
            {children || <Outlet context={outletContext} />}
          </main>
        </div>
      </div>

      {tabs.length > 0 && (
        <nav className="cl-tabbar" aria-label="Quick navigation">
          {tabs.map((t) => {
            const Icon = t.icon
            return (
              <NavLink key={t.to} to={t.to} end={t.end} onClick={() => haptic('light')} className={({ isActive }) => cx('cl-tab', (isActive || t.match?.(location)) && 'active')}>
                <Icon size={21} />
                <span>{t.short || t.label}</span>
              </NavLink>
            )
          })}
        </nav>
      )}
    </div>
  )
}

/** Bell with unread count; data from GET /api/notifications (role-aware). */
function NotificationBell({ role }) {
  const api = useApi(role)
  const navigate = useNavigate()
  const [items, setItems] = useState([])
  const [seen, setSeen] = useState(() => {
    try { return localStorage.getItem(`cl_notif_seen_${role}`) || '' } catch { return '' }
  })
  useEffect(() => {
    let alive = true
    const load = () => api.get('/api/notifications').then((d) => alive && setItems(d?.items || [])).catch(() => {})
    load()
    const t = setInterval(load, 60000)
    return () => { alive = false; clearInterval(t) }
  }, [api])
  const unread = items.filter((n) => !seen || n.at > seen).length
  const markSeen = () => {
    const latest = items[0]?.at || new Date().toISOString()
    setSeen(latest)
    try { localStorage.setItem(`cl_notif_seen_${role}`, latest) } catch { /* ignore */ }
  }
  return (
    <Menu
      label="Notifications"
      items={items.length ? items.slice(0, 8).map((n) => ({ label: `${n.title}${n.at ? ` · ${timeAgo(n.at)}` : ''}`, onClick: () => n.link && navigate(n.link) })) : [{ label: 'No notifications yet', disabled: true }]}
    >
      <button type="button" className="cl-bell" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} onClick={markSeen}>
        <Bell size={21} />
        {unread > 0 && <span className="cl-dot">{unread > 9 ? '9+' : unread}</span>}
      </button>
    </Menu>
  )
}
