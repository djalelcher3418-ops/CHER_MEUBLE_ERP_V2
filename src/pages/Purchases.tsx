import { useEffect, useRef, useState, type FormEvent } from 'react'
import Icon from '../components/Icon'
import Modal from '../components/Modal'
import ScanInvoiceButton, { ScanSummary } from '../components/ScanInvoice'
import { signedUrls } from '../lib/chat'
import { linePrice, phoneDigits, type InvoiceScan } from '../lib/invoiceScan'
import { removePurchasePhoto, savePurchasePhoto } from '../lib/purchasePhoto'
import { arabicError, dzd, num, supabase, todayISO } from '../lib/supabase'
import { bestMatch } from '../lib/text'
import { PAY_LABELS, UNIT_LABELS, type Material, type PayMethod, type PurchaseTotal, type Supplier, type Unit } from '../lib/types'

/** scanned: ما كُتب في الفاتورة المصوّرة لهذا السطر (للمراجعة وإضافة مادة جديدة) */
type Line = { material_id: string; qty: string; unit_price: string; scanned?: { name: string; unit: Unit | null } }
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
  const [detail, setDetail] = useState<{ p: PurchaseTotal; items: ItemRow[]; photo: string | null } | null>(null)
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
    const [{ data }, ph] = await Promise.all([
      supabase.from('purchase_items').select('id, qty, unit_price, materials(name, unit)').eq('purchase_id', p.id),
      // قبل تشغيل 016 لا يوجد العمود: نتجاهل الخطأ ونخفي الصورة
      supabase.from('purchases').select('invoice_photo').eq('id', p.id).maybeSingle(),
    ])
    const photo = ph.error ? null : ((ph.data as { invoice_photo: string | null } | null)?.invoice_photo ?? null)
    setDetail({ p, items: (data as unknown as ItemRow[]) ?? [], photo })
  }

  async function remove(p: PurchaseTotal) {
    if (!confirm(`حذف الشراء رقم ${p.id}؟ ستُنقص كمياته من المخزون. الدفعات المرتبطة به تبقى في حساب المورد.`)) return
    const { error } = await supabase.from('purchases').delete().eq('id', p.id)
    if (error) return setError(arabicError(error))
    if (detail?.photo) removePurchasePhoto(detail.photo)
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
          <InvoicePhoto purchaseId={detail.p.id} path={detail.photo} onChanged={(photo) => setDetail({ ...detail, photo })} />
          <button className="danger" onClick={() => remove(detail.p)}>حذف هذا الشراء</button>
        </Modal>
      )}
    </div>
  )
}

