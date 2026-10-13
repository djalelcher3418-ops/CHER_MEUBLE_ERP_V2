import { useState, type FormEvent } from 'react'
import { arabicError, supabase } from '../lib/supabase'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (error) setError(arabicError(error))
    setBusy(false)
  }

  return (
    <div className="center-page">
      <form className="card narrow" onSubmit={submit}>
        <h1 className="brand big">CHER MEUBLE</h1>
        <p className="muted">تسجيل الدخول</p>
        <label>
          البريد الإلكتروني
          <input type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" />
        </label>
        <label>
          كلمة المرور
          <input type="password" dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={busy}>{busy ? '…' : 'دخول'}</button>
      </form>
    </div>
  )
}
