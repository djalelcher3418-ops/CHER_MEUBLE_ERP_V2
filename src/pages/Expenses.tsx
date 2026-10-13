import { useEffect, useState, type FormEvent } from 'react'
import Modal from '../components/Modal'
import { monthRange, thisMonth } from '../lib/payroll'
import { arabicError, dzd, supabase, todayISO } from '../lib/supabase'
import { PAY_LABELS, type Expense, type ExpenseCategory, type PayMethod } from '../lib/types'

type Draft = { id?: number; category_id: string; amount: string; spent_on: string; description: string; method: PayMethod }

export default function Expenses() {
  const [month, setMonth] = useState(thisMonth)
  const [rows, setRows] = useState<Expense[]>([])
  const [cats, setCats] = useState<ExpenseCategory[]>([])
  const [catFilter, setCatFilter] = useState('')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState('')

  async function load(m = month) {
    const { from, to } = monthRange(m)
    const [e, c] = await Promise.all([
      supabase.from('expenses').select('*').gte('spent_on', from).lte('spent_on', to).order('spent_on', { ascending: false }).order('id', { ascending: false }),
      supabase.from('expense_categories').select('*').order('id'),
    ])
    if (e.error) setError(arabicError(e.error))
    setRows((e.data as Expense[]) ?? [])
    setCats((c.data as ExpenseCategory[]) ?? [])
  }
  useEffect(() => {
    load(month)
  }, [month])

  async function save(ev: FormEvent) {
    ev.preventDefault()
    if (!draft) return
    const row = {
      category_id: draft.category_id ? Number(draft.category_id) : null,
      amount: Number(draft.amount),
      spent_on: draft.spent_on,
      description: draft.description.trim() || null,
      method: draft.method,
    }
    const res = draft.id ? await supabase.from('expenses').update(row).eq('id', draft.id) : await supabase.from('expenses').insert(row)
    if (res.error) return setError(arabicError(res.error))
    setDraft(null)
    setError('')
    load()
  }

  async function remove(e: Expense) {
    if (!confirm(`حذف مصروف ${dzd(e.amount)}؟`)) return
    const { error } = await supabase.from('expenses').delete().eq('id', e.id)
    if (error) return setError(arabicError(error))
    load()
  }

  async function addCategory() {
    const name = prompt('اسم الصنف الجديد')?.trim()
    if (!name) return
    const { error } = await supabase.from('expense_categories').insert({ name })
    if (error) return setError(arabicError(error))
    load()
  }

  const catName = (id: number | null) => cats.find((c) => c.id === id)?.name ?? '—'
  const shown = rows.filter((r) => !catFilter || String(r.category_id) === catFilter)
  const total = shown.reduce((a, r) => a + Number(r.amount), 0)
  const byCat = cats
    .map((c) => ({ name: c.name, sum: rows.filter((r) => r.category_id === c.id).reduce((a, r) => a + Number(r.amount), 0) }))
    .filter((c) => c.sum > 0)
    .sort((a, b) => b.sum - a.sum)

  return (
    <div>
      <div className="page-head">
        <h2>المصاريف</h2>
        <div className="toolbar">
          <button className="secondary" onClick={addCategory}>+ صنف</button>
          <button onClick={() => setDraft({ category_id: '', amount: '', spent_on: todayISO(), description: '', method: 'cash' })}>+ مصروف</button>
        </div>
      </div>
      {error && <p className="error">{error}</p>}

      <div className="filters">
        <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
        <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)}>
          <option value="">كل الأصناف</option>
          {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      <div className="stats">
        <div className="stat"><span>مجموع {monthRange(month).label}</span><strong>{dzd(total)}</strong></div>
        {byCat.slice(0, 3).map((c) => <div key={c.name} className="stat"><span>{c.name}</span><strong>{dzd(c.sum)}</strong></div>)}
      </div>

      <div className="table-wrap">
        <table>
          <thead><tr><th>التاريخ</th><th>الصنف</th><th>البيان</th><th>الطريقة</th><th>المبلغ</th><th></th></tr></thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id}>
                <td>{r.spent_on}</td>
                <td>{catName(r.category_id)}</td>
                <td>{r.description ?? ''}</td>
                <td>{PAY_LABELS[r.method]}</td>
                <td>{dzd(r.amount)}</td>
                <td className="actions">
                  <button className="link" onClick={() => setDraft({ id: r.id, category_id: r.category_id ? String(r.category_id) : '', amount: String(r.amount), spent_on: r.spent_on, description: r.description ?? '', method: r.method })}>تعديل</button>
                  <button className="link danger" onClick={() => remove(r)}>حذف</button>
                </td>
              </tr>
            ))}
            {!shown.length && <tr><td colSpan={6} className="muted center">لا مصاريف في هذا الشهر</td></tr>}
          </tbody>
        </table>
      </div>

      {draft && (
        <Modal title={draft.id ? 'تعديل مصروف' : 'مصروف جديد'} onClose={() => setDraft(null)}>
          <form className="form" onSubmit={save}>
            <div className="grid3">
              <label>الصنف
                <select value={draft.category_id} onChange={(e) => setDraft({ ...draft, category_id: e.target.value })} required>
                  <option value="">— اختر —</option>
                  {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
              <label>المبلغ<input type="number" step="any" min="0.01" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} required autoFocus /></label>
              <label>التاريخ<input type="date" value={draft.spent_on} onChange={(e) => setDraft({ ...draft, spent_on: e.target.value })} required /></label>
            </div>
            <label>البيان<input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="فاتورة كهرباء الثلاثي الثالث…" /></label>
            <label>الطريقة
              <select value={draft.method} onChange={(e) => setDraft({ ...draft, method: e.target.value as PayMethod })}>
                {Object.entries(PAY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <button type="submit">حفظ</button>
          </form>
        </Modal>
      )}
    </div>
  )
}