function NewPurchase({ suppliers: initialSuppliers, materials: initialMaterials, onClose, onDone }: {
  suppliers: Supplier[]
  materials: Material[]
  onClose: () => void
  onDone: () => void
}) {
  // القوائم تكبر هنا إن أُضيف مورد أو مادة من الفاتورة المصوّرة
  const [suppliers, setSuppliers] = useState(initialSuppliers)
  const [materials, setMaterials] = useState(initialMaterials)
  const [readInvoice, setReadInvoice] = useState<InvoiceScan | null>(null)
  const [newSupplier, setNewSupplier] = useState<{ name: string; phone: string | null } | null>(null)
  // صورة الفاتورة: تُحفظ مع الشراء (من التصوير أو مرفقة يدويًا)
  const [photo, setPhoto] = useState<{ file: File; url: string } | null>(null)
  const photoInput = useRef<HTMLInputElement>(null)
  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.url) }, [photo])
  const pickPhoto = (file: File) => setPhoto({ file, url: URL.createObjectURL(file) })
  const [supplierId, setSupplierId] = useState('')
  const [date, setDate] = useState(todayISO)
  const [ref, setRef] = useState('')
  const [lines, setLines] = useState<Line[]>([{ ...emptyLine }])
  const [paid, setPaid] = useState('')
  const [method, setMethod] = useState<PayMethod>('cash')
  const [scan, setScan] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // رقم الشراء إن حُفظ ولم تُحفظ الدفعة: إعادة المحاولة تكمل الدفعة فقط ولا تكرر الشراء
  const savedId = useRef<number | null>(null)

  const total = lines.reduce((a, l) => a + (Number(l.qty) || 0) * (Number(l.unit_price) || 0), 0)

  function setLine(i: number, patch: Partial<Line>) {
    setLines(lines.map((l, k) => (k === i ? { ...l, ...patch } : l)))
  }

  /** ملء النموذج بما قُرئ من صورة الفاتورة */
  function applyScan(r: InvoiceScan, file: File) {
    pickPhoto(file)
    const sup = suppliers.find((x) => x.name === r.party_match) ?? bestMatch(r.party_name, suppliers)
    setSupplierId(sup ? String(sup.id) : '')
    setNewSupplier(!sup && r.party_name ? { name: r.party_name, phone: phoneDigits(r.party_phone) || null } : null)
    if (r.invoice_date) setDate(r.invoice_date)
    if (r.invoice_ref) setRef(r.invoice_ref)
    const read = r.lines.map((l): Line => {
      const m = materials.find((x) => x.name === l.match) ?? bestMatch(l.description, materials)
      const price = linePrice(l)
      return {
        material_id: m ? String(m.id) : '',
        qty: l.qty != null ? String(l.qty) : l.line_total != null ? '1' : '',
        unit_price: price != null ? String(price) : '',
        scanned: { name: l.description, unit: l.unit },
      }
    })
    setLines(read.length ? read : [{ ...emptyLine }])
    setReadInvoice(r)
    setError('')
  }

  async function addSupplier() {
    if (!newSupplier || busy) return
    setBusy(true)
    const { data, error } = await supabase.from('suppliers').insert({ name: newSupplier.name, phone: newSupplier.phone }).select('*').single()
    setBusy(false)
    if (error) return setError(arabicError(error))
    const s = data as Supplier
    setSuppliers([...suppliers, s].sort((a, b) => a.name.localeCompare(b.name, 'ar')))
    setSupplierId(String(s.id))
    setNewSupplier(null)
  }

  async function addMaterial(i: number) {
    const sc = lines[i].scanned
    if (!sc || busy) return
    setBusy(true)
    const { data, error } = await supabase.from('materials').insert({ name: sc.name, unit: sc.unit ?? 'piece' }).select('*').single()
    setBusy(false)
    if (error) return setError(arabicError(error))
    const m = data as Material
    setMaterials([...materials, m].sort((a, b) => a.name.localeCompare(b.name, 'ar')))
    setLines((ls) => ls.map((l, k) => (k === i ? { ...l, material_id: String(m.id) } : l)))
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
    if (busy) return
    setBusy(true)
    setError('')

    let purchaseId = savedId.current
    if (purchaseId == null) {
      const p = await supabase
        .from('purchases')
        .insert({ supplier_id: Number(supplierId), purchase_date: date, invoice_ref: ref.trim() || null })
        .select('id')
        .single()
      if (p.error) { setBusy(false); return setError(arabicError(p.error)) }
      purchaseId = (p.data as { id: number }).id

      const items = await supabase.from('purchase_items').insert(
        valid.map((l) => ({ purchase_id: purchaseId, material_id: Number(l.material_id), qty: Number(l.qty), unit_price: Number(l.unit_price) || 0 })),
      )
      if (items.error) {
        await supabase.from('purchases').delete().eq('id', purchaseId)
        setBusy(false)
        return setError(arabicError(items.error))
      }
      savedId.current = purchaseId
    }

    if (Number(paid) > 0) {
      const pay = await supabase.from('supplier_payments').insert({
        supplier_id: Number(supplierId), purchase_id: purchaseId, amount: Number(paid), paid_on: date, method,
      })
      if (pay.error) { setBusy(false); return setError(`حُفظ الشراء رقم ${purchaseId} لكن الدفعة لم تُحفظ: ${arabicError(pay.error)} — اضغط «حفظ» لإعادة محاولة الدفعة فقط.`) }
    }
    if (photo) {
      try {
        await savePurchasePhoto(purchaseId, photo.file)
      } catch (err) {
        alert(`حُفظ الشراء رقم ${purchaseId}، لكن صورة الفاتورة لم تُرفع (${arabicError(err)}). يمكنك إضافتها من تفاصيل الشراء.`)
      }
    }
    onDone()
  }

  return (
    <Modal title="فاتورة شراء جديدة" onClose={onClose}>
      <ScanInvoiceButton kind="purchase" onResult={applyScan} />
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
        {newSupplier && !supplierId && (
          <div className="scan-hint">
            <span>المورد في الفاتورة: «{newSupplier.name}» غير موجود في القائمة.</span>
            <button type="button" className="secondary" onClick={addSupplier}>إضافته كمورد جديد</button>
          </div>
        )}
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
                    <td><div className="mat-cell">
                      <select value={l.material_id} onChange={(e) => setLine(i, { material_id: e.target.value })} aria-label="المادة">
                        <option value="">— اختر —</option>
                        {materials.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                      </select>
                      {l.scanned && (
                        <small className="scanned-as">
                          في الفاتورة: «{l.scanned.name}»
                          {!l.material_id && (
                            <button type="button" className="link" onClick={() => addMaterial(i)}>+ مادة جديدة بهذا الاسم</button>
                          )}
                        </small>
                      )}
                    </div></td>
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

        <div className="invoice-photo">
          {photo ? (
            <>
              <img src={photo.url} alt="صورة فاتورة المورد" />
              <span>
                <strong>صورة الفاتورة</strong>
                <small className="muted">تُحفظ مع الشراء</small>
              </span>
              <button type="button" className="link danger" onClick={() => setPhoto(null)}>إزالة</button>
            </>
          ) : (
            <button type="button" className="link" onClick={() => photoInput.current?.click()}><Icon name="image" /> إرفاق صورة الفاتورة</button>
          )}
          <input ref={photoInput} type="file" accept="image/*" hidden aria-label="صورة الفاتورة"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) pickPhoto(f); e.target.value = '' }} />
        </div>

        <p className="total">المجموع: {dzd(total)}</p>
        {readInvoice && <ScanSummary scan={readInvoice} computed={total} />}

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

