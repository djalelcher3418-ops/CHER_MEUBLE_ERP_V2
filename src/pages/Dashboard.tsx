import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { dzd, num, supabase } from '../lib/supabase'
import { UNIT_LABELS, type MaterialPublic, type SupplierBalance } from '../lib/types'

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

  useEffect(() => {
    const monthStart = new Date()
    monthStart.setDate(1)
    monthStart.setHours(0, 0, 0, 0)
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
      supabase.from('stock_movements').select('qty, unit_cost').eq('type', 'out').gte('created_at', monthStart.toISOString()),
    ]).then(([v, l, d, o, mo]) => {
      setStockValue(((v.data as { value: number }[]) ?? []).reduce((a, r) => a + Number(r.value), 0))
      setLow((l.data as MaterialPublic[]) ?? [])
      setDebts((d.data as SupplierBalance[]) ?? [])
      setOuts((o.data as unknown as OutRow[]) ?? [])
      setMonthOut(((mo.data as { qty: number; unit_cost: number | null }[]) ?? []).reduce((a, r) => a + Number(r.qty) * Number(r.unit_cost ?? 0), 0))
    })
  }, [])

  const totalDebt = debts.reduce((a, r) => a + Number(r.balance), 0)

  return (
    <div>
      <h2>الرئيسية</h2>
      <div className="stats">
        <div className="stat"><span>قيمة المخزون</span><strong>{dzd(stockValue)}</strong></div>
        <div className="stat"><span>ديون الموردين</span><strong className={totalDebt > 0 ? 'neg' : ''}>{dzd(totalDebt)}</strong></div>
        <div className="stat"><span>مواد خرجت للورشة هذا الشهر</span><strong>{dzd(monthOut)}</strong></div>
        <div className="stat"><span>مواد ناقصة</span><strong className={low.length ? 'neg' : ''}>{low.length}</strong></div>
      </div>

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
              <span className="muted">{o.profiles?.full_name ?? ''} · {new Date(o.created_at).toLocaleString('fr-DZ')}</span>
            </li>
          ))}
          {!outs.length && <li className="muted">لا حركات بعد</li>}
        </ul>
      </section>
    </div>
  )
}
