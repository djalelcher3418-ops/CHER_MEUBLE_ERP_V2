import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import Modal from '../components/Modal'
import { arabicError, dateTime, dzd, num, supabase, todayISO } from '../lib/supabase'
import {
  BED_SIZES,
  ORDER_STATUS_LABELS,
  PAY_LABELS,
  UNIT_LABELS,
  lineExtras,
  lineLabel,
  type Customer,
  type CustomerPayment,
  type Order,
  type OrderItem,
  type OrderStatus,
  type OrderTotal,
  type PayMethod,
  type Unit,
} from '../lib/types'
import Icon from '../components/Icon'
import PhotoStrip from '../components/PhotoStrip'
import { addOrderPhoto, loadOrderPhotos, trackUrl, type OrderPhoto } from '../lib/orderPhotos'
import { orderMessage, waLink } from '../lib/whatsapp'
import { CustomerPaymentModal } from './Customers'

/** size: مقاس من القائمة أو مقاس آخر يُكتب يدويًا (custom) */
type Line = { description: string; qty: string; unit_price: string; size: string; custom: boolean; fabric: string; legs: string }
const emptyLine: Line = { description: '', qty: '1', unit_price: '', size: '', custom: false, fabric: '', legs: '' }
const OTHER_SIZE = '__other__'
/** إن تُرك البيان فارغًا واختير مقاس: «سرير» أو «أريكة» */
const lineDescription = (l: Line) => l.description.trim() || (l.size === 'أريكة' ? 'أريكة' : l.size.trim() ? 'سرير' : '')

const ACTIVE: OrderStatus[] = ['new', 'in_production', 'ready']

interface MoveRow {
  id: number
  qty: number
  unit_cost: number | null
  created_at: string
  materials: { name: string; unit: Unit } | null
  profiles: { full_name: string } | null
}

interface Detail {
  o: OrderTotal
  items: OrderItem[]
  payments: CustomerPayment[]
  moves: MoveRow[]
  notes: string | null
  phone: string | null
  events: EventRow[]
  token: string | null
  photos: OrderPhoto[]
}

interface EventRow {
  id: number
  status: OrderStatus
  created_at: string
  profiles: { full_name: string } | null
}

const rest = (o: OrderTotal) => Number(o.total) - Number(o.paid)
const isLate = (o: OrderTotal, today: string) => !o.is_quote && ACTIVE.includes(o.status) && !!o.due_date && o.due_date < today

