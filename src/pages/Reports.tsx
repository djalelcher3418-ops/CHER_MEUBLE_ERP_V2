import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { monthRange, thisMonth } from '../lib/payroll'
import { arabicError, dzd, supabase } from '../lib/supabase'
import type { ExpenseCategory, OrderTotal } from '../lib/types'

interface Data {
  received: number
  suppliers: number
  payroll: number
  advances: number
  expenses: number
  expByCat: { name: string; sum: number }[]
  purchases: number
  materialsOut: number
  delivered: OrderTotal[]
}

const sum = <T,>(rows: T[] | null, f: (r: T) => number) => (rows ?? []).reduce((a, r) => a + f(r), 0)

/** تقرير الشهر: الحركة النقدية + ربح الطلبيات المسلّمة */
export default function Reports() {
  const [month, setMonth] = useState(thisMonth)
  const [d, setD] = useState<Data | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const { from, to } = monthRange(month)
    const toTs = new Date(`${to}T23:59:59.999`).toISOString()
    const fromTs = new Date(`${from}T00:00:00`).toISOString()
    Promise.all([
      supabase.from('customer_payments').select('amount').gte('paid_on', from).lte('paid_on', to),
      supabase.from('supplier_payments').select('amount').gte('paid_on', from).lte('paid_on', to),
      supabase.from('payroll_payments').select('amount').gte('paid_on', from).lte('paid_on', to),
      supabase.from('employee_advances').select('amount').gte('given_on', from).lte('given_on', to),
      supabase.from('expenses').select('amount, category_id').gte('spent_on', from).lte('spent_on', to),
      supabase.from('expense_categories').select('*'),
      supabase.from('purchase_totals').select('total').gte('purchase_date', from).lte('purchase_date', to),
      supabase.from('stock_movements').select('qty, unit_cost').eq('type', 'out').gte('created_at', fromTs).lte('created_at', toTs),
      supabase.from('order_totals').select('*').eq('status', 'delivered').gte('delivered_on', from).lte('delivered_on', to).order('delivered_on'),
    ]).then(([cp, sp, pp, adv, ex, cats, pu, mo, del]) => {
      const err = [cp, sp, pp, adv, ex, cats, pu, mo, del].find((r) => r.error)?.error
      if (err) setError(arabicError(err))
      type Amt = { amount: number }
      const exRows = (ex.data as { amount: number; category_id: number | null }[]) ?? []
      const catList = (cats.data as ExpenseCategory[]) ?? []
      setD({
        received: sum(cp.data as Amt[], (r) => Number(r.amount)),
        suppliers: sum(sp.data as Amt[], (r) => Number(r.amount)),
        payroll: sum(pp.data as Amt[], (r) => Number(r.amount)),
        advances: sum(adv.data as Amt[], (r) => Number(r.amount)),
        expenses: sum(exRows, (r) => Number(r.amount)),
        expByCat: catList
          .map((c) => ({ name: c.name, sum: sum(exRows.filter((r) => r.category_id === c.id), (r) => Number(r.amount)) }))
          .filter((c) => c.sum > 0)
          .sort((a, b) => b.sum - a.sum),
        purchases: sum(pu.data as { total: number }[], (r) => Number(r.total)),
        materialsOut: sum(mo.data as { qty: number; unit_cost: number | null }[], (r) => Number(r.qty) * Number(r.unit_cost ?? 0)),
        delivered: (del.data as OrderTotal[]) ?? [],
      })
    })
  }, [month])

  const label = monthRange(month).label

  return (
    <div>
      <div className="page-head">
        <h2>تقرير الشهر</h2>
        <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} style={{ maxWidth: 200 }} />
      </div>
      {error && <p className="error">{error}</p>}
      {!d ? <p className="muted">جارٍ التحميل…</p> : <ReportBody d={d} label={label} />}
    </div>
  )
}

