import { NavLink } from 'react-router-dom'
import { useUnreadCounts } from '../lib/useUnread'

/** أعلى صفحات «الفريق»: المنشورات، الدردشة، الألعاب */
export default function TeamNav() {
  const { chat, feed } = useUnreadCounts()
  const tabs = [
    { to: '/team', label: 'المنشورات', n: feed },
    { to: '/messages', label: 'الدردشة', n: chat },
    { to: '/games', label: 'الألعاب', n: 0 },
  ]
  return (
    <nav className="seg" aria-label="الفريق">
      {tabs.map((t) => (
        <NavLink key={t.to} to={t.to} end className={({ isActive }) => (isActive ? 'active' : '')}>
          {t.label}
          {t.n > 0 && <i className="unread">{t.n > 99 ? '99+' : t.n}</i>}
        </NavLink>
      ))}
    </nav>
  )
}