/** صورة فاتورة المورد في تفاصيل الشراء: عرض، تكبير، إضافة أو تغيير */
function InvoicePhoto({ purchaseId, path, onChanged }: { purchaseId: number; path: string | null; onChanged: (path: string) => void }) {
  const [url, setUrl] = useState<string | null>(null)
  const [view, setView] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let alive = true
    if (path) signedUrls([path], 'purchases').then((m) => { if (alive) setUrl(m.get(path) ?? null) })
    return () => { alive = false }
  }, [path])

  async function upload(file: File | undefined) {
    if (!file) return
    setBusy(true)
    setError('')
    try {
      onChanged(await savePurchasePhoto(purchaseId, file, path))
    } catch (e) {
      setError(arabicError(e))
    }
    setBusy(false)
  }

  return (
    <div className="invoice-photo">
      {path && (url ? (
        <button type="button" className="thumb" onClick={() => setView(true)} aria-label="تكبير صورة الفاتورة"><img src={url} alt="صورة فاتورة المورد" /></button>
      ) : <span className="thumb muted">…</span>)}
      <span>
        <strong>صورة الفاتورة</strong>
        <small className="muted">{path ? 'اضغط على الصورة لتكبيرها' : 'لا توجد صورة لهذا الشراء'}</small>
      </span>
      <button type="button" className="secondary" disabled={busy} onClick={() => input.current?.click()}>
        <Icon name="camera" /> {busy ? '…' : path ? 'تغيير' : 'إضافة صورة'}
      </button>
      <input ref={input} type="file" accept="image/*" hidden onChange={(e) => { upload(e.target.files?.[0]); e.target.value = '' }} />
      {error && <p className="error">{error}</p>}
      {view && url && (
        <div className="viewer" onClick={() => setView(false)}>
          <img src={url} alt="" />
          <button className="icon-btn" aria-label="إغلاق"><Icon name="close" /></button>
        </div>
      )}
    </div>
  )
}
