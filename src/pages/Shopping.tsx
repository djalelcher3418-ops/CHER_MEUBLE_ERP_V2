import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { arabicError, dzd, num, supabase } from '../lib/supabase'
import { UNIT_LABELS, type MaterialShortage } from '../lib/types'

/** قائمة الشراء: ما ينقص المخزون لإنجاز الطلبيات المفتوحة */
export default function Shopping() {
  const [rows, setRows] = useState<MaterialShortage[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.from('material_shortages').select('*').order('name').then(({ data, error }) => {
      if (error) setError(error.message.includes('material_shortages') ? 'شغّل ملف supabase/017_catalog_planning.sql في Supabase أولًا.' : arabicError(error))
      setRows((data as MaterialShortage[]) ?? [])
    })
  }, [])

  const total = (rows ?? []).reduce((a, r) => a + Number(r.est_cost), 0)
  const text = ['قائمة شراء — CHER MEUBLE', ...(rows ?? []).map((r) => `• ${r.name}: ${num(r.short)} ${UNIT_LABELS[r.unit]}`)].join('\n')

  return (
    <div>
      <div className="page-head">
        <h2>قائمة الشراء</h2>
        {!!rows?.length && (
          <div className="toolbar" style={{ margin: 0 }}>
            <a className="btn wa" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">إرسال بواتساب</a>
            <button className="secondary" onClick={() => window.print()}>طباعة</button>
          </div>
        )}
      </div>
      <p className="muted no-print">ما تحتاجه الطلبيات المفتوحة (الجديدة وفي الورشة) من مواد، ناقص ما خرج لها، مقارنة بالمخزون الحالي. عروض الأسعار لا تُحسب.</p>
      {error && <p className="error">{error}</p>}

      {rows?.length === 0 && !error && (
        <div className="card center">
          <p style={{ margin: 0 }}>المخزون يكفي كل الطلبيات المفتوحة ✓</p>
          <small className="muted">المواد اللازمة تُحسب من مكوّنات منتجات الكتالوج ومن المواد التي تضيفها يدويًا في تفاصيل الطلبية.</small>
        </div>
      )}

      {!!rows?.length && (
        <>
          <div className="table-wrap">
            <table>
              <thead><tr><th>المادة</th><th>ينقص</th><th>اللازم للطلبيات</th><th>في المخزون</th><th>التكلفة التقريبية</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.material_id}>
                    <td>{r.name}</td>
                    <td className="neg"><strong>{num(r.short)} {UNIT_LABELS[r.unit]}</strong></td>
                    <td>{num(r.reserved)} <small className="muted">({r.orders} {r.orders === 1 ? 'طلبية' : 'طلبيات'})</small></td>
                    <td>{num(r.stock)}</td>
                    <td>{dzd(r.est_cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="total">التكلفة التقريبية: {dzd(total)} <small className="muted">(حسب متوسط سعر الشراء)</small></p>
          <Link className="btn no-print" to="/purchases">تسجيل فاتورة شراء</Link>
        </>
      )}
    </div>
  )
}
