import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import Modal from '../components/Modal'
import { arabicError, dzd, supabase, todayISO } from '../lib/supabase'
import {
  ORDER_STATUS_LABELS,
  PAY_LABELS,
  type Customer,
  type CustomerBalance,
  type CustomerPayment,
  type OrderTotal,
  type PayMethod,
} from '../lib/types'

type Draft = { id?: number; name: string; phone: string; address: string; notes: string; opening_balance: string }
const emptyDraft: Draft = { name: '', phone: '', address: '', notes: '', opening_balance: '0' }

export default function Customers() {
  const [rows, setRows] = useState<CustomerBalance[]>([])
  const [search, setSearch] = useState('')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [paying, setPaying] = useState<CustomerBalance | null>(null)
  const [statement, setStatement] = useState<{ c: CustomerBalance; orders: OrderTotal[]; payments: CustomerPayment[]; opening: number } | null>(null)
  const [error, setError] = useState('')

  async function load() {
    const { data, error } = await supabase.from('customer_balances').select('*').order('name')
    if (error) setError(arabicError(error))
    setRows((data as CustomerBalance[]) ?? [])
  }
  useEffect(() => {
    load()
  }, [])

  async function edit(id: number) {
    const { data } = await supabase.from('customers').select('*').eq('id', id).single()
    const c = data as Customer
    setDraft({ id: c.id, name: c.name, phone: c.phone ?? '', address: c.address ?? '', notes: c.notes ?? '', opening_balance: String(c.opening_balance) })
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!draft) return
    const row = {
      name: draft.name.trim(),
      phone: draft.phone.trim() || null,
      address: draft.address.trim() || null,
      notes: draft.notes.trim() || null,
      opening_balance: Number(draft.opening_balance) || 0,
    }
    const res = draft.id
      ? await supabase.from('customers').update(row).eq('id', draft.id)
      : await supabase.from('customers').insert(row)
    if (res.error) return setError(arabicError(res.error))
    setDraft(null)
    setError('')
    load()
  }

  async function openStatement(c: CustomerBalance) {
    const [o, pay, cus] = await Promise.all([
      supabase.from('order_totals').select('*').eq('customer_id', c.id).order('order_date', { ascending: false }),
      supabase.from('customer_payments').select('*').eq('customer_id', c.id).order('paid_on', { ascending: false }),
      supabase.from('customers').select('opening_balance').eq('id', c.id).single(),
    ])
    setStatement({
      c,
      orders: (o.data as OrderTotal[]) ?? [],
      payments: (pay.data as CustomerPayment[]) ?? [],
      opening: Number((cus.data as { opening_balance: number } | null)?.opening_balance ?? 0),
    })
  }

  const q = search.trim().toLowerCase()
  const shown = rows.filter((r) => !q || r.name.toLowerCase().includes(q) || (r.phone ?? '').includes(q))
  const totalDue = rows.reduce((a, r) => a + Math.max(Number(r.balance), 0), 0)

  return (
    <div>
      <div className="page-head">
        <h2>الزبائن</h2>
        <button onClick={() => setDraft({ ...emptyDraft })}>+ زبون جديد</button>
      </div>
      {error && <p className="error">{error}</p>}
      <p className="muted">مجموع ما لك عند الزبائن: <strong>{dzd(totalDue)}</strong></p>

      <div className="filters">
        <input placeholder="بحث بالاسم أو الهاتف" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <div className="table-wrap">
        <table>
          <thead><tr><th>الزبون</th><th>الهاتف</th><th>الباقي عليه</th><th></th></tr></thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td dir="ltr">{r.phone ?? ''}</td>
                <td className={Number(r.balance) > 0 ? 'neg' : Number(r.balance) < 0 ? 'pos' : ''}>{dzd(r.balance)}</td>
                <td className="actions">
                  <button className="link" onClick={() => setPaying(r)}>دفعة</button>
                  <button className="link" onClick={() => openStatement(r)}>كشف الحساب</button>
                  <button className="link" onClick={() => edit(r.id)}>تعديل</button>
                </td>
              </tr>
            ))}
            {!shown.length && <tr><td colSpan={4} className="muted center">لا يوجد زبائن</td></tr>}
          </tbody>
        </table>
      </div>

      {draft && (
        <Modal title={draft.id ? 'تعديل زبون' : 'زبون جديد'} onClose={() => setDraft(null)}>
          <form className="form" onSubmit={save}>
            <label>الاسم<input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required autoFocus /></label>
            <label>الهاتف<input dir="ltr" inputMode="tel" value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} /></label>
            <label>العنوان<input value={draft.address} onChange={(e) => setDraft({ ...draft, address: e.target.value })} /></label>
            <label>دين قديم عليه (قبل بدء النظام)
              <input type="number" step="any" value={draft.opening_balance} onChange={(e) => setDraft({ ...draft, opening_balance: e.target.value })} />
            </label>
            <label>ملاحظات<input value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></label>
            <button type="submit">حفظ</button>
          </form>
        </Modal>
      )}

      {paying && (
        <CustomerPaymentModal
          customerId={paying.id}
          customerName={paying.name}
          balance={Number(paying.balance)}
          onClose={() => setPaying(null)}
          onDone={() => { setPaying(null); load() }}
        />
      )}

      {statement && (
        <Modal title={`كشف حساب: ${statement.c.name}`} onClose={() => setStatement(null)}>
          <p>دين قديم: {dzd(statement.opening)} — الباقي الآن: <strong>{dzd(statement.c.balance)}</strong></p>
          <h4>الطلبيات</h4>
          <div className="table-wrap">
            <table>
              <thead><tr><th>رقم</th><th>التاريخ</th><th>الطلبية</th><th>الحالة</th><th>المبلغ</th></tr></thead>
              <tbody>
                {statement.orders.map((o) => (
                  <tr key={o.id}>
                    <td><Link to={`/orders?open=${o.id}`}>{o.id}</Link></td>
                    <td>{o.order_date}</td>
                    <td>{o.title}</td>
                    <td>{ORDER_STATUS_LABELS[o.status]}</td>
                    <td className={o.status === 'cancelled' ? 'muted' : ''}>{dzd(o.total)}</td>
                  </tr>
                ))}
                {!statement.orders.length && <tr><td colSpan={5} className="muted center">لا شيء</td></tr>}
              </tbody>
            </table>
          </div>
          <h4>الدفعات</h4>
          <div className="table-wrap">
            <table>
              <thead><tr><th>التاريخ</th><th>المبلغ</th><th>الطريقة</th><th>ملاحظة</th></tr></thead>
              <tbody>
                {statement.payments.map((p) => (
                  <tr key={p.id}>
                    <td>{p.paid_on}</td>
                    <td>{dzd(p.amount)}</td>
                    <td>{PAY_LABELS[p.method]}</td>
                    <td>{p.notes ?? (p.order_id ? `طلبية رقم ${p.order_id}` : '')}</td>
                  </tr>
                ))}
                {!statement.payments.length && <tr><td colSpan={4} className="muted center">لا شيء</td></tr>}
              </tbody>
            </table>
          </div>
        </Modal>
      )}
    </div>
  )
}

