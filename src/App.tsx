import { lazy, Suspense } from 'react'
import { Navigate, NavLink, Route, Routes } from 'react-router-dom'
import { useAuth } from './lib/auth'
import { configMissing } from './lib/supabase'
import Login from './pages/Login'

// كل صفحة تُحمَّل عند فتحها فقط، فيفتح التطبيق أسرع على الهاتف
const Customers = lazy(() => import('./pages/Customers'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Employees = lazy(() => import('./pages/Employees'))
const Expenses = lazy(() => import('./pages/Expenses'))
const Invoice = lazy(() => import('./pages/Invoice'))
const Materials = lazy(() => import('./pages/Materials'))
const MyPay = lazy(() => import('./pages/MyPay'))
const Orders = lazy(() => import('./pages/Orders'))
const Purchases = lazy(() => import('./pages/Purchases'))
const Reports = lazy(() => import('./pages/Reports'))
const ScanOut = lazy(() => import('./pages/ScanOut'))
const Suppliers = lazy(() => import('./pages/Suppliers'))
const Workshop = lazy(() => import('./pages/Workshop'))

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
          <NavLink to="/workshop">الورشة</NavLink>
          {isAdmin && <NavLink to="/customers">الزبائن</NavLink>}
          {isAdmin && <NavLink to="/materials">المواد</NavLink>}
          {isAdmin && <NavLink to="/purchases">المشتريات</NavLink>}
          {isAdmin && <NavLink to="/suppliers">الموردون</NavLink>}
          {isAdmin && <NavLink to="/employees">العمّال</NavLink>}
          {isAdmin && <NavLink to="/expenses">المصاريف</NavLink>}
          {isAdmin && <NavLink to="/reports">التقرير</NavLink>}
          <NavLink to="/scan">إخراج مواد</NavLink>
          {!isAdmin && <NavLink to="/pay">راتبي</NavLink>}
        </nav>
        <span className="user">
          {profile.full_name}
          <button className="link" onClick={signOut}>خروج</button>
        </span>
      </header>
      <main className="content">
        <Suspense fallback={<p className="muted">جارٍ التحميل…</p>}>
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
              <Route path="/scan" element={<ScanOut />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </>
          ) : (
            <>
              <Route path="/workshop" element={<Workshop />} />
              <Route path="/scan" element={<ScanOut />} />
              <Route path="/pay" element={<MyPay />} />
              <Route path="*" element={<Navigate to="/workshop" replace />} />
            </>
          )}
        </Routes>
        </Suspense>
      </main>
    </div>
  )
}