export default function Orders() {
  const [rows, setRows] = useState<OrderTotal[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [filter, setFilter] = useState<'active' | 'all' | 'quotes' | OrderStatus>('active')
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<{ order?: Order; items?: OrderItem[]; quote?: boolean } | null>(null)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [paying, setPaying] = useState<OrderTotal | null>(null)
  const [error, setError] = useState('')
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const today = todayISO()

  async function load() {
    const [o, c] = await Promise.all([
      supabase.from('order_totals').select('*').order('id', { ascending: false }).limit(500),
      supabase.from('customers').select('*').eq('active', true).order('name'),
    ])
    if (o.error) setError(arabicError(o.error))
    setRows((o.data as OrderTotal[]) ?? [])
    setCustomers((c.data as Customer[]) ?? [])
    return (o.data as OrderTotal[]) ?? []
  }

  async function openDetail(id: number) {
    const [o, i, p, m, raw, ev, tk, photos] = await Promise.all([
      supabase.from('order_totals').select('*').eq('id', id).single(),
      supabase.from('order_items').select('*').eq('order_id', id).order('id'),
      supabase.from('customer_payments').select('*').eq('order_id', id).order('paid_on'),
      supabase
        .from('stock_movements')
        .select('id, qty, unit_cost, created_at, materials(name, unit), profiles(full_name)')
        .eq('order_id', id)
        .eq('type', 'out')
        .order('created_at'),
      supabase.from('orders').select('notes, customers(phone)').eq('id', id).single(),
      supabase.from('order_events').select('id, status, created_at, profiles(full_name)').eq('order_id', id).order('created_at'),
      // رابط التتبع والصور (المرحلة 10): لا تعطّل التفاصيل إن لم يُشغَّل ملفها بعد
      supabase.from('orders').select('track_token').eq('id', id).maybeSingle(),
      loadOrderPhotos([id]).catch(() => [] as OrderPhoto[]),
    ])
    if (o.error) return setError(arabicError(o.error))
    setDetail({
      o: o.data as OrderTotal,
      items: (i.data as OrderItem[]) ?? [],
      payments: (p.data as CustomerPayment[]) ?? [],
      moves: (m.data as unknown as MoveRow[]) ?? [],
      notes: (raw.data as unknown as { notes: string | null } | null)?.notes ?? null,
      phone: (raw.data as unknown as { customers: { phone: string | null } | null } | null)?.customers?.phone ?? null,
      events: (ev.data as unknown as EventRow[]) ?? [],
      token: tk.error ? null : ((tk.data as { track_token: string } | null)?.track_token ?? null),
      photos,
    })
  }

  useEffect(() => {
    load().then(() => {
      const open = Number(params.get('open'))
      if (open) {
        openDetail(open)
        setParams({}, { replace: true })
      }
    })
  }, [])

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(
      (o) =>
        (filter === 'all' ||
          (filter === 'quotes' ? !!o.is_quote
            : filter === 'active' ? !o.is_quote && ACTIVE.includes(o.status)
            : !o.is_quote && o.status === filter)) &&
        (!q || o.title.toLowerCase().includes(q) || o.customer_name.toLowerCase().includes(q) || String(o.id) === q),
    )
  }, [rows, filter, search])

  async function setStatus(o: OrderTotal, status: OrderStatus) {
    const { error } = await supabase.from('orders').update({ status }).eq('id', o.id)
    if (error) return setError(arabicError(error))
    await load()
    openDetail(o.id)
  }

  async function startEdit(id: number) {
    const [o, i] = await Promise.all([
      supabase.from('orders').select('*').eq('id', id).single(),
      supabase.from('order_items').select('*').eq('order_id', id).order('id'),
    ])
    if (o.error) return setError(arabicError(o.error))
    setDetail(null)
    setEditing({ order: o.data as Order, items: (i.data as OrderItem[]) ?? [] })
  }

  async function convert(o: OrderTotal) {
    if (!confirm(`الزبون وافق؟ تحويل عرض السعر رقم ${o.id} إلى طلبية (تصل للورشة وتُحسب على الزبون)؟`)) return
    const { error } = await supabase.rpc('convert_quote', { p_id: o.id })
    if (error) return setError(arabicError(error))
    await load()
    openDetail(o.id)
  }

  async function remove(d: Detail) {
    if (!confirm(`حذف الطلبية رقم ${d.o.id} نهائيًا؟`)) return
    const { error } = await supabase.from('orders').delete().eq('id', d.o.id)
    if (error) return setError(arabicError(error))
    setDetail(null)
    load()
  }

  const activeCount = rows.filter((o) => !o.is_quote && ACTIVE.includes(o.status)).length
  const lateCount = rows.filter((o) => isLate(o, today)).length
  const quoteCount = rows.filter((o) => o.is_quote && o.status !== 'cancelled').length

  return (
    <div>
      <div className="page-head">
        <h2>الطلبيات</h2>
        <div className="toolbar" style={{ margin: 0 }}>
          <button className="secondary" onClick={() => setEditing({ quote: true })} disabled={!customers.length}>+ عرض سعر</button>
          <button onClick={() => setEditing({})} disabled={!customers.length} title={customers.length ? '' : 'أضف زبونًا أولًا'}>
            + طلبية جديدة
          </button>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {!customers.length && <p className="muted">لإضافة طلبية، أضف الزبون أولًا من صفحة <Link to="/customers">الزبائن</Link>.</p>}
      <p className="muted">
        طلبيات جارية: <strong>{activeCount}</strong>
        {lateCount > 0 && <> — متأخرة عن موعد التسليم: <strong className="neg">{lateCount}</strong></>}
        {quoteCount > 0 && <> — عروض أسعار تنتظر الموافقة: <strong>{quoteCount}</strong></>}
      </p>

      <div className="filters">
        <input placeholder="بحث بالرقم، الزبون أو الطلبية" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
          <option value="active">الجارية</option>
          <option value="quotes">عروض الأسعار</option>
          <option value="all">الكل</option>
          {Object.entries(ORDER_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      <div className="table-wrap">
        <table>
          <thead><tr><th>رقم</th><th>الزبون</th><th>الطلبية</th><th>التسليم</th><th>الحالة</th><th>المبلغ</th><th>الباقي</th><th></th></tr></thead>
          <tbody>
            {shown.map((o) => (
              <tr key={o.id} className={isLate(o, today) ? 'low' : ''}>
                <td>{o.id}</td>
                <td>{o.customer_name}</td>
                <td>{o.title}</td>
                <td className={isLate(o, today) ? 'neg' : ''}>{o.due_date ?? '—'}</td>
                <td>
                  {o.is_quote && o.status !== 'cancelled'
                    ? <span className="status st-quote">عرض سعر</span>
                    : <span className={`status st-${o.status}`}>{ORDER_STATUS_LABELS[o.status]}</span>}
                </td>
                <td>{dzd(o.total)}</td>
                <td className={rest(o) > 0 && o.status !== 'cancelled' && !o.is_quote ? 'neg' : ''}>{o.is_quote ? '—' : dzd(rest(o))}</td>
                <td className="actions"><button className="link" onClick={() => openDetail(o.id)}>التفاصيل</button></td>
              </tr>
            ))}
            {!shown.length && <tr><td colSpan={8} className="muted center">لا توجد طلبيات</td></tr>}
          </tbody>
        </table>
      </div>

      {editing && (
        <OrderForm
          customers={customers}
          order={editing.order}
          items={editing.items}
          quote={editing.order ? !!editing.order.is_quote : !!editing.quote}
          onClose={() => setEditing(null)}
          onDone={async (id) => { setEditing(null); await load(); openDetail(id) }}
        />
      )}

      {paying && (
        <CustomerPaymentModal
          customerId={paying.customer_id}
          customerName={paying.customer_name}
          balance={rest(paying)}
          orderId={paying.id}
          onClose={() => setPaying(null)}
          onDone={async () => { const id = paying.id; setPaying(null); await load(); openDetail(id) }}
        />
      )}

      {detail && !paying && (
        <Modal title={`${detail.o.is_quote ? 'عرض سعر' : 'طلبية'} رقم ${detail.o.id} — ${detail.o.customer_name}`} onClose={() => setDetail(null)}>
          <OrderDetail
            d={detail}
            today={today}
            onStatus={(s) => setStatus(detail.o, s)}
            onPay={() => setPaying(detail.o)}
            onEdit={() => startEdit(detail.o.id)}
            onInvoice={() => navigate(`/invoice/${detail.o.id}`)}
            onDelete={() => remove(detail)}
            onReload={() => openDetail(detail.o.id)}
            onConvert={() => convert(detail.o)}
          />
        </Modal>
      )}
    </div>
  )
}

function OrderDetail({ d, today, onStatus, onPay, onEdit, onInvoice, onDelete, onReload, onConvert }: {
  d: Detail
  today: string
  onStatus: (s: OrderStatus) => void
  onPay: () => void
  onEdit: () => void
  onInvoice: () => void
  onDelete: () => void
  onReload: () => void
  onConvert: () => void
}) {
  const { o } = d
  const quote = !!o.is_quote && o.status !== 'cancelled'
  const [copied, setCopied] = useState(false)
  const link = d.token ? trackUrl(d.token) : null
  async function copyLink() {
    if (!link) return
    try { await navigator.clipboard.writeText(link); setCopied(true) } catch { setCopied(false) }
  }
  const subtotal = d.items.reduce((a, i) => a + Number(i.qty) * Number(i.unit_price), 0)
  const profit = Number(o.total) - Number(o.material_cost)
  const canDelete = !d.payments.length && !d.moves.length
  const wa = waLink(d.phone, orderMessage(o, rest(o), link))

  return (
    <div className="form">
      <h3>{o.title}</h3>
      {quote && (
        <div className="card quote-box">
          <strong>عرض سعر في انتظار موافقة الزبون</strong>
          <p className="muted" style={{ margin: '4px 0 10px' }}>لا يُحسب على الزبون ولا يصل للورشة حتى تحوّله إلى طلبية.</p>
          <div className="toolbar" style={{ margin: 0 }}>
            <button onClick={onConvert}>✓ الزبون وافق: تحويل إلى طلبية</button>
            <button className="secondary" onClick={() => confirm('الزبون رفض العرض؟ سيُعلَّم كملغى.') && onStatus('cancelled')}>الزبون رفض</button>
          </div>
        </div>
      )}
      <ul className="list">
        <li><span className="muted">{quote ? 'تاريخ العرض' : 'تاريخ الطلب'}</span><strong>{o.order_date}</strong></li>
        <li><span className="muted">موعد التسليم</span><strong className={isLate(o, today) ? 'neg' : ''}>{o.due_date ?? '—'}{isLate(o, today) ? ' (متأخرة)' : ''}</strong></li>
      </ul>
      {!quote && (
        <div>
          <label>الحالة
            <select value={o.status} onChange={(e) => onStatus(e.target.value as OrderStatus)}>
              {Object.entries(ORDER_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
        </div>
      )}
      {o.delivered_on && <p className="muted">سُلّمت يوم {o.delivered_on}</p>}
      {d.notes && <p className="muted">ملاحظات: {d.notes}</p>}

      <div className="table-wrap">
        <table>
          <thead><tr><th>البيان</th><th>الكمية</th><th>السعر</th><th>المجموع</th></tr></thead>
          <tbody>
            {d.items.map((i) => (
              <tr key={i.id}>
                <td>
                  {lineLabel(i.description, i.size)}
                  {lineExtras(i.fabric, i.legs) && <small className="line-extras">{lineExtras(i.fabric, i.legs)}</small>}
                </td>
                <td>{num(i.qty)}</td>
                <td>{dzd(i.unit_price)}</td>
                <td>{dzd(Number(i.qty) * Number(i.unit_price))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="stats">
        <div className="stat"><span>المجموع</span><strong>{dzd(subtotal)}</strong></div>
        {Number(o.discount) > 0 && <div className="stat"><span>التخفيض</span><strong>{dzd(o.discount)}</strong></div>}
        <div className="stat"><span>الصافي</span><strong>{dzd(o.total)}</strong></div>
        {!quote && <div className="stat"><span>المدفوع</span><strong className="pos">{dzd(o.paid)}</strong></div>}
        {!quote && <div className="stat"><span>الباقي</span><strong className={rest(o) > 0 ? 'neg' : ''}>{dzd(rest(o))}</strong></div>}
      </div>

      {!quote && (
        <>
          <div className="stats">
            <div className="stat"><span>تكلفة المواد المُخرَجة</span><strong>{dzd(o.material_cost)}</strong></div>
            <div className="stat"><span>الربح التقريبي</span><strong className={profit < 0 ? 'neg' : 'pos'}>{dzd(profit)}</strong></div>
          </div>
          <p className="muted">الربح = الصافي ناقص تكلفة المواد التي أُخرجت لهذه الطلبية. لا يشمل أجور العمال والمصاريف الأخرى.</p>
        </>
      )}

      <h4>الصور (التصميم، المقاسات، القطعة الجاهزة)</h4>
      <PhotoStrip orderId={o.id} photos={d.photos} canAdd canDelete={() => true} onChanged={onReload} />

      {link && (
        <>
          <h4>{quote ? 'رابط العرض للزبون' : 'رابط التتبع للزبون'}</h4>
          <p className="muted" style={{ margin: 0 }}>
            {quote
              ? 'يرى الزبون بهذا الرابط تفاصيل العرض والمبلغ، بدون حساب. يُرسل تلقائيًا مع رسالة واتساب.'
              : 'يرى الزبون بهذا الرابط حالة طلبيته وموعد التسليم والباقي، بدون حساب. يُرسل تلقائيًا مع رسالة واتساب.'}
          </p>
          <div className="toolbar" style={{ marginTop: 8 }}>
            <button type="button" className="secondary" onClick={copyLink}>{copied ? 'تم النسخ ✓' : 'نسخ الرابط'}</button>
            <a className="btn secondary-link" href={link} target="_blank" rel="noopener">فتح صفحة الزبون</a>
          </div>
        </>
      )}

      {!quote && <>
      <h4>الدفعات</h4>
      <ul className="list">
        {d.payments.map((p) => (
          <li key={p.id}><span>{p.paid_on} — {PAY_LABELS[p.method]}{p.notes ? ` — ${p.notes}` : ''}</span><strong>{dzd(p.amount)}</strong></li>
        ))}
        {!d.payments.length && <li className="muted">لا دفعات بعد</li>}
      </ul>

      <h4>المواد التي خرجت لهذه الطلبية</h4>
      <ul className="list">
        {d.moves.map((m) => (
          <li key={m.id}>
            <span>{m.materials?.name} — {num(m.qty)} {m.materials ? UNIT_LABELS[m.materials.unit] : ''}</span>
            <span className="muted meta"><span>{dzd(Number(m.qty) * Number(m.unit_cost ?? 0))}</span><span>{m.profiles?.full_name ?? ''}</span><span>{new Date(m.created_at).toLocaleDateString('fr-DZ')}</span></span>
          </li>
        ))}
        {!d.moves.length && <li className="muted">لم تخرج أي مادة بعد. اختر هذه الطلبية في صفحة «إخراج مواد».</li>}
      </ul>

      {d.events.length > 0 && (
        <>
          <h4>سجل الحالات</h4>
          <ul className="list">
            {d.events.map((e) => (
              <li key={e.id}>
                <span>{ORDER_STATUS_LABELS[e.status]}</span>
                <span className="muted meta"><span>{e.profiles?.full_name ?? ''}</span><span>{dateTime(e.created_at)}</span></span>
              </li>
            ))}
          </ul>
        </>
      )}
      </>}

      <div className="toolbar">
        {!quote && <button onClick={onPay}>+ دفعة</button>}
        <button className="secondary" onClick={onInvoice}>{quote ? 'طباعة عرض السعر' : 'الفاتورة'}</button>
        <button className="secondary" onClick={onEdit}>تعديل</button>
        {wa && <a className="btn wa" href={wa} target="_blank" rel="noopener">واتساب للزبون</a>}
        {canDelete && <button className="danger" onClick={onDelete}>حذف</button>}
      </div>
      {!canDelete && <p className="muted">لا يمكن حذف طلبية عليها دفعات أو مواد. غيّر حالتها إلى «ملغاة» بدل ذلك.</p>}
    </div>
  )
}

function OrderForm({ customers, order, items, quote = false, onClose, onDone }: {
  customers: Customer[]
  order?: Order
  items?: OrderItem[]
  quote?: boolean
  onClose: () => void
  onDone: (id: number) => void
}) {
  const [customerId, setCustomerId] = useState(order ? String(order.customer_id) : '')
  const [title, setTitle] = useState(order?.title ?? '')
  const [orderDate, setOrderDate] = useState(order?.order_date ?? todayISO())
  const [dueDate, setDueDate] = useState(order?.due_date ?? '')
  const [notes, setNotes] = useState(order?.notes ?? '')
  const [discount, setDiscount] = useState(order ? String(order.discount) : '')
  const [lines, setLines] = useState<Line[]>(
    items?.length
      ? items.map((i) => ({
          description: i.description,
          qty: String(i.qty),
          unit_price: String(i.unit_price),
          size: i.size ?? '',
          custom: !!i.size && !(BED_SIZES as readonly string[]).includes(i.size),
          fabric: i.fabric ?? '',
          legs: i.legs ?? '',
        }))
      : [{ ...emptyLine }],
  )
  const [deposit, setDeposit] = useState('')
  const [method, setMethod] = useState<PayMethod>('cash')
  const [photos, setPhotos] = useState<{ file: File; url: string }[]>([])
  const photosRef = useRef(photos)
  useEffect(() => { photosRef.current = photos }, [photos])
  useEffect(() => () => photosRef.current.forEach((p) => URL.revokeObjectURL(p.url)), [])
  // رقم الطلبية بعد أول حفظ: إعادة الضغط على «حفظ» بعد خطأ تعدّلها ولا تنشئ طلبية ثانية
  const savedId = useRef<number | null>(order?.id ?? null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // نحسب فقط الأسطر التي ستُحفظ فعلًا (لها بيان وكمية)
  const isValid = (l: Line) => !!lineDescription(l) && Number(l.qty) > 0
  const subtotal = lines.filter(isValid).reduce((a, l) => a + Number(l.qty) * (Number(l.unit_price) || 0), 0)
  const total = subtotal - (Number(discount) || 0)
  const ignored = lines.filter((l) => !isValid(l) && (l.description.trim() || Number(l.unit_price) > 0)).length

  function setLine(i: number, patch: Partial<Line>) {
    setLines(lines.map((l, k) => (k === i ? { ...l, ...patch } : l)))
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    const valid = lines.filter(isValid)
    if (!customerId) return setError('اختر الزبون')
    if (!valid.length) return setError('أضف سطرًا واحدًا على الأقل')
    if (total < 0) return setError('التخفيض أكبر من المجموع')
    setBusy(true)
    setError('')

    // الطلبية وأسطرها تُحفظ دفعة واحدة في قاعدة البيانات: إمّا كلها أو لا شيء
    const { data, error: saveErr } = await supabase.rpc('save_order', {
      p_id: savedId.current,
      p_order: {
        customer_id: Number(customerId),
        title: title.trim(),
        order_date: orderDate,
        due_date: dueDate || '',
        notes: notes.trim(),
        discount: Number(discount) || 0,
        ...(quote && !order ? { is_quote: true } : {}),
      },
      p_items: valid.map((l) => ({
        description: lineDescription(l),
        size: l.size.trim(),
        fabric: l.fabric.trim(),
        legs: l.legs.trim(),
        qty: Number(l.qty),
        unit_price: Number(l.unit_price) || 0,
      })),
    })
    if (saveErr) { setBusy(false); return setError(arabicError(saveErr)) }
    const orderId = Number(data)
    savedId.current = orderId

    // صور السرير المطلوب: تُرفع بعد حفظ الطلبية، وكل صورة رُفعت تُزال من القائمة حتى لا تتكرر
    let left = photos
    for (const p of photos) {
      try {
        await addOrderPhoto(orderId, p.file)
        URL.revokeObjectURL(p.url)
        left = left.filter((x) => x !== p)
      } catch (e) {
        setPhotos(left)
        setBusy(false)
        return setError('حُفظت الطلبية لكن صورة لم تُرفع: ' + arabicError(e) + ' — اضغط «حفظ» مرة أخرى لإعادة المحاولة.')
      }
    }
    setPhotos(left)
    if (order) return onDone(orderId)

    if (Number(deposit) > 0) {
      const pay = await supabase.from('customer_payments').insert({
        customer_id: Number(customerId), order_id: orderId, amount: Number(deposit), paid_on: orderDate, method, notes: 'عربون',
      })
      if (pay.error) { setBusy(false); return setError('حُفظت الطلبية لكن العربون لم يُحفظ: ' + arabicError(pay.error) + ' — اضغط «حفظ» مرة أخرى لإعادة المحاولة.') }
    }
    onDone(orderId)
  }

  return (
    <Modal
      title={order ? `تعديل ${quote ? 'عرض السعر' : 'الطلبية'} رقم ${order.id}` : quote ? 'عرض سعر جديد' : 'طلبية جديدة'}
      onClose={onClose}
    >
      <form className="form" onSubmit={submit}>
        <div className="grid3">
          <label>الزبون
            <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} required>
              <option value="">— اختر —</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}{c.phone ? ` — ${c.phone}` : ''}</option>)}
            </select>
          </label>
          <label>تاريخ الطلب<input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} required /></label>
          <label>موعد التسليم<input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></label>
        </div>
        <label>الطلبية<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="غرفة نوم كاملة، سرير 160×200 بلوح رأس مبطّن…" required /></label>

        <div className="table-wrap">
          <table>
            <thead><tr><th>البيان</th><th>المقاس</th><th>القماش</th><th>الأرجل</th><th>الكمية</th><th>سعر الوحدة</th><th>المجموع</th><th></th></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td><input aria-label="البيان" value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} placeholder="سرير، خزانة، كومودينو…" /></td>
                  <td>
                    <div className="size-pick">
                      <select
                        aria-label="المقاس"
                        value={l.custom ? OTHER_SIZE : l.size}
                        onChange={(e) => {
                          const v = e.target.value
                          setLine(i, v === OTHER_SIZE ? { custom: true, size: '' } : { custom: false, size: v })
                        }}
                      >
                        <option value="">—</option>
                        {BED_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
                        <option value={OTHER_SIZE}>مقاس آخر…</option>
                      </select>
                      {l.custom && (
                        <input aria-label="مقاس آخر" value={l.size} onChange={(e) => setLine(i, { size: e.target.value })} placeholder="200/220" maxLength={40} />
                      )}
                    </div>
                  </td>
                  <td><input aria-label="القماش" value={l.fabric} onChange={(e) => setLine(i, { fabric: e.target.value })} placeholder="اكتب نوع القماش" autoComplete="off" maxLength={60} /></td>
                  <td><input aria-label="الأرجل" value={l.legs} onChange={(e) => setLine(i, { legs: e.target.value })} placeholder="اكتب نوع الأرجل" autoComplete="off" maxLength={60} /></td>
                  <td><input aria-label="الكمية" type="number" step="any" min="0" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} /></td>
                  <td><input aria-label="سعر الوحدة" type="number" step="any" min="0" value={l.unit_price} onChange={(e) => setLine(i, { unit_price: e.target.value })} /></td>
                  <td>{dzd((Number(l.qty) || 0) * (Number(l.unit_price) || 0))}</td>
                  <td><button type="button" className="link danger" onClick={() => setLines(lines.length > 1 ? lines.filter((_, k) => k !== i) : [{ ...emptyLine }])}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button type="button" className="secondary" onClick={() => setLines([...lines, { ...emptyLine }])}>+ سطر</button>

        <div className="grid3">
          <label>التخفيض<input type="number" step="any" min="0" value={discount} onChange={(e) => setDiscount(e.target.value)} /></label>
          <div className="stat-inline">المجموع: {dzd(subtotal)}</div>
          <div className="stat-inline total">الصافي: {dzd(total)}</div>
        </div>
        {ignored > 0 && <p className="error">{ignored === 1 ? 'سطر واحد ناقص' : `${ignored} أسطر ناقصة`} (بلا بيان أو بلا كمية) ولن يُحفظ ولا يدخل في المجموع.</p>}

        {!order && !quote && (
          <div className="grid3">
            <label>العربون المدفوع الآن
              <input type="number" step="any" min="0" value={deposit} onChange={(e) => setDeposit(e.target.value)} />
            </label>
            <label>الطريقة
              <select value={method} onChange={(e) => setMethod(e.target.value as PayMethod)}>
                {Object.entries(PAY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <div className="stat-inline">الباقي: <strong>{dzd(total - (Number(deposit) || 0))}</strong></div>
          </div>
        )}

        <label>ملاحظات (المقاسات، الألوان، القماش…)<input value={notes} onChange={(e) => setNotes(e.target.value)} /></label>

        <div>
          <span className="muted">صور السرير المطلوب (التصميم، صورة من الزبون…)</span>
          <div className="photo-row" style={{ marginTop: 6 }}>
            {photos.map((p) => (
              <button key={p.url} type="button" className="photo" aria-label="إزالة الصورة" title="إزالة"
                onClick={() => { URL.revokeObjectURL(p.url); setPhotos(photos.filter((x) => x !== p)) }}>
                <img src={p.url} alt="" />
              </button>
            ))}
            <label className="photo add" style={{ cursor: 'pointer' }}>
              <Icon name="image" />
              <small>إضافة صورة</small>
              <input type="file" accept="image/*" multiple hidden
                onChange={(e) => { const fs = Array.from(e.target.files ?? []); if (fs.length) setPhotos([...photos, ...fs.map((file) => ({ file, url: URL.createObjectURL(file) }))]); e.target.value = '' }} />
            </label>
          </div>
          {photos.length > 0 && <p className="muted" style={{ margin: '4px 0 0' }}>{photos.length} صورة ستُرفع عند الحفظ. اضغط على صورة لإزالتها.</p>}
        </div>

        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={busy}>{busy ? 'جارٍ الحفظ…' : quote ? 'حفظ عرض السعر' : 'حفظ الطلبية'}</button>
      </form>
    </Modal>
  )
}