/** دفعة من زبون، يمكن ربطها بطلبية من طلبياته */
export function CustomerPaymentModal({ customerId, customerName, balance, orderId, onClose, onDone }: {
  customerId: number
  customerName: string
  balance: number
  orderId?: number
  onClose: () => void
  onDone: () => void
}) {
  const [orders, setOrders] = useState<OrderTotal[]>([])
  const [order, setOrder] = useState(orderId ? String(orderId) : '')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(todayISO)
  const [method, setMethod] = useState<PayMethod>('cash')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase
      .from('order_totals')
      .select('*')
      .eq('customer_id', customerId)
      .neq('status', 'cancelled')
      .order('order_date', { ascending: false })
      .then(({ data }) => setOrders(((data as OrderTotal[]) ?? []).filter((o) => !o.is_quote || o.id === orderId)))
  }, [customerId, orderId])

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    const { error } = await supabase.from('customer_payments').insert({
      customer_id: customerId,
      order_id: order ? Number(order) : null,
      amount: Number(amount),
      paid_on: date,
      method,
      notes: notes.trim() || null,
    })
    setBusy(false)
    if (error) return setError(arabicError(error))
    onDone()
  }

  const picked = orders.find((o) => String(o.id) === order)

  return (
    <Modal title={`دفعة من ${customerName}`} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <p>الباقي على الزبون: <strong>{dzd(balance)}</strong></p>
        <label>الطلبية (اختياري)
          <select value={order} onChange={(e) => setOrder(e.target.value)}>
            <option value="">— بدون طلبية —</option>
            {orders.map((o) => (
              <option key={o.id} value={o.id}>
                {o.id} — {o.title} (الباقي {dzd(Number(o.total) - Number(o.paid))})
              </option>
            ))}
          </select>
        </label>
        {picked && <p className="muted">الباقي من هذه الطلبية: {dzd(Number(picked.total) - Number(picked.paid))}</p>}
        <label>المبلغ<input type="number" step="any" min="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required autoFocus /></label>
        <label>التاريخ<input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></label>
        <label>الطريقة
          <select value={method} onChange={(e) => setMethod(e.target.value as PayMethod)}>
            {Object.entries(PAY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label>ملاحظة<input value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={busy}>{busy ? 'جارٍ الحفظ…' : 'تسجيل الدفعة'}</button>
      </form>
    </Modal>
  )
}
