import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { PERIOD_START_DAY, WEEK, paySummary, periodRange, ymd } from '../lib/payroll'
import { arabicError, dzd, num, supabase, todayISO } from '../lib/supabase'
import type { Absence, Advance, Employee, PayrollPayment } from '../lib/types'

/** تقويم الحضور + حساب الراتب لفترة واحدة. editable = للمدير فقط */
export default function PayPeriod({ employee, editable }: { employee: Employee; editable: boolean }) {
  const [offset, setOffset] = useState(0)
  const [absences, setAbsences] = useState<Absence[]>([])
  const [advances, setAdvances] = useState<Advance[]>([])
  const [payment, setPayment] = useState<PayrollPayment | null>(null)
  const [advForm, setAdvForm] = useState(false)
  const [settling, setSettling] = useState(false)
  const [error, setError] = useState('')

  const p = periodRange(offset)
  const today = todayISO()

  const load = useCallback(async () => {
    const { from, to } = periodRange(offset)
    const [a, v, pay] = await Promise.all([
      supabase.from('absences').select('*').eq('employee_id', employee.id).gte('day', from).lte('day', to),
      supabase.from('employee_advances').select('*').eq('employee_id', employee.id).gte('given_on', from).lte('given_on', to).order('given_on'),
      supabase.from('payroll_payments').select('*').eq('employee_id', employee.id).eq('period_start', from).maybeSingle(),
    ])
    if (a.error) setError(arabicError(a.error))
    setAbsences((a.data as Absence[]) ?? [])
    setAdvances((v.data as Advance[]) ?? [])
    setPayment((pay.data as PayrollPayment | null) ?? null)
  }, [employee.id, offset])

  useEffect(() => {
    load()
  }, [load])

  const s = paySummary(p, Number(employee.daily_wage), absences, advances)
  const byDay = new Map(absences.map((a) => [a.day, a]))
  const lead = (p.start.getDay() + 1) % 7 // السبت أول الأسبوع
  const ongoing = today >= p.from && today <= p.to

  /** حضور ← غياب ← نصف يوم ← حضور */
  async function toggle(day: string) {
    if (payment) return setError('هذه الفترة مدفوعة. احذف تسجيل الدفع أولًا لتعديل الغيابات.')
    setError('')
    const a = byDay.get(day)
    const res = !a
      ? await supabase.from('absences').insert({ employee_id: employee.id, day })
      : !a.half_day
        ? await supabase.from('absences').update({ half_day: true }).eq('id', a.id)
        : await supabase.from('absences').delete().eq('id', a.id)
    if (res.error) setError(arabicError(res.error))
    load()
  }

  async function removeAdvance(a: Advance) {
    if (!confirm(`حذف تسبيق ${dzd(a.amount)}؟`)) return
    const { error } = await supabase.from('employee_advances').delete().eq('id', a.id)
    if (error) setError(arabicError(error))
    load()
  }

  async function undoPayment() {
    if (!payment || !confirm('حذف تسجيل دفع راتب هذه الفترة؟')) return
    const { error } = await supabase.from('payroll_payments').delete().eq('id', payment.id)
    if (error) setError(arabicError(error))
    load()
  }

  return (
    <div>
      <section className="card">
        <div className="period">
          <button className="secondary" onClick={() => setOffset(offset - 1)} aria-label="الفترة السابقة">→</button>
          <strong>{p.label}</strong>
          <button className="secondary" onClick={() => setOffset(offset + 1)} aria-label="الفترة التالية">←</button>
        </div>
        <div className="cal">
          {WEEK.map((w) => <div key={w} className="wd">{w}</div>)}
          {Array.from({ length: lead }, (_, i) => <div key={`e${i}`} />)}
          {p.days.map((d) => {
            const k = ymd(d)
            const a = byDay.get(k)
            const cls = `d${a ? (a.half_day ? ' half' : ' abs') : ''}${k > today ? ' future' : ''}${k === today ? ' today' : ''}`
            return editable ? (
              <button key={k} type="button" className={cls} onClick={() => toggle(k)} aria-label={k}>{d.getDate()}</button>
            ) : (
              <div key={k} className={cls}>{d.getDate()}</div>
            )
          })}
        </div>
        <div className="legend">
          <span><i className="lg-present" />حضور</span>
          <span><i className="lg-abs" />غياب</span>
          <span><i className="lg-half" />نصف يوم</span>
        </div>
        {editable && <p className="muted">اضغط على اليوم: مرة = غياب، مرتين = نصف يوم، ثلاث مرات = حضور.</p>}
        {error && <p className="error">{error}</p>}
      </section>

      <section className="card">
        <ul className="list">
          <li><span>أيام الفترة</span><strong>{s.totalDays}</strong></li>
          <li><span>الغيابات</span><strong>{num(s.absentDays)}</strong></li>
          <li><span>أيام العمل</span><strong>{num(s.workedDays)}</strong></li>
          <li><span>أجر اليوم</span><strong>{dzd(employee.daily_wage)}</strong></li>
          <li><span>المستحق</span><strong>{dzd(s.gross)}</strong></li>
          <li><span>التسبيقات</span><strong>{s.advances ? `− ${dzd(s.advances)}` : dzd(0)}</strong></li>
          <li className="net"><span>الصافي</span><strong>{dzd(s.net)}</strong></li>
        </ul>
        {ongoing && !payment && <p className="muted">الفترة ما زالت جارية. المبلغ النهائي يُحسب يوم {PERIOD_START_DAY - 1}.</p>}
        {payment ? (
          <p className="success">
            دُفع الراتب يوم {payment.paid_on}: {dzd(payment.amount)}
            {editable && <button className="link danger" onClick={undoPayment}>إلغاء التسجيل</button>}
          </p>
        ) : (
          editable && <button onClick={() => setSettling(true)}>تسجيل دفع راتب هذه الفترة</button>
        )}
      </section>

      <section className="card">
        <h3>التسبيقات</h3>
        <ul className="list">
          {advances.map((a) => (
            <li key={a.id}>
              <span>{a.given_on}{a.notes ? ` — ${a.notes}` : ''}</span>
              <span>
                <strong>{dzd(a.amount)}</strong>
                {editable && !payment && <button className="link danger" onClick={() => removeAdvance(a)}>حذف</button>}
              </span>
            </li>
          ))}
          {!advances.length && <li className="muted">لا توجد تسبيقات في هذه الفترة</li>}
        </ul>
        {editable && !payment && !advForm && <button className="secondary" onClick={() => setAdvForm(true)}>+ تسبيق</button>}
        {editable && advForm && (
          <AdvanceForm employeeId={employee.id} period={p} onDone={() => { setAdvForm(false); load() }} onCancel={() => setAdvForm(false)} />
        )}
      </section>

      {settling && (
        <SettleForm
          employee={employee}
          period={p}
          summary={s}
          onDone={() => { setSettling(false); load() }}
          onCancel={() => setSettling(false)}
        />
      )}
    </div>
  )
}

