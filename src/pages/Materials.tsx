import { useEffect, useMemo, useState, type FormEvent } from 'react'
import Barcode from '../components/Barcode'
import Modal from '../components/Modal'
import { arabicError, dateTime, dzd, num, supabase } from '../lib/supabase'
import { UNIT_LABELS, type Category, type Material, type StockMovement, type Unit } from '../lib/types'

type Draft = {
  id?: number
  name: string
  category_id: string
  unit: Unit
  barcode: string
  min_qty: string
  notes: string
}

const emptyDraft: Draft = { name: '', category_id: '', unit: 'piece', barcode: '', min_qty: '0', notes: '' }

const MOVE_LABELS = { in: 'دخول', out: 'خروج', adjust: 'تصحيح' }

export default function Materials() {
  const [items, setItems] = useState<Material[]>([])
  const [cats, setCats] = useState<Category[]>([])
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('')
  const [lowOnly, setLowOnly] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [adjusting, setAdjusting] = useState<Material | null>(null)
  const [history, setHistory] = useState<{ m: Material; rows: StockMovement[] } | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [printing, setPrinting] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    const [m, c] = await Promise.all([
      supabase.from('materials').select('*').eq('active', true).order('name'),
      supabase.from('material_categories').select('*').order('id'),
    ])
    if (m.error) setError(arabicError(m.error))
    setItems((m.data as Material[]) ?? [])
    setCats((c.data as Category[]) ?? [])
  }
  useEffect(() => {
    load()
  }, [])

  const catName = (id: number | null) => cats.find((c) => c.id === id)?.name ?? '—'

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter(
      (m) =>
        (!q || m.name.toLowerCase().includes(q) || m.barcode.toLowerCase().includes(q)) &&
        (!catFilter || String(m.category_id) === catFilter) &&
        (!lowOnly || Number(m.qty) <= Number(m.min_qty)),
    )
  }, [items, search, catFilter, lowOnly])

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!draft) return
    const row = {
      name: draft.name.trim(),
      category_id: draft.category_id ? Number(draft.category_id) : null,
      unit: draft.unit,
      min_qty: Number(draft.min_qty) || 0,
      notes: draft.notes.trim() || null,
      ...(draft.barcode.trim() ? { barcode: draft.barcode.trim() } : {}),
    }
    const res = draft.id
      ? await supabase.from('materials').update(row).eq('id', draft.id)
      : await supabase.from('materials').insert(row)
    if (res.error) return setError(arabicError(res.error))
    setDraft(null)
    setError('')
    load()
  }

  async function archive(m: Material) {
    if (!confirm(`إخفاء المادة «${m.name}»؟ (يبقى سجلها محفوظًا)`)) return
    const { error } = await supabase.from('materials').update({ active: false }).eq('id', m.id)
    if (error) return setError(arabicError(error))
    load()
  }

  async function openHistory(m: Material) {
    const { data } = await supabase
      .from('stock_movements')
      .select('*')
      .eq('material_id', m.id)
      .order('created_at', { ascending: false })
      .limit(50)
    setHistory({ m, rows: (data as StockMovement[]) ?? [] })
  }

  function toggle(id: number) {
    const s = new Set(selected)
    if (s.has(id)) s.delete(id)
    else s.add(id)
    setSelected(s)
  }

  if (printing)
    return (
      <div>
        <div className="no-print toolbar">
          <button onClick={() => window.print()}>طباعة</button>
          <button className="secondary" onClick={() => setPrinting(false)}>رجوع</button>
        </div>
        <div className="labels">
          {items
            .filter((m) => selected.has(m.id))
            .map((m) => (
              <div className="label" key={m.id}>
                <div className="label-name">{m.name}</div>
                <Barcode value={m.barcode} />
              </div>
            ))}
        </div>
      </div>
    )

  return (
    <div>
      <div className="page-head">
        <h2>المواد</h2>
        <div className="toolbar">
          <button onClick={() => setDraft({ ...emptyDraft })}>+ مادة جديدة</button>
          <button className="secondary" disabled={!selected.size} onClick={() => setPrinting(true)}>
            طباعة الباركود ({selected.size})
          </button>
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="filters">
        <input placeholder="بحث بالاسم أو الباركود" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)}>
          <option value="">كل الأصناف</option>
          {cats.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <label className="check">
          <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} />
          الناقصة فقط
        </label>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th></th>
              <th>المادة</th>
              <th>الصنف</th>
              <th>الكمية</th>
              <th>متوسط السعر</th>
              <th>القيمة</th>
              <th>الباركود</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {shown.map((m) => {
              const low = Number(m.qty) <= Number(m.min_qty)
              return (
                <tr key={m.id} className={low ? 'low' : ''}>
                  <td><input type="checkbox" checked={selected.has(m.id)} onChange={() => toggle(m.id)} /></td>
                  <td>{m.name}</td>
                  <td>{catName(m.category_id)}</td>
                  <td>
                    {num(m.qty)} {UNIT_LABELS[m.unit]}
                    {low && <span className="badge">ناقصة</span>}
                  </td>
                  <td>{dzd(m.avg_cost)}</td>
                  <td>{dzd(Number(m.qty) * Number(m.avg_cost))}</td>
                  <td dir="ltr">{m.barcode}</td>
                  <td className="actions">
                    <button className="link" onClick={() => setDraft({
                      id: m.id, name: m.name, category_id: m.category_id ? String(m.category_id) : '',
                      unit: m.unit, barcode: m.barcode, min_qty: String(m.min_qty), notes: m.notes ?? '',
                    })}>تعديل</button>
                    <button className="link" onClick={() => setAdjusting(m)}>جرد</button>
                    <button className="link" onClick={() => openHistory(m)}>السجل</button>
                    <button className="link danger" onClick={() => archive(m)}>إخفاء</button>
                  </td>
                </tr>
              )
            })}
            {!shown.length && (
              <tr><td colSpan={8} className="muted center">لا توجد مواد</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {draft && (
        <Modal title={draft.id ? 'تعديل مادة' : 'مادة جديدة'} onClose={() => setDraft(null)}>
          <form onSubmit={save} className="form">
            <label>الاسم<input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required /></label>
            <label>الصنف
              <select value={draft.category_id} onChange={(e) => setDraft({ ...draft, category_id: e.target.value })}>
                <option value="">—</option>
                {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label>الوحدة
              <select value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value as Unit })}>
                {Object.entries(UNIT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label>حدّ التنبيه (أقل كمية)
              <input type="number" step="any" min="0" value={draft.min_qty} onChange={(e) => setDraft({ ...draft, min_qty: e.target.value })} />
            </label>
            <label>الباركود <span className="muted">(اتركه فارغًا ليُولَّد تلقائيًا، أو امسح باركود المورد)</span>
              <input dir="ltr" value={draft.barcode} onChange={(e) => setDraft({ ...draft, barcode: e.target.value })} />
            </label>
            <label>ملاحظات<input value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></label>
            <p className="muted">الكمية والسعر يُضافان من شاشة المشتريات أو من «جرد».</p>
            <button type="submit">حفظ</button>
          </form>
        </Modal>
      )}

      {adjusting && <AdjustModal m={adjusting} onClose={() => setAdjusting(null)} onDone={() => { setAdjusting(null); load() }} />}

      {history && (
        <Modal title={`سجل: ${history.m.name}`} onClose={() => setHistory(null)}>
          <div className="table-wrap">
            <table>
              <thead><tr><th>التاريخ</th><th>النوع</th><th>الكمية</th><th>السعر</th><th>ملاحظة</th></tr></thead>
              <tbody>
                {history.rows.map((r) => (
                  <tr key={r.id}>
                    <td>{dateTime(r.created_at)}</td>
                    <td>{MOVE_LABELS[r.type]}</td>
                    <td>{num(r.qty)}</td>
                    <td>{r.unit_cost != null ? dzd(r.unit_cost) : '—'}</td>
                    <td>{r.note ?? ''}</td>
                  </tr>
                ))}
                {!history.rows.length && <tr><td colSpan={5} className="muted center">لا توجد حركات</td></tr>}
              </tbody>
            </table>
          </div>
        </Modal>
      )}
    </div>
  )
}

