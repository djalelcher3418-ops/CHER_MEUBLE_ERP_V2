import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Icon from '../components/Icon'
import type { ChatSummary } from '../lib/chat'
import { enablePush, pushActive, pushSupported, type PushResult } from '../lib/push'
import { arabicError, supabase, todayISO } from '../lib/supabase'

function when(ts: string | null) {
  if (!ts) return ''
  const d = new Date(ts)
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return day === todayISO()
    ? d.toLocaleTimeString('fr-DZ', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    : `${d.getDate()}/${d.getMonth() + 1}`
}

/** قائمة الدردشات: «كل الفريق» ثم الدردشات الخاصة */
export default function Messages() {
  const [chats, setChats] = useState<ChatSummary[] | null>(null)
  const [pushOn, setPushOn] = useState(pushActive)
  const [result, setResult] = useState<PushResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    const load = () =>
      supabase.rpc('chat_overview').then(({ data, error }) => {
        if (!alive) return
        if (error) setError(arabicError(error))
        setChats((data as ChatSummary[]) ?? [])
      })
    load()
    const ch = supabase
      .channel('chat-list')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, load)
      .subscribe()
    return () => { alive = false; supabase.removeChannel(ch) }
  }, [])

  async function enableNotifications() {
    setBusy(true)
    const r = await enablePush(true)
    setBusy(false)
    setResult(r)
    setPushOn(r === 'ok')
  }

  const RESULT: Record<PushResult, string> = {
    ok: 'تم. ستصلك التنبيهات على هذا الهاتف حتى والتطبيق مغلق.',
    denied: 'التنبيهات ممنوعة في إعدادات المتصفح. افتح إعدادات الموقع واسمح بالإشعارات ثم أعد المحاولة.',
    unsupported: 'هذا المتصفح لا يدعم التنبيهات. على الآيفون: أضف التطبيق إلى الشاشة الرئيسية أولًا ثم افتحه منها.',
    server: 'التنبيهات تعمل والتطبيق مفتوح فقط، لأن دالة send-push غير منشورة بعد في Supabase.',
  }

  return (
    <div>
      <div className="page-head"><h2>الرسائل</h2></div>
      {error && <p className="error">{error}</p>}
      {result && <p className={result === 'ok' ? 'success' : 'error'}>{RESULT[result]}</p>}
      {!pushOn && pushSupported() && result !== 'ok' && (
        <div className="card">
          <p style={{ marginTop: 0 }}>فعّل التنبيهات لتصلك الرسائل الجديدة على هذا الهاتف حتى والتطبيق مغلق.</p>
          <button className="secondary" onClick={enableNotifications} disabled={busy}><Icon name="bell" /> {busy ? 'جارٍ التفعيل…' : 'تفعيل التنبيهات'}</button>
        </div>
      )}
      {chats === null ? (
        <p className="muted">جارٍ التحميل…</p>
      ) : (
        <ul className="chat-list card">
          {chats.map((c) => (
            <li key={c.chat_id}>
              <Link to={`/messages/${c.chat_id}`}>
                <span className={`avatar${c.kind === 'team' ? ' team' : ''}`}>
                  {c.kind === 'team' ? <Icon name="team" /> : c.title.trim().charAt(0)}
                </span>
                <span className="chat-main">
                  <b>{c.title}</b>
                  <span>{c.last_text ?? 'لا رسائل بعد'}</span>
                </span>
                <span className="chat-end">
                  {when(c.last_at)}
                  {c.unread > 0 && <i className="unread">{c.unread}</i>}
                </span>
              </Link>
            </li>
          ))}
          {!chats.length && <li className="muted center">لا توجد دردشات. شغّل ملف الرسائل في Supabase أولًا.</li>}
        </ul>
      )}
    </div>
  )
}