function AdvanceForm({ employeeId, period, onDone, onCancel }: {
  employeeId: number
  period: ReturnType<typeof periodRange>
  onDone: () => void
  onCancel: () => void
}) {
  const t = todayISO()
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(t >= period.from && t <= period.to ? t : period.from)
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (date < period.from || date > period.to) return setError('التاريخ خارج هذه الفترة')
    const { error } = await supabase.from('employee_advances').insert({ employee_id: employeeId, amount: Number(amount), given_on: date, notes: notes.trim() || null })
    if (error) return setError(arabicError(error))
    onDone()
  }

  return (
    <form className="form" onSubmit={submit}>
      <div className="grid3">
        <label>المبلغ<input type="number" step="any" min="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required autoFocus /></label>
        <label>التاريخ<input type="date" min={period.from} max={period.to} value={date} onChange={(e) => setDate(e.target.value)} required /></label>
        <label>ملاحظة<input value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="toolbar">
        <button type="submit">حفظ التسبيق</button>
        <button type="button" className="secondary" onClick={onCancel}>إلغاء</button>
      </div>
    </form>
  )
}

function SettleForm({ employee, period, summary, onDone, onCancel }: {
  employee: Employee
  period: ReturnType<typeof periodRange>
  summary: ReturnType<typeof paySummary>
  onDone: () => void
  onCancel: () => void
}) {
  const [amount, setAmount] = useState(String(Math.max(summary.net, 0)))
  const [date, setDate] = useState(todayISO)
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    const { error } = await supabase.from('payroll_payments').insert({
      employee_id: employee.id,
      period_start: period.from,
      period_end: period.to,
      days_worked: summary.workedDays,
      daily_wage: employee.daily_wage,
      gross: summary.gross,
      advances: summary.advances,
      amount: Number(amount) || 0,
      paid_on: date,
      notes: notes.trim() || null,
    })
    if (error) return setError(arabicError(error))
    onDone()
  }

  return (
    <section className="card">
      <h3>دفع راتب {employee.full_name}</h3>
      <form className="form" onSubmit={submit}>
        <p>الصافي المحسوب: <strong>{dzd(summary.net)}</strong></p>
        <div className="grid3">
          <label>المبلغ المدفوع<input type="number" step="any" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} required /></label>
          <label>تاريخ الدفع<input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></label>
          <label>ملاحظة<input value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        </div>
        {error && <p className="error">{error}</p>}
        <div className="toolbar">
          <button type="submit">تأكيد الدفع</button>
          <button type="button" className="secondary" onClick={onCancel}>إلغاء</button>
        </div>
      </form>
    </section>
  )
}
