import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Icon from '../components/Icon'
import { useAuth } from '../lib/auth'
import { sendPush } from '../lib/push'
import { signedUrls, uploadChatImage, type ChatRead, type ChatSummary, type Message } from '../lib/chat'
import { MONTHS } from '../lib/payroll'
import { arabicError, supabase, todayISO } from '../lib/supabase'

const dayKey = (ts: string) => {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const dayLabel = (key: string) => {
  if (key === todayISO()) return 'اليوم'
  const [y, m, d] = key.split('-').map(Number)
  return `${d} ${MONTHS[m - 1]} ${y}`
}
const hm = (ts: string) => new Date(ts).toLocaleTimeString('fr-DZ', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

export default function Chat() {
  const { id } = useParams()
  const chatId = Number(id)
  const { session, isAdmin } = useAuth()
  const me = session!.user.id
  const navigate = useNavigate()

  const [info, setInfo] = useState<ChatSummary | null>(null)
  const [msgs, setMsgs] = useState<Message[]>([])
  const [reads, setReads] = useState<ChatRead[]>([])
  const [urls, setUrls] = useState<Map<string, string>>(new Map())
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [picked, setPicked] = useState<number | null>(null)
  const [viewer, setViewer] = useState<string | null>(null)
  const [error, setError] = useState('')
  const box = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const fileInput = useRef<HTMLInputElement>(null)

  const markRead = useCallback(() => {
    if (document.visibilityState === 'visible') supabase.rpc('mark_chat_read', { p_chat: chatId }).then(() => {})
  }, [chatId])

  const loadReads = useCallback(() => {
    supabase.from('chat_reads').select('*').eq('chat_id', chatId).then(({ data }) => setReads((data as ChatRead[]) ?? []))
  }, [chatId])

  useEffect(() => {
    let alive = true
    supabase.rpc('chat_overview').then(({ data }) => {
      if (alive) setInfo(((data as ChatSummary[]) ?? []).find((c) => c.chat_id === chatId) ?? null)
    })
    supabase
      .from('messages')
      .select('*')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: false })
      .limit(200)
      .then(({ data, error }) => {
        if (!alive) return
        if (error) setError(arabicError(error))
        setMsgs(((data as Message[]) ?? []).reverse())
        markRead()
      })
    loadReads()

    const ch = supabase
      .channel('chat-' + chatId)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `chat_id=eq.${chatId}` }, (p) => {
        const m = p.new as Message
        setMsgs((list) => (list.some((x) => x.id === m.id) ? list : [...list, m]))
        if (m.sender_id !== me) markRead()
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' }, (p) => {
        const gone = (p.old as { id: number }).id
        setMsgs((list) => list.filter((x) => x.id !== gone))
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_reads', filter: `chat_id=eq.${chatId}` }, loadReads)
      .subscribe()

    const onVisible = () => { if (document.visibilityState === 'visible') { markRead(); loadReads() } }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive = false
      document.removeEventListener('visibilitychange', onVisible)
      supabase.removeChannel(ch)
    }
  }, [chatId, me, markRead, loadReads])

  // روابط الصور
  useEffect(() => {
    const paths = msgs.map((m) => m.image_path).filter((p): p is string => !!p && !urls.has(p))
    if (paths.length) signedUrls(paths).then((got) => setUrls((old) => new Map([...old, ...got])))
  }, [msgs, urls])

  // النزول لآخر رسالة
  useLayoutEffect(() => {
    const el = box.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [msgs, urls])

  function onScroll() {
    const el = box.current
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
  }

  async function post(row: { body?: string; image_path?: string }) {
    const { data, error } = await supabase.from('messages').insert({ chat_id: chatId, ...row }).select('*').single()
    if (error) throw error
    sendPush({ message_id: (data as Message).id })
    stick.current = true
    setMsgs((list) => (list.some((x) => x.id === (data as Message).id) ? list : [...list, data as Message]))
  }

  async function sendText() {
    const body = text.trim()
    if (!body || sending) return
    setSending(true)
    setError('')
    try {
      await post({ body })
      setText('')
    } catch (e) {
      setError(arabicError(e))
    }
    setSending(false)
  }

  async function sendImages(files: FileList | null) {
    if (!files?.length) return
    setSending(true)
    setError('')
    try {
      for (const f of Array.from(files)) {
        const path = await uploadChatImage(chatId, f)
        await post({ image_path: path })
      }
    } catch (e) {
      setError('تعذّر إرسال الصورة: ' + arabicError(e))
    }
    setSending(false)
    if (fileInput.current) fileInput.current.value = ''
  }

  async function remove(m: Message) {
    if (!confirm('حذف هذه الرسالة؟')) return
    const { error } = await supabase.from('messages').delete().eq('id', m.id)
    if (error) return setError(arabicError(error))
    if (m.image_path) supabase.storage.from('chat').remove([m.image_path]).then(() => {})
    setMsgs((list) => list.filter((x) => x.id !== m.id))
    setPicked(null)
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) {
      e.preventDefault()
      sendText()
    }
  }

  const others = reads.filter((r) => r.profile_id !== me)
  const seenBy = (m: Message) => others.filter((r) => Date.parse(r.last_read_at) >= Date.parse(m.created_at)).length
  const isTeam = info?.kind === 'team'
  let lastDay = ''

  return (
    <div className="chat-page">
      <header className="chat-head">
        <button className="icon-btn" onClick={() => navigate('/messages')} aria-label="رجوع"><Icon name="back" /></button>
        <span className={`avatar${isTeam ? ' team' : ''}`}>{isTeam ? <Icon name="team" /> : (info?.title ?? '…').charAt(0)}</span>
        <span className="chat-main">
          <b>{info?.title ?? '…'}</b>
          <span>{isTeam ? 'رسالة واحدة تصل لكل الفريق' : isAdmin ? 'دردشة خاصة مع العامل' : 'دردشة خاصة مع المدير'}</span>
        </span>
      </header>

      <div className="msgs" ref={box} onScroll={onScroll}>
        {!msgs.length && <p className="muted center">ابدأ المحادثة: اكتب رسالة أو أرسل صورة.</p>}
        {msgs.map((m) => {
          const mine = m.sender_id === me
          const k = dayKey(m.created_at)
          const sep = k !== lastDay ? <div className="day">{dayLabel(k)}</div> : null
          lastDay = k
          const seen = mine ? seenBy(m) : 0
          const canDelete = mine || isAdmin
          const url = m.image_path ? urls.get(m.image_path) : undefined
          return (
            <div key={m.id} style={{ display: 'contents' }}>
              {sep}
              <div className={`msg${mine ? ' mine' : ''}`} onClick={() => canDelete && setPicked(picked === m.id ? null : m.id)}>
                {!mine && isTeam && <b className="who">{m.sender_name}</b>}
                {m.image_path && (
                  url ? <img src={url} alt="صورة" onClick={(e) => { e.stopPropagation(); setViewer(url) }} /> : <img alt="" />
                )}
                {m.body && <p>{m.body}</p>}
                <div className="meta">
                  {hm(m.created_at)}
                  {mine && (isTeam
                    ? <span className={seen ? 'seen' : ''}>{seen ? `قرأها ${seen}` : '✓'}</span>
                    : <span className={seen ? 'seen' : ''}>{seen ? '✓✓' : '✓'}</span>)}
                </div>
                {picked === m.id && (
                  <button className="link danger del" onClick={(e) => { e.stopPropagation(); remove(m) }}>حذف الرسالة</button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {error && <p className="error" style={{ margin: '0 10px 6px' }}>{error}</p>}
      <footer className="composer">
        <button className="icon-btn" onClick={() => fileInput.current?.click()} disabled={sending} aria-label="إرسال صورة"><Icon name="image" /></button>
        <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={(e) => sendImages(e.target.files)} />
        <textarea
          rows={1}
          placeholder="اكتب رسالة"
          value={text}
          onChange={(e) => { setText(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 130) + 'px' }}
          onKeyDown={onKey}
        />
        <button className="send" onClick={sendText} disabled={sending || !text.trim()} aria-label="إرسال">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 20l18-8L3 4l2.5 8L3 20z" /></svg>
        </button>
      </footer>

      {viewer && (
        <div className="viewer" onClick={() => setViewer(null)}>
          <img src={viewer} alt="" />
          <button className="icon-btn" aria-label="إغلاق"><Icon name="close" /></button>
        </div>
      )}
    </div>
  )
}
