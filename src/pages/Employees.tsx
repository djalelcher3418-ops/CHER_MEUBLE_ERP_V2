import { useEffect, useState, type FormEvent } from 'react'
import Modal from '../components/Modal'
import PayPeriod from '../components/PayPeriod'
import { arabicError, dzd, supabase } from '../lib/supabase'
import type { Employee, Profile } from '../lib/types'

type Draft = {
  id?: number
  full_name: string
  phone: string
  daily_wage: string
  profile_id: string
  hired_on: string
  notes: string
  active: boolean
}
const emptyDraft: Draft = { full_name: '', phone: '', daily_wage: '', profile_id: '', hired_on: '', notes: '', active: true }

export default function Employees() {
  const [rows, setRows] = useState<Employee[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [showInactive, setShowInactive] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [open, setOpen] = useState<Employee | null>(null)
  const [error, setError] = useState('')

  async function load() {
    const [e, p] = await Promise.all([
      supabase.from('employees').select('*').order('active', { ascending: false }).order('full_name'),
      supabase.from('profiles').select('id, full_name, role, phone, active').eq('role', 'worker').order('full_name'),
    ])
    if (e.error) setError(arabicError(e.error))
    setRows((e.data as Employee[]) ?? [])
    setProfiles((p.data as Profile[]) ?? [])
  }
  useEffect(() => {
    load()
  }, [])

  function edit(e: Employee) {
    setDraft({
      id: e.id,
      full_name: e.full_name,
      phone: e.phone ?? '',
      daily_wage: String(e.daily_wage),
      profile_id: e.profile_id ?? '',
      hired_on: e.hired_on ?? '',
      notes: e.notes ?? '',
      active: e.active,
    })
  }

  async function save(ev: FormEvent) {
    ev.preventDefault()
    if (!draft) return
    const row = {
      full_name: draft.full_name.trim(),
      phone: draft.phone.trim() || null,
      daily_wage: Number(draft.daily_wage) || 0,
      profile_id: draft.profile_id || null,
      hired_on: draft.hired_on || null,
      notes: draft.notes.trim() || null,
      active: draft.active,
    }
    const res = draft.id
      ? await supabase.from('employees').update(row).eq('id', draft.id).select('*').single()
      : await supabase.from('employees').insert(row).select('*').single()
    if (res.error) return setError(arabicError(res.error))
    setDraft(null)
    setError('')
    if (open && draft.id === open.id) setOpen(res.data as Employee)
    load()
  }

  const linkedTo = (pid: string | null) => profiles.find((p) => p.id === pid)?.full_name
  const taken = new Set(rows.map((r) => r.profile_id).filter(Boolean))
  const shown = rows.filter((r) => showInactive || r.active)
  const dailyTotal = rows.filter((r) => r.active).reduce((a, r) => a + Number(r.daily_wage), 0)

  if (open)
    return (
      <div>
        <div className="page-head">
          <h2>{open.full_name}</h2>
          <div className="toolbar">
            <button className="secondary" onClick={() => edit(open)}>تعديل</button>
            <button className="secondary" onClick={() => setOpen(null)}>رجوع للعمّال</button>
          </div>
        </div>
        {error && <p className="error">{error}</p>}
        <PayPeriod key={open.id} employee={open} editable />
        {draft && <EmployeeForm draft={draft} setDraft={setDraft} profiles={profiles} taken={taken} onSubmit={save} />}
      </div>
    )

  return (
    <div>
      <div className="page-head">
        <h2>العمّال والرواتب</h2>
        <button onClick={() => setDraft({ ...emptyDraft })}>+ عامل جديد</button>
      </div>
      {error && <p className="error">{error}</p>}
      <p className="muted">مجموع الأجور اليومية للعمّال النشطين: <strong>{dzd(dailyTotal)}</strong></p>
      <div className="filters">
        <label className="check"><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> إظهار العمّال المتوقفين</label>
      </div>

      <div className="table-wrap">
        <table>
          <thead><tr><th>العامل</th><th>الهاتف</th><th>أجر اليوم</th><th>حساب التطبيق</th><th></th></tr></thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id} className={r.active ? '' : 'muted'}>
                <td>{r.full_name}{!r.active && ' (متوقف)'}</td>
                <td dir="ltr">{r.phone ?? ''}</td>
                <td>{dzd(r.daily_wage)}</td>
                <td>{linkedTo(r.profile_id) ?? '—'}</td>
                <td className="actions">
                  <button className="link" onClick={() => setOpen(r)}>الحضور والراتب</button>
                  <button className="link" onClick={() => edit(r)}>تعديل</button>
                </td>
              </tr>
            ))}
            {!shown.length && <tr><td colSpan={5} className="muted center">لا يوجد عمّال</td></tr>}
          </tbody>
        </table>
      </div>

      {draft && <EmployeeForm draft={draft} setDraft={setDraft} profiles={profiles} taken={taken} onSubmit={save} />}
    </div>
  )
}

function EmployeeForm({ draft, setDraft, profiles, taken, onSubmit }: {
  draft: Draft
  setDraft: (d: Draft | null) => void
  profiles: Profile[]
  taken: Set<string | null>
  onSubmit: (e: FormEvent) => void
}) {
  const options = profiles.filter((p) => p.id === draft.profile_id || !taken.has(p.id))
  return (
    <Modal title={draft.id ? 'تعديل عامل' : 'عامل جديد'} onClose={() => setDraft(null)}>
      <form className="form" onSubmit={onSubmit}>
        <label>الاسم<input value={draft.full_name} onChange={(e) => setDraft({ ...draft, full_name: e.target.value })} required autoFocus /></label>
        <div className="grid3">
          <label>الهاتف<input dir="ltr" inputMode="tel" value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} /></label>
          <label>أجر اليوم (دج)<input type="number" step="any" min="0" value={draft.daily_wage} onChange={(e) => setDraft({ ...draft, daily_wage: e.target.value })} required /></label>
          <label>تاريخ التوظيف<input type="date" value={draft.hired_on} onChange={(e) => setDraft({ ...draft, hired_on: e.target.value })} /></label>
        </div>
        <label>حسابه في التطبيق (ليرى صفحة «راتبي»)
          <select value={draft.profile_id} onChange={(e) => setDraft({ ...draft, profile_id: e.target.value })}>
            <option value="">— بدون حساب —</option>
            {options.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>
        </label>
        <label>ملاحظات<input value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></label>
        {draft.id && (
          <label className="check"><input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} /> العامل ما زال يعمل</label>
        )}
        <button type="submit">حفظ</button>
      </form>
    </Modal>
  )
}
