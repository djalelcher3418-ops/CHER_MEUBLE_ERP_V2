import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { checkDatabase } from '../lib/health'
import { monthRange, thisMonth } from '../lib/payroll'
import { dateTime, dzd, num, supabase, todayISO } from '../lib/supabase'
import {
  ORDER_STATUS_LABELS,
  UNIT_LABELS,
  type CustomerBalance,
  type MaterialPublic,
  type OrderTotal,
  type SupplierBalance,
} from '../lib/types'

interface OutRow {
  id: number
  qty: number
  unit_cost: number | null
  note: string | null
  created_at: string
  materials: { name: string } | null
  profiles: { full_name: string } | null
}

export default function Dashboard() {
  const [stockValue, setStockValue] = useState(0)
  const [low, setLow] = useState<MaterialPublic[]>([])
  const [debts, setDebts] = useState<SupplierBalance[]>([])
  const [outs, setOuts] = useState<OutRow[]>([])
  const [monthOut, setMonthOut] = useState(0)
  const [receivable, setReceivable] = useState(0)
  const [active, setActive] = useState<OrderTotal[]>([])
  const today = todayISO()
  const [setupMissing, setSetupMissing] = useState(0)

  useEffect(() => {
    checkDatabase().then((c) => setSetupMissing(c.filter((x) => !x.ok).length))
  }, [])

  useEffect(() => {
    const { from, to } = monthRange(thisMonth())
    Promise.all([
      supabase.from('stock_value').select('value'),
      supabase.from('materials_public').select('*').eq('low_stock', true).order('name'),
      supabase.from('supplier_balances').select('*').gt('balance', 0).order('balance', { ascending: false }),
      supabase
        .from('stock_movements')
        .select('id, qty, unit_cost, note, created_at, materials(name), profiles(full_name)')
        .eq('type', 'out')
        .order('created_at', { ascending: false })
        .limit(10),
      supabase.rpc('month_summary', { p_from: from, p_to: to }),
      supabase.from('customer_balances').select('balance').gt('balance', 0),
      supabase
        .from('order_totals')
        .select('*')
        .in('status', ['new', 'in_production', 'ready'])
        .order('due_date', { ascending: true, nullsFirst: false }),
    ]).then(([v, l, d, o, mo, cb, ac]) => {
      setReceivable(((cb.data as Pick<CustomerBalance, 'balance'>[]) ?? []).reduce((a, r) => a + Number(r.balance), 0))
      setActive(((ac.data as OrderTotal[]) ?? []).filter((o) => !o.is_quote)) // عروض الأسعار ليست طلبيات جارية
      setStockValue(((v.data as { value: number }[]) ?? []).reduce((a, r) => a + Number(r.value), 0))
      setLow((l.data as MaterialPublic[]) ?? [])
      setDebts((d.data as SupplierBalance[]) ?? [])
      setOuts((o.data as unknown as OutRow[]) ?? [])
      setMonthOut(Number((mo.data as { materials_out?: number } | null)?.materials_out ?? 0))
    })
  }, [])

  const totalDebt = debts.reduce((a, r) => a + Number(r.balance), 0)

  return (
    <div>
      <h2>الرئيسية</h2>
      {setupMissing > 0 && (
        <p className="error">الإعداد غير مكتمل: ينقص {setupMissing} من ملفات قاعدة البيانات، فبعض الصفحات لن تعمل. <Link to="/status">افتح حالة النظام</Link></p>
      )}
      <div className="stats">
        <div className="stat"><span>طلبيات جارية</span><strong>{active.length}</strong></div>
        <div className="stat"><span>لك عند الزبائن</span><strong>{dzd(receivable)}</strong></div>
        <div className="stat"><span>قيمة المخزون</span><strong>{dzd(stockValue)}</strong></div>
        <div className="stat"><span>ديون الموردين</span><strong className={totalDebt > 0 ? 'neg' : ''}>{dzd(totalDebt)}</strong></div>
        <div className="stat"><span>مواد خرجت للورشة هذا الشهر</span><strong>{dzd(monthOut)}</strong></div>
        <div className="stat"><span>مواد ناقصة</span><strong className={low.length ? 'neg' : ''}>{low.length}</strong></div>
      </div>

      <section className="card">
        <h3>مواعيد التسليم <Link to="/orders" className="small">كل الطلبيات</Link></h3>
        <ul className="list">
          {active.slice(0, 8).map((o) => {
            const late = !!o.due_date && o.due_date < today
            return (
              <li key={o.id}>
                <Link to={`/orders?open=${o.id}`}>{o.id} — {o.title} — {o.customer_name}</Link>
                <span className={`meta ${late ? 'neg' : 'muted'}`}>
                  <span className={`status st-${o.status}`}>{ORDER_STATUS_LABELS[o.status]}</span>
                  <span>{o.due_date ?? 'بدون موعد'}{late ? ' (متأخرة)' : ''}</span>
                </span>
              </li>
            )
          })}
          {!active.length && <li className="muted">لا طلبيات جارية</li>}
        </ul>
      </section>

      <div className="two-col">
        <section className="card">
          <h3>مواد ناقصة <Link to="/materials" className="small">عرض الكل</Link></h3>
          <ul className="list">
            {low.map((m) => (
              <li key={m.id}><span>{m.name}</span><span className="neg">{num(m.qty)} / {num(m.min_qty)} {UNIT_LABELS[m.unit]}</span></li>
            ))}
            {!low.length && <li className="muted">لا شيء ناقص</li>}
          </ul>
        </section>

        <section className="card">
          <h3>ديون الموردين <Link to="/suppliers" className="small">عرض الكل</Link></h3>
          <ul className="list">
            {debts.slice(0, 8).map((s) => (
              <li key={s.id}><span>{s.name}</span><span>{dzd(s.balance)}</span></li>
            ))}
            {!debts.length && <li className="muted">لا ديون</li>}
          </ul>
        </section>
      </div>

      <section className="card">
        <h3>آخر ما خرج للورشة</h3>
        <ul className="list">
          {outs.map((o) => (
            <li key={o.id}>
              <span>{o.materials?.name} — {num(o.qty)} {o.note ? `(${o.note})` : ''}</span>
              <span className="muted meta"><span>{o.profiles?.full_name ?? ''}</span><span>{dateTime(o.created_at)}</span></span>
            </li>
          ))}
          {!outs.length && <li className="muted">لا حركات بعد</li>}
        </ul>
      </section>
    </div>
  )
}
