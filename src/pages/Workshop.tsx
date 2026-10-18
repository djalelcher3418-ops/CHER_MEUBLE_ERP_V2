import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import PhotoStrip from '../components/PhotoStrip'
import { useAuth } from '../lib/auth'
import { loadOrderPhotos, type OrderPhoto } from '../lib/orderPhotos'
import { sendPush } from '../lib/push'
import { arabicError, num, supabase, todayISO } from '../lib/supabase'
import { ORDER_STATUS_LABELS, type OrderPublic, type OrderStatus } from '../lib/types'

interface Job extends OrderPublic {
  notes: string | null
}

interface JobItem {
  id: number
  order_id: number
  description: string
  size?: string | null
  fabric?: string | null
  legs?: string | null
  qty: number
}

/** لوحة الورشة: الطلبيات الجارية بدون أي مبلغ، للعامل والمدير */
export default function Workshop() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [items, setItems] = useState<JobItem[]>([])
  const [photos, setPhotos] = useState<OrderPhoto[]>([])
  const { session, isAdmin } = useAuth()
  const [busy, setBusy] = useState<number | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()
  const today = todayISO()

  async function load() {
    const [o, i] = await Promise.all([
      supabase.from('orders_public').select('*').order('due_date', { ascending: true, nullsFirst: false }).order('id'),
      supabase.from('order_items_public').select('*').order('id'),
    ])
    const err = o.error ?? i.error
    if (err) setError(arabicError(err))
    const list = (o.data as Job[]) ?? []
    setJobs(list)
    setItems((i.data as JobItem[]) ?? [])
    setLoaded(true)
    // الصور تُحمَّل بعد البطاقات، ولا تمنع ظهورها إن لم يُشغَّل ملف الصور بعد
    loadOrderPhotos(list.map((j) => j.id)).then(setPhotos, () => setPhotos([]))
  }
  useEffect(() => {
    load()
  }, [])

  async function advance(job: Job, status: OrderStatus) {
    const label = ORDER_STATUS_LABELS[status]
    if (!confirm(`نقل الطلبية «${job.title}» إلى «${label}»؟`)) return
    setBusy(job.id)
    const { error } = await supabase.rpc('workshop_set_status', { p_order: job.id, p_status: status })
    setBusy(null)
    if (error) return setError(arabicError(error))
    sendPush({ order_id: job.id })
    setError('')
    load()
  }

  return (
    <div>
      <div className="page-head">
        <h2>الورشة</h2>
        <button className="secondary" onClick={load}>تحديث</button>
      </div>
      {error && <p className="error">{error}</p>}
      {loaded && !jobs.length && <p className="muted">لا توجد طلبيات جارية الآن.</p>}

      <div className="jobs">
        {jobs.map((j) => {
          const late = !!j.due_date && j.due_date < today
          const lines = items.filter((i) => i.order_id === j.id)
          return (
            <article key={j.id} className={`card job st-${j.status}${late ? ' late' : ''}`}>
              <div className="job-head">
                <h3>{j.id} — {j.title}</h3>
                <span className={`status st-${j.status}`}>{ORDER_STATUS_LABELS[j.status]}</span>
              </div>
              <div className="muted meta-line">
                <span>{j.customer_name}</span>
                <span>التسليم: <span className={late ? 'neg' : ''}>{j.due_date ?? 'بدون موعد'}{late ? ' (متأخرة)' : ''}</span></span>
              </div>
              {lines.length > 0 && (
                <ul>
                  {lines.map((l) => (
                    <li key={l.id}>
                      {l.description}{l.size && <strong className="size-tag">{l.size}</strong>} × {num(l.qty)}
                      {(l.fabric || l.legs) && (
                        <div className="line-tags">
                          {l.fabric && <span className="spec-tag">قماش: {l.fabric}</span>}
                          {l.legs && <span className="spec-tag">أرجل: {l.legs}</span>}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {j.notes && <div className="notes">{j.notes}</div>}
              <PhotoStrip
                orderId={j.id}
                photos={photos.filter((p) => p.order_id === j.id)}
                canAdd
                canDelete={(p) => isAdmin || p.created_by === session?.user.id}
                onChanged={load}
              />
              <div className="toolbar">
                {j.status === 'new' && (
                  <button disabled={busy === j.id} onClick={() => advance(j, 'in_production')}>بدأنا العمل</button>
                )}
                {j.status === 'in_production' && (
                  <button disabled={busy === j.id} onClick={() => advance(j, 'ready')}>✓ الطلبية جاهزة</button>
                )}
                <button className="secondary" onClick={() => navigate(`/scan?order=${j.id}`)}>إخراج مواد لها</button>
              </div>
            </article>
          )
        })}
      </div>
    </div>
  )
}
