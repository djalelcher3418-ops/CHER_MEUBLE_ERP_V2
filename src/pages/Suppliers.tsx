import { useEffect, useState, type FormEvent } from 'react'
import Modal from '../components/Modal'
import { arabicError, dzd, supabase, todayISO } from '../lib/supabase'
import { PAY_LABELS, type PayMethod, type PurchaseTotal, type Supplier, type SupplierBalance } from '../lib/types'

type Draft = { id?: number; name: string; phone: string; address: string; notes: string; opening_balance: string }
const emptyDraft: Draft = { name: '', phone: '', address: '', notes: '', opening_balance: '0' }

interface Payment {
  id: number
  amount: number
  paid_on: string
  method: PayMethod
  notes: string | null
  purchase_id: number | null
}

export default function Suppliers() {
  const [rows, setRows] = useState<SupplierBalance[]>([])
  const [draft, setDraft] = useState<Draft | null>(null)
  const [paying, setPaying] = useState<SupplierBalance | null>(null)
  const [statement, setStatement] = useState<{ s: SupplierBalance; purchases: PurchaseTotal[]; payments: Payment[]; opening: number } | null>(null)
  const [error, setError] = useState('')

  async function load() {
    const { data, error } = await supabase.from('supplier_balances').select('*').order('name')
    if (error) setError(arabicError(error))
    setRows((data as SupplierBalance[]) ?? [])
  }
  useEffect(() => {
    load()
  }, [])

  async function edit(id: number) {
    const { data } = await supabase.from('suppliers').select('*').eq('id', id).single()
    const s = data as Supplier
    setDraft({ id: s.id, name: s.name, phone: s.phone ?? '', address: s.address ?? '', notes: s.notes ?? '', opening_balance: String(s.opening_balance) })
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
      ? await supabase.from('suppliers').update(row).eq('id', draft.id)
      : await supabase.from('suppliers').insert(row)
    if (res.error) return setError(arabicError(res.error))
    setDraft(null)
    load()
  }

  async function openStatement(s: SupplierBalance) {
    const [p, pay, sup] = await Promise.all([
      supabase.from('purchase_totals').select('*').eq('supplier_id', s.id).order('purchase_date', { ascending: false }),
      supabase.from('supplier_payments').select('*').eq('supplier_id', s.id).order('paid_on', { ascending: false }),
      supabase.from('suppliers').select('opening_balance').eq('id', s.id).single(),
    ])
    setStatement({
      s,
      purchases: (p.data as PurchaseTotal[]) ?? [],
      payments: (pay.data as Payment[]) ?? [],
      opening: Number((sup.data as { opening_balance: number } | null)?.opening_balance ?? 0),
    })
  }

  const totalDebt = rows.reduce((a, r) => a + Number(r.balance), 0)

  return (
    <div>
      <div className="page-head">
        <h2>الموردون</h2>
        <button onClick={() => setDraft({ ...emptyDraft })}>+ مورد جديد</button>
      </div>
      {error && <p className="error">{error}</p>}
      <p className="muted">مجموع ما عليك للموردين: <strong>{dzd(totalDebt)}</strong></p>

      <div className="table-wrap">
        <table>
          <thead><tr><th>المورد</th><th>الهاتف</th><th>الباقي عليك</th><th></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td dir="ltr">{r.phone ?? ''}</td>
                <td className={Number(r.balance) > 0 ? 'neg' : ''}>{dzd(r.balance)}</td>
                <td className="actions">
                  <button className="link" onClick={() => setPaying(r)}>دفعة</button>
                  <button className="link" onClick={() => openStatement(r)}>كشف الحساب</button>
                  <button className="link" onClick={() => edit(r.id)}>تعديل</button>
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={4} className="muted center">لا يوجد موردون</td></tr>}
          </tbody>
        </table>
      </div>

      {draft && (
        <Modal title={draft.id ? 'تعديل مورد' : 'مورد جديد'} onClose={() => setDraft(null)}>
          <form className="form" onSubmit={save}>
            <label>الاسم<input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required /></label>
            <label>الهاتف<input dir="ltr" value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} /></label>
            <label>العنوان<input value={draft.address} onChange={(e) => setDraft({ ...draft, address: e.target.value })} /></label>
            <label>دين قديم له (قبل بدء النظام)
              <input type="number" step="any" value={draft.opening_balance} onChange={(e) => setDraft({ ...draft, opening_balance: e.target.value })} />
            </label>
            <label>ملاحظات<input value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></label>
            <button type="submit">حفظ</button>
          </form>
        </Modal>
      )}

      {paying && <PaymentModal supplier={paying} onClose={() => setPaying(null)} onDone={() => { setPaying(null); load() }} />}

      {statement && (
        <Modal title={`كشف حساب: ${statement.s.name}`} onClose={() => setStatement(null)}>
          <p>دين قديم: {dzd(statement.opening)} — الباقي الآن: <strong>{dzd(statement.s.balance)}</strong></p>
          <h4>المشتريات</h4>
          <div className="table-wrap">
            <table>
              <thead><tr><th>رقم</th><th>التاريخ</th><th>المرجع</th><th>المبلغ</th></tr></thead>
              <tbody>
                {statement.purchases.map((p) => (
                  <tr key={p.id}><td>{p.id}</td><td>{p.purchase_date}</td><td>{p.invoice_ref ?? ''}</td><td>{dzd(p.total)}</td></tr>
                ))}
                {!statement.purchases.length && <tr><td colSpan={4} className="muted center">لا شيء</td></tr>}
              </tbody>
            </table>
          </div>
          <h4>الدفعات</h4>
          <div className="table-wrap">
            <table>
              <thead><tr><th>التاريخ</th><th>المبلغ</th><th>الطريقة</th><th>ملاحظة</th></tr></thead>
              <tbody>
                {statement.payments.map((p) => (
                  <tr key={p.id}><td>{p.paid_on}</td><td>{dzd(p.amount)}</td><td>{PAY_LABELS[p.method]}</td><td>{p.notes ?? (p.purchase_id ? `شراء رقم ${p.purchase_id}` : '')}</td></tr>
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

function PaymentModal({ supplier, onClose, onDone }: { supplier: SupplierBalance; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(todayISO)
  const [method, setMethod] = useState<PayMethod>('cash')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    const { error } = await supabase.from('supplier_payments').insert({
      supplier_id: supplier.id,
      amount: Number(amount),
      paid_on: date,
      method,
      notes: notes.trim() || null,
    })
    if (error) return setError(arabicError(error))
    onDone()
  }

  return (
    <Modal title={`دفعة لـ ${supplier.name}`} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <p>الباقي عليك: <strong>{dzd(supplier.balance)}</strong></p>
        <label>المبلغ<input type="number" step="any" min="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required autoFocus /></label>
        <label>التاريخ<input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></label>
        <label>الطريقة
          <select value={method} onChange={(e) => setMethod(e.target.value as PayMethod)}>
            {Object.entries(PAY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label>ملاحظة<input value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        {error && <p className="error">{error}</p>}
        <button type="submit">تسجيل الدفعة</button>
      </form>
    </Modal>
  )
}
