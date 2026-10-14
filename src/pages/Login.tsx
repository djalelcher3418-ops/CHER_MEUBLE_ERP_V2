import { useState, type FormEvent } from 'react'
import { loginEmail } from '../lib/phone'
import { arabicError, supabase } from '../lib/supabase'

export default function Login() {
  const [id, setId] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email: loginEmail(id), password })
    if (error) setError(arabicError(error))
    setBusy(false)
  }

  return (
    <div className="center-page">
      <form className="card narrow" onSubmit={submit}>
        <div className="login-logo">CM</div>
        <h1 className="brand big">CHER MEUBLE</h1>
        <p className="muted center" style={{ margin: 0 }}>نظام تسيير الورشة — سجّل دخولك</p>
        <label>
          رقم الهاتف أو البريد الإلكتروني
          <input dir="ltr" inputMode="email" value={id} onChange={(e) => setId(e.target.value)} placeholder="0555123456" required autoComplete="username" />
        </label>
        <label>
          الرمز السري
          <input type="password" dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" className="big-btn" disabled={busy}>{busy ? '…' : 'دخول'}</button>
        <p className="muted center" style={{ margin: 0 }}>نسيت الرمز؟ اطلب من المدير رمزًا جديدًا.</p>
      </form>
    </div>
  )
}
