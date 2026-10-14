import { useEffect, useState, type FormEvent } from 'react'
import Modal from '../components/Modal'
import { useAuth } from '../lib/auth'
import { normPhone, randomPin, validPhone, validPin } from '../lib/phone'
import { arabicError, supabase } from '../lib/supabase'
import type { Employee, Profile, Role } from '../lib/types'
import { waLink } from '../lib/whatsapp'

interface Credentials {
  name: string
  phone: string
  pin: string
  isNew: boolean
}

/** رسالة الخطأ التي ترجعها دالة الخادم، أو تفسير مفهوم إن لم تكن منشورة */
async function fnError(error: unknown): Promise<string> {
  const ctx = (error as { context?: Response })?.context
  if (ctx && typeof ctx.json === 'function') {
    try {
      const body = await ctx.clone().json()
      if (body?.error) return String(body.error)
    } catch { /* ليس JSON */ }
    if (ctx.status === 404) return 'دالة manage-users غير منشورة بعد في Supabase. انظر README.'
  }
  const msg = arabicError(error)
  return /Failed to send|fetch/i.test(msg) ? 'تعذّر الوصول إلى دالة manage-users. تأكد أنها منشورة في Supabase.' : msg
}

async function callManage(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('manage-users', { body })
  if (error) throw new Error(await fnError(error))
  return data as { id?: string; ok?: boolean }
}