function ReportBody({ d, label }: { d: Data; label: string }) {
  const out = d.suppliers + d.payroll + d.advances + d.expenses
  const cash = d.received - out
  const sales = sum(d.delivered, (o) => Number(o.total))
  const matCost = sum(d.delivered, (o) => Number(o.material_cost))
  const wages = d.payroll + d.advances
  const result = sales - matCost - wages - d.expenses

  return (
    <>
      <section className="card">
        <h3>الحركة النقدية — {label}</h3>
        <ul className="list">
          <li><span>دفعات الزبائن (دخل)</span><strong className="pos">{dzd(d.received)}</strong></li>
          <li><span>دفعات للموردين</span><strong>− {dzd(d.suppliers)}</strong></li>
          <li><span>رواتب مدفوعة</span><strong>− {dzd(d.payroll)}</strong></li>
          <li><span>تسبيقات العمّال</span><strong>− {dzd(d.advances)}</strong></li>
          <li><span>مصاريف عامة</span><strong>− {dzd(d.expenses)}</strong></li>
          <li className="net"><span>الصافي النقدي</span><strong className={cash < 0 ? 'neg' : 'pos'}>{dzd(cash)}</strong></li>
        </ul>
      </section>

      <section className="card">
        <h3>نتيجة الطلبيات المسلّمة — {label}</h3>
        <ul className="list">
          <li><span>مبيعات الطلبيات المسلّمة ({d.delivered.length})</span><strong>{dzd(sales)}</strong></li>
          <li><span>تكلفة موادها</span><strong>− {dzd(matCost)}</strong></li>
          <li><span>أجور الشهر (رواتب + تسبيقات)</span><strong>− {dzd(wages)}</strong></li>
          <li><span>مصاريف عامة</span><strong>− {dzd(d.expenses)}</strong></li>
          <li className="net"><span>الربح التقريبي</span><strong className={result < 0 ? 'neg' : 'pos'}>{dzd(result)}</strong></li>
        </ul>
        <p className="muted">تقدير بسيط: المبيعات تُحسب يوم التسليم، والأجور والمصاريف يوم دفعها.</p>
      </section>

      <div className="two-col">
        <section className="card">
          <h3>للمعلومة</h3>
          <ul className="list">
            <li><span>مشتريات الشهر (فواتير)</span><strong>{dzd(d.purchases)}</strong></li>
            <li><span>قيمة المواد التي خرجت للورشة</span><strong>{dzd(d.materialsOut)}</strong></li>
          </ul>
        </section>
        <section className="card">
          <h3>المصاريف حسب الصنف</h3>
          <ul className="list">
            {d.expByCat.map((c) => <li key={c.name}><span>{c.name}</span><strong>{dzd(c.sum)}</strong></li>)}
            {!d.expByCat.length && <li className="muted">لا مصاريف</li>}
          </ul>
        </section>
      </div>

      <section className="card">
        <h3>الطلبيات المسلّمة</h3>
        <div className="table-wrap">
          <table>
            <thead><tr><th>رقم</th><th>التسليم</th><th>الزبون</th><th>الطلبية</th><th>المبلغ</th><th>المواد</th><th>الفرق</th></tr></thead>
            <tbody>
              {d.delivered.map((o) => {
                const p = Number(o.total) - Number(o.material_cost)
                return (
                  <tr key={o.id}>
                    <td><Link to={`/orders?open=${o.id}`}>{o.id}</Link></td>
                    <td>{o.delivered_on}</td>
                    <td>{o.customer_name}</td>
                    <td>{o.title}</td>
                    <td>{dzd(o.total)}</td>
                    <td>{dzd(o.material_cost)}</td>
                    <td className={p < 0 ? 'neg' : 'pos'}>{dzd(p)}</td>
                  </tr>
                )
              })}
              {!d.delivered.length && <tr><td colSpan={7} className="muted center">لم تُسلَّم أي طلبية في هذا الشهر</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}
