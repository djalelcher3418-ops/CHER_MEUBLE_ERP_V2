import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import TrendCharts, { type MonthPoint } from '../components/TrendCharts'
import { MONTHS, monthRange, thisMonth } from '../lib/payroll'
import { arabicError, dzd, supabase, todayISO } from '../lib/supabase'
import type { OrderTotal } from '../lib/types'

/** ما ترجعه الدالة month_summary من قاعدة البيانات */
export interface MonthSummary {
  received: number
  suppliers: number
  payroll: number
  advances: number
  expenses: number
  purchases: number
  materials_out: number
  expenses_by_category: { name: string; sum: number }[]
}

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
  const [exporting, setExporting] = useState<'' | 'month' | 'backup'>('')
  const [trend, setTrend] = useState<MonthPoint[] | null>(null)

  // آخر 6 أشهر حتى الشهر المختار، للرسوم
  useEffect(() => {
    const [y, m] = month.split('-').map(Number)
    const months = Array.from({ length: 6 }, (_, k) => {
      const d = new Date(y, m - 6 + k, 1)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    })
    // تغيير الشهر بسرعة: نتجاهل الرد القديم إن وصل بعد الجديد
    let stale = false
    Promise.all(months.map((mm) => { const r = monthRange(mm); return supabase.rpc('month_summary', { p_from: r.from, p_to: r.to }) }))
      .then((res) => !stale && setTrend(res.map((r, k) => {
        const s = (r.data ?? {}) as Partial<MonthSummary>
        return {
          label: MONTHS[Number(months[k].slice(5)) - 1],
          received: Number(s.received ?? 0),
          spent: Number(s.suppliers ?? 0) + Number(s.payroll ?? 0) + Number(s.advances ?? 0) + Number(s.expenses ?? 0),
        }
      })))
    return () => { stale = true }
  }, [month])

  async function runExport(kind: 'month' | 'backup') {
    setExporting(kind)
    setError('')
    try {
      const x = await import('../lib/exportXlsx')
      if (kind === 'month') await x.exportMonth(month)
      else await x.exportBackup(todayISO())
    } catch (e) {
      setError('تعذّر إنشاء ملف Excel: ' + arabicError(e))
    }
    setExporting('')
  }

  useEffect(() => {
    const { from, to } = monthRange(month)
    let stale = false
    Promise.all([
      // المجاميع تُحسب في قاعدة البيانات، فلا يضيع شيء مهما كثرت الحركات
      supabase.rpc('month_summary', { p_from: from, p_to: to }),
      supabase.from('order_totals').select('*').eq('status', 'delivered').gte('delivered_on', from).lte('delivered_on', to).order('delivered_on'),
    ]).then(([ms, del]) => {
      if (stale) return
      const err = ms.error ?? del.error
      if (err) setError(arabicError(err))
      const s = (ms.data ?? {}) as Partial<MonthSummary>
      setD({
        received: Number(s.received ?? 0),
        suppliers: Number(s.suppliers ?? 0),
        payroll: Number(s.payroll ?? 0),
        advances: Number(s.advances ?? 0),
        expenses: Number(s.expenses ?? 0),
        expByCat: (s.expenses_by_category ?? []).map((c) => ({ name: c.name, sum: Number(c.sum) })),
        purchases: Number(s.purchases ?? 0),
        materialsOut: Number(s.materials_out ?? 0),
        delivered: (del.data as OrderTotal[]) ?? [],
      })
    })
    return () => { stale = true }
  }, [month])

  const label = monthRange(month).label

  return (
    <div>
      <div className="page-head">
        <h2>تقرير الشهر</h2>
        <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} style={{ maxWidth: 200 }} />
      </div>
      <div className="toolbar">
        <button className="secondary" onClick={() => runExport('month')} disabled={!!exporting}>{exporting === 'month' ? 'جارٍ التحضير…' : 'تنزيل Excel لهذا الشهر'}</button>
        <button className="secondary" onClick={() => runExport('backup')} disabled={!!exporting}>{exporting === 'backup' ? 'جارٍ التحضير…' : 'نسخة احتياطية كاملة (Excel)'}</button>
      </div>
      {error && <p className="error">{error}</p>}
      {trend && (
        <section className="card">
          <h3>آخر 6 أشهر</h3>
          <TrendCharts data={trend} />
        </section>
      )}
      {!d ? <p className="muted">جارٍ التحميل…</p> : <ReportBody d={d} label={label} />}
    </div>
  )
}

function ReportBody({ d, label }: { d: Data; label: string }) {
  const out = d.suppliers + d.payroll + d.advances + d.expenses
  const cash = d.received - out
  const sales = sum(d.delivered, (o) => Number(o.total))
  const matCost = sum(d.delivered, (o) => Number(o.material_cost) + Number(o.extra_cost ?? 0))
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
          <li><span>تكلفة موادها وتكاليفها الأخرى</span><strong>− {dzd(matCost)}</strong></li>
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
            <thead><tr><th>رقم</th><th>التسليم</th><th>الزبون</th><th>الطلبية</th><th>المبلغ</th><th>المواد</th><th>تكاليف أخرى</th><th>الربح</th><th>النسبة</th></tr></thead>
            <tbody>
              {d.delivered.map((o) => {
                const p = Number(o.total) - Number(o.material_cost) - Number(o.extra_cost ?? 0)
                return (
                  <tr key={o.id}>
                    <td><Link to={`/orders?open=${o.id}`}>{o.id}</Link></td>
                    <td>{o.delivered_on}</td>
                    <td>{o.customer_name}</td>
                    <td>{o.title}</td>
                    <td>{dzd(o.total)}</td>
                    <td>{dzd(o.material_cost)}</td>
                    <td>{dzd(o.extra_cost ?? 0)}</td>
                    <td className={p < 0 ? 'neg' : 'pos'}>{dzd(p)}</td>
                    <td className={p < 0 ? 'neg' : ''}>{Number(o.total) > 0 ? `${Math.round((p / Number(o.total)) * 100)}%` : '—'}</td>
                  </tr>
                )
              })}
              {!d.delivered.length && <tr><td colSpan={9} className="muted center">لم تُسلَّم أي طلبية في هذا الشهر</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}
