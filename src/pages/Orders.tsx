import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import Modal from '../components/Modal'
import { arabicError, dzd, num, supabase, todayISO } from '../lib/supabase'
import {
  ORDER_STATUS_LABELS,
  PAY_LABELS,
  UNIT_LABELS,
  type Customer,
  type CustomerPayment,
  type Order,
  type OrderItem,
  type OrderStatus,
  type OrderTotal,
  type PayMethod,
  type Unit,
} from '../lib/types'
import { CustomerPaymentModal } from './Customers'

type Line = { description: string; qty: string; unit_price: string }
const emptyLine: Line = { description: '', qty: '1', unit_price: '' }

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
}

const rest = (o: OrderTotal) => Number(o.total) - Number(o.paid)
const isLate = (o: OrderTotal, today: string) => ACTIVE.includes(o.status) && !!o.due_date && o.due_date < today

export default function Orders() {
  const [rows, setRows] = useState<OrderTotal[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [filter, setFilter] = useState<'active' | 'all' | OrderStatus>('active')
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<{ order?: Order; items?: OrderItem[] } | null>(null)
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
    const [o, i, p, m, raw] = await Promise.all([
      supabase.from('order_totals').select('*').eq('id', id).single(),
      supabase.from('order_items').select('*').eq('order_id', id).order('id'),
      supabase.from('customer_payments').select('*').eq('order_id', id).order('paid_on'),
      supabase
        .from('stock_movements')
        .select('id, qty, unit_cost, created_at, materials(name, unit), profiles(full_name)')
        .eq('order_id', id)
        .eq('type', 'out')
        .order('created_at'),
      supabase.from('orders').select('notes').eq('id', id).single(),
    ])
    if (o.error) return setError(arabicError(o.error))
    setDetail({
      o: o.data as OrderTotal,
      items: (i.data as OrderItem[]) ?? [],
      payments: (p.data as CustomerPayment[]) ?? [],
      moves: (m.data as unknown as MoveRow[]) ?? [],
      notes: (raw.data as { notes: string | null } | null)?.notes ?? null,
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
        (filter === 'all' || (filter === 'active' ? ACTIVE.includes(o.status) : o.status === filter)) &&
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

  async function remove(d: Detail) {
    if (!confirm(`حذف الطلبية رقم ${d.o.id} نهائيًا؟`)) return
    const { error } = await supabase.from('orders').delete().eq('id', d.o.id)
    if (error) return setError(arabicError(error))
    setDetail(null)
    load()
  }

  const activeCount = rows.filter((o) => ACTIVE.includes(o.status)).length
  const lateCount = rows.filter((o) => isLate(o, today)).length

  return (
    <div>
      <div className="page-head">
        <h2>الطلبيات</h2>
        <button onClick={() => setEditing({})} disabled={!customers.length} title={customers.length ? '' : 'أضف زبونًا أولًا'}>
          + طلبية جديدة
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {!customers.length && <p className="muted">لإضافة طلبية، أضف الزبون أولًا من صفحة <Link to="/customers">الزبائن</Link>.</p>}
      <p className="muted">
        طلبيات جارية: <strong>{activeCount}</strong>
        {lateCount > 0 && <> — متأخرة عن موعد التسليم: <strong className="neg">{lateCount}</strong></>}
      </p>

      <div className="filters">
        <input placeholder="بحث بالرقم، الزبون أو الطلبية" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
          <option value="active">الجارية</option>
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
                <td><span className={`status st-${o.status}`}>{ORDER_STATUS_LABELS[o.status]}</span></td>
                <td>{dzd(o.total)}</td>
                <td className={rest(o) > 0 && o.status !== 'cancelled' ? 'neg' : ''}>{dzd(rest(o))}</td>
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
        <Modal title={`طلبية رقم ${detail.o.id} — ${detail.o.customer_name}`} onClose={() => setDetail(null)}>
          <OrderDetail
            d={detail}
            today={today}
            onStatus={(s) => setStatus(detail.o, s)}
            onPay={() => setPaying(detail.o)}
            onEdit={() => startEdit(detail.o.id)}
            onInvoice={() => navigate(`/invoice/${detail.o.id}`)}
            onDelete={() => remove(detail)}
          />
        </Modal>
      )}
    </div>
  )
}

function OrderDetail({ d, today, onStatus, onPay, onEdit, onInvoice, onDelete }: {
  d: Detail
  today: string
  onStatus: (s: OrderStatus) => void
  onPay: () => void
  onEdit: () => void
  onInvoice: () => void
  onDelete: () => void
}) {
  const { o } = d
  const subtotal = d.items.reduce((a, i) => a + Number(i.qty) * Number(i.unit_price), 0)
  const profit = Number(o.total) - Number(o.material_cost)
  const canDelete = !d.payments.length && !d.moves.length

  return (
    <div className="form">
      <h3>{o.title}</h3>
      <div className="grid3">
        <div>تاريخ الطلب: <strong>{o.order_date}</strong></div>
        <div className={isLate(o, today) ? 'neg' : ''}>موعد التسليم: <strong>{o.due_date ?? '—'}</strong>{isLate(o, today) ? ' (متأخرة)' : ''}</div>
        <label>الحالة
          <select value={o.status} onChange={(e) => onStatus(e.target.value as OrderStatus)}>
            {Object.entries(ORDER_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
      </div>
      {o.delivered_on && <p className="muted">سُلّمت يوم {o.delivered_on}</p>}
      {d.notes && <p className="muted">ملاحظات: {d.notes}</p>}

      <div className="table-wrap">
        <table>
          <thead><tr><th>البيان</th><th>الكمية</th><th>السعر</th><th>المجموع</th></tr></thead>
          <tbody>
            {d.items.map((i) => (
              <tr key={i.id}>
                <td>{i.description}</td>
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
        <div className="stat"><span>المدفوع</span><strong className="pos">{dzd(o.paid)}</strong></div>
        <div className="stat"><span>الباقي</span><strong className={rest(o) > 0 ? 'neg' : ''}>{dzd(rest(o))}</strong></div>
      </div>

      <div className="stats">
        <div className="stat"><span>تكلفة المواد المُخرَجة</span><strong>{dzd(o.material_cost)}</strong></div>
        <div className="stat"><span>الربح التقريبي</span><strong className={profit < 0 ? 'neg' : 'pos'}>{dzd(profit)}</strong></div>
      </div>
      <p className="muted">الربح = الصافي ناقص تكلفة المواد التي أُخرجت لهذه الطلبية. لا يشمل أجور العمال والمصاريف الأخرى.</p>

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
            <span className="muted">{dzd(Number(m.qty) * Number(m.unit_cost ?? 0))} · {m.profiles?.full_name ?? ''} · {new Date(m.created_at).toLocaleDateString('fr-DZ')}</span>
          </li>
        ))}
        {!d.moves.length && <li className="muted">لم تخرج أي مادة بعد. اختر هذه الطلبية في صفحة «إخراج مواد».</li>}
      </ul>

      <div className="toolbar">
        <button onClick={onPay}>+ دفعة</button>
        <button className="secondary" onClick={onInvoice}>الفاتورة</button>
        <button className="secondary" onClick={onEdit}>تعديل</button>
        {canDelete && <button className="danger" onClick={onDelete}>حذف</button>}
      </div>
      {!canDelete && <p className="muted">لا يمكن حذف طلبية عليها دفعات أو مواد. غيّر حالتها إلى «ملغاة» بدل ذلك.</p>}
    </div>
  )
}

function OrderForm({ customers, order, items, onClose, onDone }: {
  customers: Customer[]
  order?: Order
  items?: OrderItem[]
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
    items?.length ? items.map((i) => ({ description: i.description, qty: String(i.qty), unit_price: String(i.unit_price) })) : [{ ...emptyLine }],
  )
  const [deposit, setDeposit] = useState('')
  const [method, setMethod] = useState<PayMethod>('cash')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const subtotal = lines.reduce((a, l) => a + (Number(l.qty) || 0) * (Number(l.unit_price) || 0), 0)
  const total = subtotal - (Number(discount) || 0)

  function setLine(i: number, patch: Partial<Line>) {
    setLines(lines.map((l, k) => (k === i ? { ...l, ...patch } : l)))
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    const valid = lines.filter((l) => l.description.trim() && Number(l.qty) > 0)
    if (!customerId) return setError('اختر الزبون')
    if (!valid.length) return setError('أضف سطرًا واحدًا على الأقل')
    if (total < 0) return setError('التخفيض أكبر من المجموع')
    setBusy(true)
    setError('')

    const row = {
      customer_id: Number(customerId),
      title: title.trim(),
      order_date: orderDate,
      due_date: dueDate || null,
      notes: notes.trim() || null,
      discount: Number(discount) || 0,
    }
    const itemRows = (orderId: number) =>
      valid.map((l) => ({ order_id: orderId, description: l.description.trim(), qty: Number(l.qty), unit_price: Number(l.unit_price) || 0 }))

    if (order) {
      const u = await supabase.from('orders').update(row).eq('id', order.id)
      if (u.error) { setBusy(false); return setError(arabicError(u.error)) }
      const del = await supabase.from('order_items').delete().eq('order_id', order.id)
      if (del.error) { setBusy(false); return setError(arabicError(del.error)) }
      const ins = await supabase.from('order_items').insert(itemRows(order.id))
      if (ins.error) { setBusy(false); return setError('حُذفت الأسطر القديمة ولم تُحفظ الجديدة: ' + arabicError(ins.error)) }
      return onDone(order.id)
    }

    const o = await supabase.from('orders').insert(row).select('id').single()
    if (o.error) { setBusy(false); return setError(arabicError(o.error)) }
    const orderId = (o.data as { id: number }).id
    const ins = await supabase.from('order_items').insert(itemRows(orderId))
    if (ins.error) {
      await supabase.from('orders').delete().eq('id', orderId)
      setBusy(false)
      return setError(arabicError(ins.error))
    }
    if (Number(deposit) > 0) {
      const pay = await supabase.from('customer_payments').insert({
        customer_id: Number(customerId), order_id: orderId, amount: Number(deposit), paid_on: orderDate, method, notes: 'عربون',
      })
      if (pay.error) { setBusy(false); return setError('حُفظت الطلبية لكن العربون لم يُحفظ: ' + arabicError(pay.error)) }
    }
    onDone(orderId)
  }

  return (
    <Modal title={order ? `تعديل الطلبية رقم ${order.id}` : 'طلبية جديدة'} onClose={onClose}>
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
            <thead><tr><th>البيان</th><th>الكمية</th><th>سعر الوحدة</th><th>المجموع</th><th></th></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td><input value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} placeholder="سرير، خزانة، كومودينو…" /></td>
                  <td><input type="number" step="any" min="0" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} /></td>
                  <td><input type="number" step="any" min="0" value={l.unit_price} onChange={(e) => setLine(i, { unit_price: e.target.value })} /></td>
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

        {!order && (
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

        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={busy}>{busy ? 'جارٍ الحفظ…' : 'حفظ الطلبية'}</button>
      </form>
    </Modal>
  )
}
