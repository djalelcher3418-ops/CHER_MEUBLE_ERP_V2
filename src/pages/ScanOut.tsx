import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { arabicError, dateTime, num, supabase } from '../lib/supabase'
import { UNIT_LABELS, type MaterialPublic, type OrderPublic } from '../lib/types'

interface MyMove {
  id: number
  qty: number
  note: string | null
  created_at: string
  material_id: number
  order_id: number | null
}

const READER_ID = 'barcode-reader'

export default function ScanOut() {
  const { session, isAdmin } = useAuth()
  const [materials, setMaterials] = useState<MaterialPublic[]>([])
  const [code, setCode] = useState('')
  const [found, setFound] = useState<MaterialPublic | null>(null)
  const [qty, setQty] = useState('')
  const [note, setNote] = useState('')
  const [orders, setOrders] = useState<OrderPublic[]>([])
  const [params] = useSearchParams()
  const [orderId, setOrderId] = useState(() => params.get('order') ?? '')
  const [camera, setCamera] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [recent, setRecent] = useState<MyMove[]>([])
  const scanner = useRef<Html5Qrcode | null>(null)

  async function load() {
    const [m, r, o] = await Promise.all([
      supabase.from('materials_public').select('*').order('name'),
      supabase
        .from('stock_movements')
        .select('id, qty, note, created_at, material_id, order_id')
        .eq('type', 'out')
        .eq('created_by', session!.user.id)
        .order('created_at', { ascending: false })
        .limit(15),
      supabase.from('orders_public').select('*').order('due_date', { ascending: true, nullsFirst: false }),
    ])
    setMaterials((m.data as MaterialPublic[]) ?? [])
    setOrders((o.data as OrderPublic[]) ?? [])
    setRecent((r.data as MyMove[]) ?? [])
  }
  useEffect(() => {
    load()
  }, [])

  function lookup(value: string) {
    const m = materials.find((x) => x.barcode === value.trim())
    if (m) {
      setFound(m)
      setMsg(null)
      setQty('')
    } else {
      setFound(null)
      setMsg({ ok: false, text: `لا توجد مادة بالباركود ${value}` })
    }
  }

  async function startCamera() {
    setCamera(true)
    setMsg(null)
    // ننتظر ظهور العنصر في الصفحة
    await new Promise((r) => setTimeout(r, 50))
    const s = new Html5Qrcode(READER_ID, {
      verbose: false,
      formatsToSupport: [
        Html5QrcodeSupportedFormats.CODE_128,
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.EAN_8,
        Html5QrcodeSupportedFormats.CODE_39,
        Html5QrcodeSupportedFormats.QR_CODE,
      ],
    })
    scanner.current = s
    try {
      await s.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 280, height: 120 } },
        (text) => {
          setCode(text)
          lookup(text)
          stopCamera()
        },
        () => {},
      )
    } catch {
      setCamera(false)
      setMsg({ ok: false, text: 'تعذّر فتح الكاميرا. اسمح للمتصفح باستعمالها، أو اكتب الباركود يدويًا.' })
    }
  }

  async function stopCamera() {
    const s = scanner.current
    scanner.current = null
    if (s?.isScanning) await s.stop().catch(() => {})
    setCamera(false)
  }
  useEffect(() => () => { stopCamera() }, [])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!found) return
    const q = Number(qty)
    if (!(q > 0)) return setMsg({ ok: false, text: 'اكتب كمية صحيحة' })
    const have = Number(found.qty)
    if (q > have) {
      // العامل لا يستطيع إخراج أكثر من الموجود؛ المدير يُسأل للتأكيد (مثلًا مشتريات لم تُسجَّل بعد)
      if (!isAdmin) return setMsg({ ok: false, text: `الكمية أكبر من الموجود في المخزون (${num(have)} ${UNIT_LABELS[found.unit]}). أخبر المدير.` })
      if (!confirm(`الموجود ${num(have)} فقط. إخراج ${num(q)} سيجعل المخزون بالسالب. متابعة؟`)) return
    }
    const { error } = await supabase.from('stock_movements').insert({
      material_id: found.id,
      type: 'out',
      qty: q,
      note: note.trim() || null,
      order_id: orderId ? Number(orderId) : null,
      created_by: session!.user.id,
    })
    if (error) return setMsg({ ok: false, text: arabicError(error) })
    setMsg({ ok: true, text: `تم إخراج ${num(q)} ${UNIT_LABELS[found.unit]} من «${found.name}»` })
    setFound(null)
    setCode('')
    setQty('')
    setNote('')
    load()
  }

  const nameOf = (id: number) => materials.find((m) => m.id === id)?.name ?? `#${id}`
  const orderOf = (id: number | null) => (id ? orders.find((o) => o.id === id)?.title ?? `طلبية ${id}` : '')

  return (
    <div className="scan-page">
      <h2>إخراج مواد إلى الورشة</h2>
      {orderId && orders.find((o) => String(o.id) === orderId) && (
        <p className="card">المواد ستُسجَّل للطلبية: <strong>{orderOf(Number(orderId))}</strong></p>
      )}

      {!camera ? (
        <button className="big-btn" onClick={startCamera}>📷 مسح الباركود بالكاميرا</button>
      ) : (
        <div>
          <div id={READER_ID} className="reader" />
          <button className="secondary" onClick={stopCamera}>إيقاف الكاميرا</button>
        </div>
      )}

      <form className="scan-row" onSubmit={(e) => { e.preventDefault(); lookup(code) }}>
        <input dir="ltr" placeholder="أو اكتب الباركود" value={code} onChange={(e) => setCode(e.target.value)} />
        <button type="submit" className="secondary">بحث</button>
      </form>

      {msg && <p className={msg.ok ? 'success' : 'error'}>{msg.text}</p>}

      {found && (
        <form className="card form" onSubmit={submit}>
          <h3>{found.name}</h3>
          <p className="muted">
            {found.category ?? ''} — الموجود: {num(found.qty)} {UNIT_LABELS[found.unit]}
          </p>
          <label>الكمية المُخرَجة ({UNIT_LABELS[found.unit]})
            <input type="number" inputMode="decimal" step="any" min="0" value={qty} onChange={(e) => setQty(e.target.value)} required autoFocus />
          </label>
          <label>لأيّ طلبية
            <select value={orderId} onChange={(e) => setOrderId(e.target.value)}>
              <option value="">— بدون طلبية (استعمال عام) —</option>
              {orders.map((o) => (
                <option key={o.id} value={o.id}>{o.id} — {o.title} — {o.customer_name}</option>
              ))}
            </select>
          </label>
          <label>ملاحظة
            <input value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <button type="submit" className="big-btn">تأكيد الإخراج</button>
        </form>
      )}

      <h3>آخر ما أخرجتَه</h3>
      <ul className="list">
        {recent.map((r) => (
          <li key={r.id}>
            <span>{nameOf(r.material_id)} — {num(r.qty)}{r.order_id ? ` — ${orderOf(r.order_id)}` : ''}</span>
            <span className="muted">{dateTime(r.created_at)}{r.note ? ` — ${r.note}` : ''}</span>
          </li>
        ))}
        {!recent.length && <li className="muted">لا شيء بعد</li>}
      </ul>
    </div>
  )
}