/** جرد: تكتب الكمية الموجودة فعلًا، فيُسجَّل الفرق كحركة تصحيح */
function AdjustModal({ m, onClose, onDone }: { m: Material; onClose: () => void; onDone: () => void }) {
  const [real, setReal] = useState(String(m.qty))
  const [cost, setCost] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const diff = (Number(real) || 0) - Number(m.qty)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!diff) return onClose()
    // عند أول جرد لمادة بلا سعر: نُدخلها كـ "دخول" بسعر، حتى يُحسب متوسط السعر
    const firstStock = diff > 0 && Number(m.avg_cost) === 0 && cost
    const { error } = await supabase.from('stock_movements').insert(
      firstStock
        ? { material_id: m.id, type: 'in', qty: diff, unit_cost: Number(cost), note: note || 'رصيد افتتاحي' }
        : { material_id: m.id, type: 'adjust', qty: diff, note: note || 'جرد' },
    )
    if (error) return setError(arabicError(error))
    onDone()
  }

  return (
    <Modal title={`جرد: ${m.name}`} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <p>الكمية في النظام: <strong>{num(m.qty)} {UNIT_LABELS[m.unit]}</strong></p>
        <label>الكمية الموجودة فعلًا
          <input type="number" step="any" value={real} onChange={(e) => setReal(e.target.value)} required autoFocus />
        </label>
        <p>الفرق: <strong className={diff < 0 ? 'neg' : 'pos'}>{diff > 0 ? '+' : ''}{num(diff)}</strong></p>
        {diff > 0 && Number(m.avg_cost) === 0 && (
          <label>سعر الوحدة (للرصيد الافتتاحي)
            <input type="number" step="any" min="0" value={cost} onChange={(e) => setCost(e.target.value)} />
          </label>
        )}
        <label>ملاحظة<input value={note} onChange={(e) => setNote(e.target.value)} /></label>
        {error && <p className="error">{error}</p>}
        <button type="submit">تسجيل</button>
      </form>
    </Modal>
  )
}
