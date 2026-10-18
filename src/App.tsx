import { lazy, Suspense, useEffect, useState, type FormEvent } from 'react'
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import Icon, { type IconName } from './components/Icon'
import Modal from './components/Modal'
import { useAuth } from './lib/auth'
import { enablePush, forgetPush } from './lib/push'
import { arabicError, configMissing, supabase } from './lib/supabase'
import { useTableLabels } from './lib/useTableLabels'
import { UnreadContext, useUnread } from './lib/useUnread'
import Login from './pages/Login'

// كل صفحة تُحمَّل عند فتحها فقط، فيفتح التطبيق أسرع على الهاتف
const Accounts = lazy(() => import('./pages/Accounts'))
const Status = lazy(() => import('./pages/Status'))
const Track = lazy(() => import('./pages/Track'))
const Chat = lazy(() => import('./pages/Chat'))
const Customers = lazy(() => import('./pages/Customers'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Employees = lazy(() => import('./pages/Employees'))
const Expenses = lazy(() => import('./pages/Expenses'))
const Games = lazy(() => import('./pages/Games'))
const Invoice = lazy(() => import('./pages/Invoice'))
const Materials = lazy(() => import('./pages/Materials'))
const Messages = lazy(() => import('./pages/Messages'))
const MyPay = lazy(() => import('./pages/MyPay'))
const Orders = lazy(() => import('./pages/Orders'))
const Purchases = lazy(() => import('./pages/Purchases'))
const Reports = lazy(() => import('./pages/Reports'))
const ScanOut = lazy(() => import('./pages/ScanOut'))
const Suppliers = lazy(() => import('./pages/Suppliers'))
const Team = lazy(() => import('./pages/Team'))
const Workshop = lazy(() => import('./pages/Workshop'))

type Tab = { to: string; label: string; icon: IconName; end?: boolean; external?: boolean }

const ADMIN_TABS: Tab[] = [
  { to: '/', label: 'الرئيسية', icon: 'home', end: true },
  { to: '/orders', label: 'الطلبيات', icon: 'orders' },
  { to: '/workshop', label: 'الورشة', icon: 'workshop' },
  { to: '/team', label: 'الفريق', icon: 'team' },
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
  { to: '/accounts', label: 'الحسابات', icon: 'key' },
  { to: '/designer/', label: 'مصمم الأثاث', icon: 'designer', external: true },
  { to: '/status', label: 'حالة النظام', icon: 'status' },
]
const WORKER_TABS: Tab[] = [
  { to: '/workshop', label: 'الورشة', icon: 'workshop' },
  { to: '/scan', label: 'إخراج مواد', icon: 'scan' },
  { to: '/team', label: 'الفريق', icon: 'team' },
  { to: '/pay', label: 'راتبي', icon: 'pay' },
]

const Loading = () => <p className="muted center">جارٍ التحميل…</p>

// صفحات «الفريق» الثلاث تحت تبويب واحد في الشريط السفلي
const TEAM_PATHS = ['/team', '/messages', '/games']
const inTeam = (path: string) => TEAM_PATHS.some((p) => path === p || path.startsWith(p + '/'))

export default function App() {
  const { session, profile, loading, isAdmin, signOut } = useAuth()
  const location = useLocation()
  const [more, setMore] = useState(false)
  const [account, setAccount] = useState(false)
  const [main, setMain] = useState<HTMLElement | null>(null)
  const unread = useUnread(session && profile?.active ? session.user.id : undefined)
  const teamBadge = unread.chat + unread.feed
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

  // صفحة تتبع الطلبية للزبون: عامة، بدون دخول
  if (location.pathname.startsWith('/track/'))
    return (
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/track/:token" element={<Track />} />
        </Routes>
      </Suspense>
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
    <UnreadContext.Provider value={unread}>
    <div className="shell">
      <header className="appbar">
        <div className="logo">CM</div>
        <button className="title appbar-me" onClick={() => setAccount(true)} aria-label="حسابي">
          <strong>CHER MEUBLE</strong>
          <span>{profile.full_name}<em className="role">{isAdmin ? 'المدير' : 'عامل'}</em></span>
        </button>
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
                <Route path="/accounts" element={<Accounts />} />
                <Route path="/status" element={<Status />} />
                <Route path="/workshop" element={<Workshop />} />
                <Route path="/messages" element={<Messages />} />
                <Route path="/team" element={<Team />} />
                <Route path="/games" element={<Games />} />
                <Route path="/scan" element={<ScanOut />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </>
            ) : (
              <>
                <Route path="/workshop" element={<Workshop />} />
                <Route path="/scan" element={<ScanOut />} />
                <Route path="/messages" element={<Messages />} />
                <Route path="/team" element={<Team />} />
                <Route path="/games" element={<Games />} />
                <Route path="/pay" element={<MyPay />} />
                <Route path="*" element={<Navigate to="/workshop" replace />} />
              </>
            )}
          </Routes>
        </Suspense>
      </main>

      <nav className="tabbar no-print" aria-label="القائمة">
        {tabs.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end}
            className={({ isActive }) => `tab${isActive || (t.to === '/team' && inTeam(location.pathname)) ? ' active' : ''}`}>
            <Icon name={t.icon} />
            {t.label}
            {t.to === '/team' && teamBadge > 0 && <i className="dot">{teamBadge > 99 ? '99+' : teamBadge}</i>}
          </NavLink>
        ))}
        {isAdmin && (
          <button className={`tab${inMore ? ' active' : ''}`} onClick={() => setMore(true)}>
            <Icon name="more" />
            المزيد
          </button>
        )}
      </nav>

      {account && <MyAccount name={profile.full_name} phone={profile.phone} onLogout={logout} onClose={() => setAccount(false)} />}

      {more && (
        <Modal title="المزيد" onClose={() => setMore(false)}>
          <div className="more-grid">
            {ADMIN_MORE.map((t) => t.external ? (
              <a key={t.to} href={t.to}>
                <Icon name={t.icon} />
                {t.label}
              </a>
            ) : (
              <NavLink key={t.to} to={t.to} onClick={() => setMore(false)} className={({ isActive }) => (isActive ? 'active' : '')}>
                <Icon name={t.icon} />
                {t.label}
              </NavLink>
            ))}
          </div>
        </Modal>
      )}
    </div>
    </UnreadContext.Provider>
  )
}

