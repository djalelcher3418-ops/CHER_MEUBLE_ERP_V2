import { Navigate, NavLink, Route, Routes } from 'react-router-dom'
import { useAuth } from './lib/auth'
import { configMissing } from './lib/supabase'
import Customers from './pages/Customers'
import Dashboard from './pages/Dashboard'
import Invoice from './pages/Invoice'
import Login from './pages/Login'
import Materials from './pages/Materials'
import Orders from './pages/Orders'
import Purchases from './pages/Purchases'
import ScanOut from './pages/ScanOut'
import Suppliers from './pages/Suppliers'

export default function App() {
  const { session, profile, loading, isAdmin, signOut } = useAuth()

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

  if (loading) return <div className="center-page">جارٍ التحميل…</div>
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

  return (
    <div className="shell">
      <header className="topbar">
        <strong className="brand">CHER MEUBLE</strong>
        <nav>
          {isAdmin && <NavLink to="/" end>الرئيسية</NavLink>}
          {isAdmin && <NavLink to="/orders">الطلبيات</NavLink>}
          {isAdmin && <NavLink to="/customers">الزبائن</NavLink>}
          {isAdmin && <NavLink to="/materials">المواد</NavLink>}
          {isAdmin && <NavLink to="/purchases">المشتريات</NavLink>}
          {isAdmin && <NavLink to="/suppliers">الموردون</NavLink>}
          <NavLink to="/scan">إخراج مواد</NavLink>
        </nav>
        <span className="user">
          {profile.full_name}
          <button className="link" onClick={signOut}>خروج</button>
        </span>
      </header>
      <main className="content">
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
              <Route path="/scan" element={<ScanOut />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </>
          ) : (
            <>
              <Route path="/scan" element={<ScanOut />} />
              <Route path="*" element={<Navigate to="/scan" replace />} />
            </>
          )}
        </Routes>
      </main>
    </div>
  )
}
