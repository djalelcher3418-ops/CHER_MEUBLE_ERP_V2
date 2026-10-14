import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { dzd, num, supabase } from '../lib/supabase'
import { ORDER_STATUS_LABELS, type OrderStatus } from '../lib/types'

interface Tracked {
  id: number
  title: string
  customer: string
  status: OrderStatus
  order_date: string
  due_date: string | null
  delivered_on: string | null
  total: number
  paid: number
  items: { description: string; qty: number }[]
}

const STEPS: OrderStatus[] = ['new', 'in_production', 'ready', 'delivered']
const STEP_TEXT: Record<OrderStatus, string> = {
  new: 'استلمنا طلبيتكم',
  in_production: 'قيد الصنع في الورشة',
  ready: 'جاهزة للاستلام',
  delivered: 'تم التسليم',
  cancelled: 'ملغاة',
}

/** صفحة تتبع الطلبية للزبون: تُفتح بالرابط السري بدون حساب */
export default function Track() {
  const { token } = useParams()
  const [o, setO] = useState<Tracked | null | undefined>(undefined)

  useEffect(() => {
    const valid = /^[0-9a-f-]{36}$/i.test(token ?? '')
    if (!valid) { setO(null); return }
    supabase.rpc('track_order', { p_token: token }).then(({ data, error }) => setO(error ? null : ((data as Tracked | null) ?? null)))
  }, [token])

  if (o === undefined) return <div className="center-page"><div className="login-logo">CM</div></div>
  if (!o)
    return (
      <div className="center-page">
        <div className="card narrow center">
          <div className="login-logo">CM</div>
          <h2>الرابط غير صحيح</h2>
          <p className="muted">تأكد من الرابط الذي وصلك، أو اتصل بالورشة.</p>
        </div>
      </div>
    )

  // بعد التسليم تكتمل كل الخطوات
  const step = o.status === 'delivered' ? STEPS.length : STEPS.indexOf(o.status)
  const remaining = Number(o.total) - Number(o.paid)

  return (
    <div className="track">
      <header className="track-head">
        <div className="login-logo">CM</div>
        <h1 className="brand">CHER MEUBLE</h1>
        <p className="muted">متابعة الطلبية رقم {o.id}</p>
      </header>

      <section className="card">
        <p style={{ marginTop: 0 }}>مرحبًا {o.customer}،</p>
        <h2 style={{ margin: '0 0 6px' }}>{o.title}</h2>
        <p className={`status st-${o.status}`} style={{ fontSize: 15 }}>{STEP_TEXT[o.status]}</p>

        {o.status !== 'cancelled' && (
          <ol className="steps">
            {STEPS.map((s, i) => (
              <li key={s} className={i < step ? 'done' : i === step ? 'now' : ''}>
                <span className="dot">{i < step ? '✓' : i + 1}</span>
                {ORDER_STATUS_LABELS[s]}
              </li>
            ))}
          </ol>
        )}

        <ul className="list">
          <li><span className="muted">تاريخ الطلب</span><strong>{o.order_date}</strong></li>
          {o.delivered_on
            ? <li><span className="muted">تاريخ التسليم</span><strong>{o.delivered_on}</strong></li>
            : o.due_date && <li><span className="muted">التسليم المتوقع</span><strong>{o.due_date}</strong></li>}
        </ul>
      </section>

      {o.items.length > 0 && (
        <section className="card">
          <h3>محتوى الطلبية</h3>
          <ul className="list">
            {o.items.map((i, k) => <li key={k}><span>{i.description}</span><strong>× {num(i.qty)}</strong></li>)}
          </ul>
        </section>
      )}

      <section className="card">
        <ul className="list">
          <li><span className="muted">المبلغ</span><strong>{dzd(o.total)}</strong></li>
          <li><span className="muted">المدفوع</span><strong className="pos">{dzd(o.paid)}</strong></li>
          <li className="net"><span>الباقي</span><strong>{dzd(remaining)}</strong></li>
        </ul>
      </section>

      <p className="muted center">شكرًا لثقتكم — CHER MEUBLE</p>
    </div>
  )
}
