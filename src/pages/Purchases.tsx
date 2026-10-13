import { useEffect, useState, type FormEvent } from 'react'
import Modal from '../components/Modal'
import { arabicError, dzd, num, supabase } from '../lib/supabase'
import { PAY_LABELS, UNIT_LABELS, type Material, type PayMethod, type PurchaseTotal, type Supplier } from '../lib/types'

type Line = { material_id: string; qty: string; unit_price: string }
const emptyLine: Line = { material_id: '', qty: '', unit_price: '' }

interface ItemRow {
  id: number
  qty: number
  unit_price: number
  materials: { name: string; unit: keyof typeof UNIT_LABELS } | null
}

export default function Purchases() {
  const [rows, setRows] = useState<PurchaseTotal[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [materials, setMaterials] = useState<Material[]>([])
  const [creating, setCreating] = useState(false)
  const [detail, setDetail] = useState<{ p: PurchaseTotal; items: ItemRow[] } | null>(null)
  const [error, setError] = useState('')

  async function load() {
    const [p, s, m] = await Promise.all([
      supabase.from('purchase_totals').select('*').order('purchase_date', { ascending: false }).order('id', { ascending: false }).limit(200),
      supabase.from('suppliers').select('*').eq('active', true).order('name'),
      supabase.from('materials').select('*').eq('active', true).order('name'),
    ])
    if (p.error) setError(arabicError(p.error))
    setRows((p.data as PurchaseTotal[]) ?? [])
    setSuppliers((s.data as Supplier[]) ?? [])
    setMaterials((m.data as Material[]) ?? [])
  }
  useEffect(() => {
    load()
  }, [])

  const supName = (id: number | null) => suppliers.find((s) => s.id === id)?.name ?? '—'

  async function openDetail(p: PurchaseTotal) {
    const { data } = await supabase.from('purchase_items').select('id, qty, unit_price, materials(name, unit)').eq('purchase_id', p.id)
    setDetail({ p, items: (data as unknown as ItemRow[]) ?? [] })
  }

  async function remove(p: PurchaseTotal) {
    if (!confirm(`حذف الشراء رقم ${p.id}؟ ستُنقص كمياته من المخزون. الدفعات المرتبطة به تبقى في حساب المورد.`)) return
    const { error } = await supabase.from('purchases').delete().eq('id', p.id)
    if (error) return setError(arabicError(error))
    setDetail(null)
    load()
  }

  return (
    <div>
      <div className="page-head">
        <h2>المشتريات</h2>
        <button onClick={() => setCreating(true)}>+ فاتورة شراء</button>
      </div>
      {error && <p className="error">{error}</p>}

      <div className="table-wrap">
        <table>
          <thead><tr><th>رقم</th><th>التاريخ</th><th>المورد</th><th>المرجع</th><th>المبلغ</th><th>المدفوع</th><th>الباقي</th><th></th></tr></thead>
          <tbody>
            {rows.map((p) => {
              const rest = Number(p.total) - Number(p.paid)
              return (
                <tr key={p.id}>
                  <td>{p.id}</td>
                  <td>{p.purchase_date}</td>
                  <td>{supName(p.supplier_id)}</td>
                  <td>{p.invoice_ref ?? ''}</td>
                  <td>{dzd(p.total)}</td>
                  <td>{dzd(p.paid)}</td>
                  <td className={rest > 0 ? 'neg' : ''}>{dzd(rest)}</td>
                  <td className="actions"><button className="link" onClick={() => openDetail(p)}>التفاصيل</button></td>
                </tr>
              )
            })}
            {!rows.length && <tr><td colSpan={8} className="muted center">لا توجد مشتريات</td></tr>}
          </tbody>
        </table>
      </div>

      {creating && (
        <NewPurchase
          suppliers={suppliers}
          materials={materials}
          onClose={() => setCreating(false)}
          onDone={() => { setCreating(false); load() }}
        />
      )}

      {detail && (
        <Modal title={`شراء رقم ${detail.p.id} — ${supName(detail.p.supplier_id)}`} onClose={() => setDetail(null)}>
          <p>التاريخ: {detail.p.purchase_date} {detail.p.invoice_ref ? `— المرجع: ${detail.p.invoice_ref}` : ''}</p>
          <div className="table-wrap">
            <table>
              <thead><tr><th>المادة</th><th>الكمية</th><th>السعر</th><th>المجموع</th></tr></thead>
              <tbody>
                {detail.items.map((i) => (
                  <tr key={i.id}>
                    <td>{i.materials?.name}</td>
                    <td>{num(i.qty)} {i.materials ? UNIT_LABELS[i.materials.unit] : ''}</td>
                    <td>{dzd(i.unit_price)}</td>
                    <td>{dzd(Number(i.qty) * Number(i.unit_price))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>المجموع: <strong>{dzd(detail.p.total)}</strong> — المدفوع: {dzd(detail.p.paid)}</p>
          <button className="danger" onClick={() => remove(detail.p)}>حذف هذا الشراء</button>
        </Modal>
      )}
    </div>
  )
}

function NewPurchase({ suppliers, materials, onClose, onDone }: {
  suppliers: Supplier[]
  materials: Material[]
  onClose: () => void
  onDone: () => void
}) {
  const [supplierId, setSupplierId] = useState('')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [ref, setRef] = useState('')
  const [lines, setLines] = useState<Line[]>([{ ...emptyLine }])
  const [paid, setPaid] = useState('')
  const [method, setMethod] = useState<PayMethod>('cash')
  const [scan, setScan] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const total = lines.reduce((a, l) => a + (Number(l.qty) || 0) * (Number(l.unit_price) || 0), 0)

  function setLine(i: number, patch: Partial<Line>) {
    setLines(lines.map((l, k) => (k === i ? { ...l, ...patch } : l)))
  }

  /** مسح باركود بقارئ USB: يضيف سطرًا للمادة */
  function addByBarcode(e: FormEvent) {
    e.preventDefault()
    const m = materials.find((x) => x.barcode === scan.trim())
    if (!m) return setError(`لا توجد مادة بالباركود ${scan}`)
    setError('')
    const empty = lines.findIndex((l) => !l.material_id)
    const line = { material_id: String(m.id), qty: '1', unit_price: m.avg_cost ? String(m.avg_cost) : '' }
    if (empty >= 0) setLine(empty, line)
    else setLines([...lines, line])
    setScan('')
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    const valid = lines.filter((l) => l.material_id && Number(l.qty) > 0)
    if (!supplierId) return setError('اختر المورد')
    if (!valid.length) return setError('أضف مادة واحدة على الأقل')
    setBusy(true)
    setError('')

    const p = await supabase
      .from('purchases')
      .insert({ supplier_id: Number(supplierId), purchase_date: date, invoice_ref: ref.trim() || null })
      .select('id')
      .single()
    if (p.error) { setBusy(false); return setError(arabicError(p.error)) }
    const purchaseId = (p.data as { id: number }).id

    const items = await supabase.from('purchase_items').insert(
      valid.map((l) => ({ purchase_id: purchaseId, material_id: Number(l.material_id), qty: Number(l.qty), unit_price: Number(l.unit_price) || 0 })),
    )
    if (items.error) {
      await supabase.from('purchases').delete().eq('id', purchaseId)
      setBusy(false)
      return setError(arabicError(items.error))
    }

    if (Number(paid) > 0) {
      const pay = await supabase.from('supplier_payments').insert({
        supplier_id: Number(supplierId), purchase_id: purchaseId, amount: Number(paid), paid_on: date, method,
      })
      if (pay.error) { setBusy(false); return setError('حُفظ الشراء لكن الدفعة لم تُحفظ: ' + arabicError(pay.error)) }
    }
    onDone()
  }

  return (
    <Modal title="فاتورة شراء جديدة" onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <div className="grid3">
          <label>المورد
            <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} required>
              <option value="">— اختر —</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label>التاريخ<input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></label>
          <label>رقم فاتورة المورد<input value={ref} onChange={(e) => setRef(e.target.value)} /></label>
        </div>
      </form>

      <form className="scan-row" onSubmit={addByBarcode}>
        <input dir="ltr" placeholder="امسح باركود مادة (اختياري)" value={scan} onChange={(e) => setScan(e.target.value)} />
        <button type="submit" className="secondary">إضافة</button>
      </form>

      <form className="form" onSubmit={submit}>
        <div className="table-wrap">
          <table>
            <thead><tr><th>المادة</th><th>الكمية</th><th>سعر الوحدة</th><th>المجموع</th><th></th></tr></thead>
            <tbody>
              {lines.map((l, i) => {
                const m = materials.find((x) => String(x.id) === l.material_id)
                return (
                  <tr key={i}>
                    <td>
                      <select value={l.material_id} onChange={(e) => setLine(i, { material_id: e.target.value })}>
                        <option value="">— اختر —</option>
                        {materials.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                      </select>
                    </td>
                    <td><input type="number" step="any" min="0" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} placeholder={m ? UNIT_LABELS[m.unit] : ''} /></td>
                    <td><input type="number" step="any" min="0" value={l.unit_price} onChange={(e) => setLine(i, { unit_price: e.target.value })} /></td>
                    <td>{dzd((Number(l.qty) || 0) * (Number(l.unit_price) || 0))}</td>
                    <td><button type="button" className="link danger" onClick={() => setLines(lines.length > 1 ? lines.filter((_, k) => k !== i) : [{ ...emptyLine }])}>✕</button></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <button type="button" className="secondary" onClick={() => setLines([...lines, { ...emptyLine }])}>+ سطر</button>

        <p className="total">المجموع: {dzd(total)}</p>

        <div className="grid3">
          <label>المدفوع الآن (اتركه فارغًا إن كان كله دَينًا)
            <input type="number" step="any" min="0" value={paid} onChange={(e) => setPaid(e.target.value)} />
          </label>
          <label>الطريقة
            <select value={method} onChange={(e) => setMethod(e.target.value as PayMethod)}>
              {Object.entries(PAY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <div className="stat-inline">الباقي دَينًا: <strong>{dzd(total - (Number(paid) || 0))}</strong></div>
        </div>

        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={busy}>{busy ? 'جارٍ الحفظ…' : 'حفظ الشراء'}</button>
      </form>
    </Modal>
  )
}
