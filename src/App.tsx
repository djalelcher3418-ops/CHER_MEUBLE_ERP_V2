import { lazy, Suspense, useEffect, useState } from 'react'
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import Icon, { type IconName } from './components/Icon'
import Modal from './components/Modal'
import { useAuth } from './lib/auth'
import { enablePush, forgetPush } from './lib/push'
import { configMissing } from './lib/supabase'
import { useTableLabels } from './lib/useTableLabels'
import { useUnread } from './lib/useUnread'
import Login from './pages/Login'

// كل صفحة تُحمَّل عند فتحها فقط، فيفتح التطبيق أسرع على الهاتف
const Chat = lazy(() => import('./pages/Chat'))
const Customers = lazy(() => import('./pages/Customers'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Employees = lazy(() => import('./pages/Employees'))
const Expenses = lazy(() => import('./pages/Expenses'))
const Invoice = lazy(() => import('./pages/Invoice'))
const Materials = lazy(() => import('./pages/Materials'))
const Messages = lazy(() => import('./pages/Messages'))
const MyPay = lazy(() => import('./pages/MyPay'))
const Orders = lazy(() => import('./pages/Orders'))
const Purchases = lazy(() => import('./pages/Purchases'))
const Reports = lazy(() => import('./pages/Reports'))
const ScanOut = lazy(() => import('./pages/ScanOut'))
const Suppliers = lazy(() => import('./pages/Suppliers'))
const Workshop = lazy(() => import('./pages/Workshop'))

type Tab = { to: string; label: string; icon: IconName; end?: boolean }

const ADMIN_TABS: Tab[] = [
  { to: '/', label: 'الرئيسية', icon: 'home', end: true },
  { to: '/orders', label: 'الطلبيات', icon: 'orders' },
  { to: '/workshop', label: 'الورشة', icon: 'workshop' },
  { to: '/messages', label: 'الرسائل', icon: 'chat' },
]
const ADMIN_MORE: Tab[] = [
  { to: '/customers', label: 'الزبائن', icon: 'customers' },
  { to: '/materials', label: 'المواد', icon: 'materials' },
  { to: '/scan', label: 'إخراج مواد', icon: 'scan' },
  { to: '/purchases', label: 'المشتريات', icon: 'purchases' },
  { to: '/suppliers', label: 'الموردون', icon: 'suppliers' },
  { to: '/employees', label: 'العمّال', icon: 'employees' },
  { to: '/expenses', label: 'المصاريف', icon: 'expenses' },
  { to: '/reports', label: 'التقرير', icon: 'reports' },
]
const WORKER_TABS: Tab[] = [
  { to: '/workshop', label: 'الورشة', icon: 'workshop' },
  { to: '/scan', label: 'إخراج مواد', icon: 'scan' },
  { to: '/messages', label: 'الرسائل', icon: 'chat' },
  { to: '/pay', label: 'راتبي', icon: 'pay' },
]

const Loading = () => <p className="muted center">جارٍ التحميل…</p>

export default function App() {
  const { session, profile, loading, isAdmin, signOut } = useAuth()
  const location = useLocation()
  const [more, setMore] = useState(false)
  const [main, setMain] = useState<HTMLElement | null>(null)
  const unread = useUnread(session && profile?.active ? session.user.id : undefined)
  useTableLabels(main)

  // إن سبق السماح بالتنبيهات على هذا الهاتف، نجدّد تسجيله بصمت عند الدخول
  const myId = session && profile?.active ? session.user.id : undefined
  useEffect(() => {
    if (myId && 'Notification' in window && Notification.permission === 'granted') enablePush(false)
  }, [myId])

  async function logout() {
    if (!confirm('تسجيل الخروج؟')) return
    await forgetPush()
    await signOut()
  }

  if (configMissing)
    return (
      <div className="center-page">
        <div className="card narrow">
          <h2>الإعداد ناقص</h2>
          <p>
            أضف المتغيّرين <code>VITE_SUPABASE_URL</code> و <code>VITE_SUPABASE_ANON_KEY</code> في Cloudflare Pages
            (أو في ملف <code>.env</code>).
          </p>
        </div>
      </div>
    )

  if (loading) return <div className="center-page"><div className="login-logo">CM</div></div>
  if (!session) return <Login />
  if (!profile || !profile.active)
    return (
      <div className="center-page">
        <div className="card narrow">
          <p>هذا الحساب غير مفعّل. اتصل بالمدير.</p>
          <button onClick={signOut}>خروج</button>
        </div>
      </div>
    )

  // صفحة الدردشة تأخذ الشاشة كاملة مثل تطبيقات المراسلة
  if (/^\/messages\/\d+/.test(location.pathname))
    return (
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/messages/:id" element={<Chat />} />
        </Routes>
      </Suspense>
    )

  const tabs = isAdmin ? ADMIN_TABS : WORKER_TABS
  const inMore = isAdmin && ADMIN_MORE.some((t) => location.pathname.startsWith(t.to))

  return (
    <div className="shell">
      <header className="appbar">
        <div className="logo">CM</div>
        <div className="title">
          <strong>CHER MEUBLE</strong>
          <span>{profile.full_name} · {isAdmin ? 'المدير' : 'عامل'}</span>
        </div>
        <button className="icon-btn" onClick={logout} aria-label="خروج"><Icon name="logout" /></button>
      </header>

      <main className="content" ref={setMain}>
        <Suspense fallback={<Loading />}>
          <Routes>
            {isAdmin ? (
              <>
                <Route path="/" element={<Dashboard />} />
                <Route path="/orders" element={<Orders />} />
                <Route path="/customers" element={<Customers />} />
                <Route path="/invoice/:id" element={<Invoice />} />
                <Route path="/materials" element={<Materials />} />
                <Route path="/purchases" element={<Purchases />} />
                <Route path="/suppliers" element={<Suppliers />} />
                <Route path="/employees" element={<Employees />} />
                <Route path="/expenses" element={<Expenses />} />
                <Route path="/reports" element={<Reports />} />
                <Route path="/workshop" element={<Workshop />} />
                <Route path="/messages" element={<Messages />} />
                <Route path="/scan" element={<ScanOut />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </>
            ) : (
              <>
                <Route path="/workshop" element={<Workshop />} />
                <Route path="/scan" element={<ScanOut />} />
                <Route path="/messages" element={<Messages />} />
                <Route path="/pay" element={<MyPay />} />
                <Route path="*" element={<Navigate to="/workshop" replace />} />
              </>
            )}
          </Routes>
        </Suspense>
      </main>

      <nav className="tabbar no-print" aria-label="القائمة">
        {tabs.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => `tab${isActive ? ' active' : ''}`}>
            <Icon name={t.icon} />
            {t.label}
            {t.to === '/messages' && unread > 0 && <i className="dot">{unread > 99 ? '99+' : unread}</i>}
          </NavLink>
        ))}
        {isAdmin && (
          <button className={`tab${inMore ? ' active' : ''}`} onClick={() => setMore(true)}>
            <Icon name="more" />
            المزيد
          </button>
        )}
      </nav>

      {more && (
        <Modal title="المزيد" onClose={() => setMore(false)}>
          <div className="more-grid">
            {ADMIN_MORE.map((t) => (
              <NavLink key={t.to} to={t.to} onClick={() => setMore(false)} className={({ isActive }) => (isActive ? 'active' : '')}>
                <Icon name={t.icon} />
                {t.label}
              </NavLink>
            ))}
          </div>
        </Modal>
      )}
    </div>
  )
}