/** حسابي: تغيير الرمز السري وتسجيل الخروج */
function MyAccount({ name, phone, onLogout, onClose }: { name: string; phone: string | null; onLogout: () => void; onClose: () => void }) {
  const [pin, setPin] = useState('')
  const [again, setAgain] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  async function save(e: FormEvent) {
    e.preventDefault()
    if (pin.length < 6) return setMsg({ ok: false, text: 'الرمز السري 6 أرقام على الأقل' })
    if (pin !== again) return setMsg({ ok: false, text: 'الرمزان غير متطابقين' })
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password: pin })
    setBusy(false)
    if (error) return setMsg({ ok: false, text: arabicError(error) })
    setPin('')
    setAgain('')
    setMsg({ ok: true, text: 'تم تغيير الرمز السري. استعمله في الدخول القادم.' })
  }

  return (
    <Modal title="حسابي" onClose={onClose}>
      <ul className="list">
        <li><span className="muted">الاسم</span><strong>{name}</strong></li>
        {phone && <li><span className="muted">رقم الدخول</span><strong dir="ltr">{phone}</strong></li>}
      </ul>
      <form className="form" onSubmit={save} style={{ marginTop: 14 }}>
        <h3 style={{ margin: 0 }}>تغيير الرمز السري</h3>
        <div className="grid3">
          <label>الرمز الجديد<input type="password" dir="ltr" inputMode="numeric" autoComplete="new-password" value={pin} onChange={(e) => setPin(e.target.value)} /></label>
          <label>أعد كتابته<input type="password" dir="ltr" inputMode="numeric" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} /></label>
        </div>
        {msg && <p className={msg.ok ? 'success' : 'error'}>{msg.text}</p>}
        <button type="submit" disabled={busy}>{busy ? '…' : 'حفظ الرمز'}</button>
      </form>
      <button className="danger big-btn" style={{ marginTop: 18 }} onClick={onLogout}>تسجيل الخروج</button>
    </Modal>
  )
}
