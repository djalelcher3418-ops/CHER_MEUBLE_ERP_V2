import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { arabicError, dzd, num, supabase } from '../lib/supabase'
import { PAY_LABELS, type Customer, type CustomerPayment, type OrderItem, type OrderTotal } from '../lib/types'

interface Data {
  o: OrderTotal
  c: Customer
  items: OrderItem[]
  payments: CustomerPayment[]
}

/** فاتورة / وصل طلبية قابل للطباعة أو الحفظ PDF */
export default function Invoice() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const orderId = Number(id)
    Promise.all([
      supabase.from('order_totals').select('*').eq('id', orderId).single(),
      supabase.from('order_items').select('*').eq('order_id', orderId).order('id'),
      supabase.from('customer_payments').select('*').eq('order_id', orderId).order('paid_on'),
    ]).then(async ([o, i, p]) => {
      if (o.error) return setError(arabicError(o.error))
      const order = o.data as OrderTotal
      const c = await supabase.from('customers').select('*').eq('id', order.customer_id).single()
      if (c.error) return setError(arabicError(c.error))
      setData({ o: order, c: c.data as Customer, items: (i.data as OrderItem[]) ?? [], payments: (p.data as CustomerPayment[]) ?? [] })
    })
  }, [id])

  if (error) return <p className="error">{error}</p>
  if (!data) return <p className="muted">جارٍ التحميل…</p>

  const { o, c, items, payments } = data
  const subtotal = items.reduce((a, r) => a + Number(r.qty) * Number(r.unit_price), 0)
  const remaining = Number(o.total) - Number(o.paid)

  return (
    <div>
      <div className="toolbar no-print">
        <button onClick={() => window.print()}>طباعة / حفظ PDF</button>
        <button className="secondary" onClick={() => navigate(`/orders?open=${o.id}`)}>رجوع للطلبية</button>
      </div>

      <article className="invoice card">
        <header className="invoice-head">
          <div>
            <h1 className="brand">CHER MEUBLE</h1>
            <p className="muted">ورشة صناعة الأثاث</p>
          </div>
          <div className="invoice-meta">
            <h2>فاتورة رقم {o.id}</h2>
            <p>التاريخ: {o.order_date}</p>
            {o.due_date && <p>موعد التسليم: {o.due_date}</p>}
          </div>
        </header>

        <section className="invoice-to">
          <strong>الزبون:</strong> {c.name}
          {c.phone && <> — <span dir="ltr">{c.phone}</span></>}
          {c.address && <> — {c.address}</>}
        </section>

        <p><strong>الطلبية:</strong> {o.title}</p>

        <table>
          <thead><tr><th>#</th><th>البيان</th><th>الكمية</th><th>سعر الوحدة</th><th>المجموع</th></tr></thead>
          <tbody>
            {items.map((r, k) => (
              <tr key={r.id}>
                <td>{k + 1}</td>
                <td>{r.description}</td>
                <td>{num(r.qty)}</td>
                <td>{dzd(r.unit_price)}</td>
                <td>{dzd(Number(r.qty) * Number(r.unit_price))}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="invoice-sum">
          <div><span>المجموع</span><span>{dzd(subtotal)}</span></div>
          {Number(o.discount) > 0 && <div><span>التخفيض</span><span>− {dzd(o.discount)}</span></div>}
          <div className="grand"><span>الصافي</span><span>{dzd(o.total)}</span></div>
          {payments.map((p) => (
            <div key={p.id}><span>دفعة {p.paid_on} ({PAY_LABELS[p.method]})</span><span>− {dzd(p.amount)}</span></div>
          ))}
          <div className="grand"><span>الباقي</span><span>{dzd(remaining)}</span></div>
        </div>

        <footer className="invoice-foot">
          <div>توقيع الزبون</div>
          <div>ختم الورشة</div>
        </footer>
      </article>
    </div>
  )
}