export default function Accounts() {
  const { session } = useAuth()
  const me = session!.user.id
  const [rows, setRows] = useState<Profile[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [creating, setCreating] = useState(false)
  const [creds, setCreds] = useState<Credentials | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')

  async function load() {
    const [p, e] = await Promise.all([
      supabase.from('profiles').select('id, full_name, role, phone, active').order('active', { ascending: false }).order('role').order('full_name'),
      supabase.from('employees').select('*').eq('active', true).is('profile_id', null).order('full_name'),
    ])
    if (p.error) setError(arabicError(p.error))
    setRows((p.data as Profile[]) ?? [])
    setEmployees((e.data as Employee[]) ?? [])
  }
  useEffect(() => {
    load()
  }, [])

  async function resetPin(p: Profile) {
    if (!confirm(`إنشاء رمز سري جديد لـ ${p.full_name}؟ الرمز القديم لن يعمل بعد الآن.`)) return
    const pin = randomPin()
    setBusy(p.id)
    setError('')
    try {
      await callManage({ action: 'reset_pin', profile_id: p.id, pin })
      setCreds({ name: p.full_name, phone: p.phone ?? '', pin, isNew: false })
    } catch (e) {
      setError((e as Error).message)
    }
    setBusy(null)
  }

  async function toggle(p: Profile) {
    const stop = p.active
    if (stop && !confirm(`إيقاف حساب ${p.full_name}؟ لن يستطيع الدخول حتى تعيد تفعيله.`)) return
    setBusy(p.id)
    setError('')
    try {
      await callManage({ action: 'set_active', profile_id: p.id, active: !stop })
      await load()
    } catch (e) {
      setError((e as Error).message)
    }
    setBusy(null)
  }

  return (
    <div>
      <div className="page-head">
        <h2>حسابات الدخول</h2>
        <button onClick={() => setCreating(true)}>+ حساب جديد</button>
      </div>
      <p className="muted">كل عامل يدخل برقم هاتفه ورمز سري من 6 أرقام. أنشئ له حسابًا وأرسل له الرمز عبر واتساب.</p>
      {error && <p className="error">{error}</p>}

      <div className="table-wrap">
        <table>
          <thead><tr><th>الاسم</th><th>الهاتف</th><th>الصفة</th><th>الحالة</th><th></th></tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className={p.active ? '' : 'muted'}>
                <td>{p.full_name}{p.id === me ? ' (أنت)' : ''}</td>
                <td dir="ltr">{p.phone ?? '—'}</td>
                <td><span className={`status ${p.role === 'admin' ? 'st-in_production' : 'st-new'}`}>{p.role === 'admin' ? 'مدير' : 'عامل'}</span></td>
                <td><span className={`status ${p.active ? 'st-ready' : 'st-cancelled'}`}>{p.active ? 'نشط' : 'موقوف'}</span></td>
                <td className="actions">
                  {p.phone && p.active && (
                    <button className="link" disabled={busy === p.id} onClick={() => resetPin(p)}>رمز جديد</button>
                  )}
                  {p.id !== me && (
                    <button className={`link${p.active ? ' danger' : ''}`} disabled={busy === p.id} onClick={() => toggle(p)}>
                      {p.active ? 'إيقاف' : 'تفعيل'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={5} className="muted center">لا توجد حسابات</td></tr>}
          </tbody>
        </table>
      </div>

      {creating && (
        <NewAccount
          employees={employees}
          onClose={() => setCreating(false)}
          onDone={(c) => { setCreating(false); setCreds(c); load() }}
        />
      )}
      {creds && <CredentialsCard creds={creds} onClose={() => setCreds(null)} />}
    </div>
  )
}

function NewAccount({ employees, onClose, onDone }: {
  employees: Employee[]
  onClose: () => void
  onDone: (c: Credentials) => void
}) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [role, setRole] = useState<Role>('worker')
  const [employeeId, setEmployeeId] = useState('')
  const [pin, setPin] = useState(randomPin)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function pickEmployee(id: string) {
    setEmployeeId(id)
    const e = employees.find((x) => String(x.id) === id)
    if (e) {
      if (!name.trim()) setName(e.full_name)
      if (!phone.trim() && e.phone) setPhone(e.phone)
    }
  }

  async function submit(ev: FormEvent) {
    ev.preventDefault()
    if (!validPhone(phone)) return setError('رقم الهاتف غير صحيح (10 أرقام تبدأ بـ 0)')
    if (!validPin(pin)) return setError('الرمز السري يجب أن يكون 6 أرقام')
    setBusy(true)
    setError('')
    try {
      await callManage({
        action: 'create',
        full_name: name.trim(),
        phone: normPhone(phone),
        pin,
        role,
        employee_id: employeeId ? Number(employeeId) : undefined,
      })
      onDone({ name: name.trim(), phone: normPhone(phone), pin, isNew: true })
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <Modal title="حساب جديد" onClose={onClose}>
      <form className="form" onSubmit={submit}>
        {role === 'worker' && employees.length > 0 && (
          <label>بطاقة العامل (اختياري، للرواتب وصفحة «راتبي»)
            <select value={employeeId} onChange={(e) => pickEmployee(e.target.value)}>
              <option value="">— بدون —</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
            </select>
          </label>
        )}
        <label>الاسم<input value={name} onChange={(e) => setName(e.target.value)} required autoFocus /></label>
        <label>رقم الهاتف (للدخول)<input dir="ltr" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0555123456" required /></label>
        <div className="grid3">
          <label>الصفة
            <select value={role} onChange={(e) => { setRole(e.target.value as Role); setEmployeeId('') }}>
              <option value="worker">عامل</option>
              <option value="admin">مدير (يرى كل شيء)</option>
            </select>
          </label>
          <label>الرمز السري
            <input dir="ltr" inputMode="numeric" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} required />
          </label>
        </div>
        {error && <p className="error">{error}</p>}
        <button type="submit" className="big-btn" disabled={busy}>{busy ? 'جارٍ الإنشاء…' : 'إنشاء الحساب'}</button>
      </form>
    </Modal>
  )
}

function CredentialsCard({ creds, onClose }: { creds: Credentials; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const text = [
    `مرحبًا ${creds.name}،`,
    creds.isNew ? 'هذا حسابك في تطبيق ورشة CHER MEUBLE:' : 'هذا رمزك السري الجديد لتطبيق CHER MEUBLE:',
    `الرابط: ${window.location.origin}`,
    `رقم الهاتف: ${creds.phone}`,
    `الرمز السري: ${creds.pin}`,
    'احتفظ بالرمز لنفسك.',
  ].join('\n')
  const wa = waLink(creds.phone, text)

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <Modal title={creds.isNew ? 'تم إنشاء الحساب' : 'تم تغيير الرمز'} onClose={onClose}>
      <div className="form">
        <ul className="list">
          <li><span className="muted">الاسم</span><strong>{creds.name}</strong></li>
          <li><span className="muted">رقم الهاتف</span><strong dir="ltr">{creds.phone}</strong></li>
          <li className="net"><span>الرمز السري</span><strong dir="ltr" style={{ letterSpacing: 4 }}>{creds.pin}</strong></li>
        </ul>
        <p className="muted">أرسل هذه المعلومات للعامل الآن. لن يظهر الرمز مرة أخرى، لكن يمكنك إنشاء رمز جديد في أي وقت.</p>
        {wa && <a className="btn wa big-btn" href={wa} target="_blank" rel="noopener">إرسال عبر واتساب</a>}
        <button className="secondary" onClick={copy}>{copied ? 'تم النسخ ✓' : 'نسخ الرسالة'}</button>
      </div>
    </Modal>
  )
}
