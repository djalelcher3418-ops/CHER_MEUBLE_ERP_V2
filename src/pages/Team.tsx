import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import Icon from '../components/Icon'
import Modal from '../components/Modal'
import TeamNav from '../components/TeamNav'
import { useAuth } from '../lib/auth'
import { IMAGE_URL_REFRESH_MS, signedUrls } from '../lib/chat'
import { sendPush } from '../lib/push'
import { arabicError, supabase } from '../lib/supabase'
import { useUnreadCounts } from '../lib/useUnread'
import { REACTIONS, avatarStyle, initial, timeAgo, uploadTeamImage, type Member, type Post, type PostComment } from '../lib/team'

const PAGE = 30

/** صفحة «الفريق»: منشورات وصور وشكر الزملاء، مثل إنستغرام صغير خاص بالورشة */
export default function Team() {
  const { session, profile, isAdmin } = useAuth()
  const me = session!.user.id
  const [posts, setPosts] = useState<Post[] | null>(null)
  const [more, setMore] = useState(false)
  const [urls, setUrls] = useState<Map<string, string>>(new Map())
  const [viewer, setViewer] = useState<string | null>(null)
  const [open, setOpen] = useState<Post | null>(null)
  const [error, setError] = useState('')
  const count = useRef(PAGE)
  const { refresh: refreshBadge } = useUnreadCounts()

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('team_feed', { p_before: null, p_limit: Math.min(100, count.current) })
    if (error) return setError(error.message.includes('team_feed') ? 'شغّل ملف supabase/014_team_social.sql في Supabase أولًا.' : arabicError(error))
    const list = (data as Post[]) ?? []
    setPosts(list)
    setMore(list.length >= count.current)
    if (document.visibilityState === 'visible') supabase.rpc('mark_feed_seen').then(refreshBadge)
  }, [refreshBadge])

  useEffect(() => {
    load()
    // أي جديد (منشور، تفاعل، تعليق) يظهر فورًا؛ نجمع التحديثات المتقاربة في تحديث واحد
    let t: ReturnType<typeof setTimeout> | undefined
    const soon = () => { clearTimeout(t); t = setTimeout(load, 300) }
    const ch = supabase
      .channel('team-feed')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_posts' }, soon)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_post_reactions' }, soon)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_post_comments' }, soon)
      .subscribe()
    const onVisible = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearTimeout(t)
      document.removeEventListener('visibilitychange', onVisible)
      supabase.removeChannel(ch)
    }
  }, [load])

  async function loadMore() {
    const last = posts?.[posts.length - 1]
    if (!last) return
    const { data, error } = await supabase.rpc('team_feed', { p_before: last.id, p_limit: PAGE })
    if (error) return setError(arabicError(error))
    const older = (data as Post[]) ?? []
    count.current += older.length
    setPosts((p) => [...(p ?? []), ...older])
    setMore(older.length >= PAGE)
  }

  // روابط الصور (مرة لكل صورة، وتتجدّد قبل انتهاء صلاحيتها)
  const requested = useRef(new Set<string>())
  useEffect(() => {
    const paths = (posts ?? []).map((p) => p.image_path).filter((p): p is string => !!p && !requested.current.has(p))
    if (!paths.length) return
    paths.forEach((p) => requested.current.add(p))
    signedUrls(paths, 'team').then((got) => { if (got.size) setUrls((old) => new Map([...old, ...got])) })
  }, [posts, urls])
  useEffect(() => {
    const t = setInterval(() => { requested.current.clear(); setUrls(new Map()) }, IMAGE_URL_REFRESH_MS)
    return () => clearInterval(t)
  }, [])

  async function react(p: Post, emoji: string) {
    const mine = p.my_reactions.includes(emoji)
    // نغيّر الشاشة فورًا ثم نحفظ
    const patch = (x: Post): Post => x.id !== p.id ? x : {
      ...x,
      my_reactions: mine ? x.my_reactions.filter((e) => e !== emoji) : [...x.my_reactions, emoji],
      reactions: { ...x.reactions, [emoji]: Math.max(0, (x.reactions[emoji] ?? 0) + (mine ? -1 : 1)) },
    }
    setPosts((list) => list?.map(patch) ?? list)
    const { error } = mine
      ? await supabase.from('team_post_reactions').delete().match({ post_id: p.id, profile_id: me, emoji })
      : await supabase.from('team_post_reactions').insert({ post_id: p.id, emoji })
    if (error) { setError(arabicError(error)); load() }
  }

  async function remove(p: Post) {
    if (!confirm('حذف هذا المنشور؟')) return
    const { error } = await supabase.from('team_posts').delete().eq('id', p.id)
    if (error) return setError(arabicError(error))
    if (p.image_path) supabase.storage.from('team').remove([p.image_path]).then(() => {})
    setPosts((list) => list?.filter((x) => x.id !== p.id) ?? list)
  }

  return (
    <div className="team-page">
      <TeamNav />
      {error && <p className="error">{error}</p>}

      <Composer me={me} name={profile?.full_name ?? ''} onPosted={load} onError={setError} />

      {posts === null && !error && <p className="muted center">جارٍ التحميل…</p>}
      {posts?.length === 0 && (
        <div className="card center empty-feed">
          <div className="big-emoji">👋</div>
          <p>لا توجد منشورات بعد. كن أول من يكتب: صورة من الورشة، تحية صباحية، أو شكر لزميل.</p>
          <Link to="/games" className="btn secondary">أو جرّب الألعاب 🎮</Link>
        </div>
      )}

      {posts?.map((p) => (
        <article key={p.id} className={`card post post-${p.kind}`}>
          <header className="post-head">
            <span className="avatar" style={avatarStyle(p.author_id)}>{initial(p.author_name)}</span>
            <span className="chat-main">
              <b>{p.author_name ?? 'عضو سابق'}</b>
              <span>{timeAgo(p.created_at)}</span>
            </span>
            {(p.author_id === me || isAdmin) && (
              <button className="link muted" onClick={() => remove(p)} aria-label="حذف المنشور">حذف</button>
            )}
          </header>

          {p.kind === 'kudos' && (
            <div className="kudos-banner">
              <span className="big-emoji">🙏</span>
              <span><b>{p.author_name}</b> يشكر <b>{p.kudos_name}</b></span>
            </div>
          )}
          {p.kind === 'game' && <div className="game-banner">🏆 إنجاز في الألعاب</div>}

          {p.body && <p className="post-body">{p.body}</p>}
          {p.image_path && (
            <button type="button" className="post-img" onClick={() => setViewer(urls.get(p.image_path!) ?? null)}
              onDoubleClick={() => { if (!p.my_reactions.includes('❤️')) react(p, '❤️') }} aria-label="عرض الصورة">
              {urls.get(p.image_path) ? <img src={urls.get(p.image_path)} alt="" loading="lazy" /> : <span className="muted">…</span>}
            </button>
          )}

          <footer className="post-foot">
            <div className="reactions">
              {REACTIONS.map((e) => (
                <button key={e} type="button" className={`react${p.my_reactions.includes(e) ? ' on' : ''}`} onClick={() => react(p, e)}
                  aria-label={`تفاعل ${e}`} aria-pressed={p.my_reactions.includes(e)}>
                  {e}{p.reactions[e] ? <small>{p.reactions[e]}</small> : null}
                </button>
              ))}
            </div>
            <button type="button" className="link" onClick={() => setOpen(p)}>
              💬 {p.comments ? `${p.comments} تعليق` : 'علّق'}
            </button>
          </footer>
        </article>
      ))}

      {more && <button className="secondary big-btn" onClick={loadMore}>عرض المنشورات الأقدم</button>}

      {open && <Comments post={open} me={me} isAdmin={isAdmin} onClose={() => setOpen(null)} />}
      {viewer && (
        <div className="viewer" onClick={() => setViewer(null)}>
          <img src={viewer} alt="" />
          <button className="icon-btn" aria-label="إغلاق"><Icon name="close" /></button>
        </div>
      )}
    </div>
  )
}

/** كتابة منشور: نص، صورة، أو شكر زميل */
function Composer({ me, name, onPosted, onError }: { me: string; name: string; onPosted: () => void; onError: (e: string) => void }) {
  const [text, setText] = useState('')
  const [file, setFile] = useState<{ file: File; url: string } | null>(null)
  const [thanks, setThanks] = useState(false)
  const [mates, setMates] = useState<Member[]>([])
  const [to, setTo] = useState('')
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!thanks || mates.length) return
    supabase.rpc('team_members').then(({ data }) => setMates(((data as Member[]) ?? []).filter((m) => m.id !== me)))
  }, [thanks, mates.length, me])
  useEffect(() => () => { if (file) URL.revokeObjectURL(file.url) }, [file])

  async function submit(e: FormEvent) {
    e.preventDefault()
    const body = text.trim()
    if (thanks && !to) return onError('اختر الزميل الذي تشكره')
    if (!body && !file) return onError(thanks ? 'اكتب سبب الشكر' : 'اكتب شيئًا أو أضف صورة')
    setBusy(true)
    onError('')
    try {
      const image_path = file ? await uploadTeamImage(me, file.file) : null
      const row = { kind: thanks ? 'kudos' : 'post', body: body || null, image_path, kudos_to: thanks ? to : null }
      const { data, error } = await supabase.from('team_posts').insert(row).select('id').single()
      if (error) {
        if (image_path) supabase.storage.from('team').remove([image_path]).then(() => {})
        throw error
      }
      sendPush({ post_id: (data as { id: number }).id })
      setText('')
      setFile(null)
      setThanks(false)
      setTo('')
      onPosted()
    } catch (err) {
      onError(arabicError(err))
    }
    setBusy(false)
  }

  const first = name.trim().split(/\s+/)[0]
  return (
    <form className={`card composer${thanks ? ' thanks' : ''}`} onSubmit={submit}>
      <div className="composer-row">
        <span className="avatar" style={avatarStyle(me)}>{initial(name)}</span>
        <textarea rows={text ? 3 : 1} value={text} onChange={(e) => setText(e.target.value)} maxLength={2000}
          aria-label="نص المنشور"
          placeholder={thanks ? 'لماذا تشكره؟ (ساعدني في…)' : `بماذا تفكر يا ${first || 'صديقي'}؟`} />
      </div>
      {thanks && (
        <select value={to} onChange={(e) => setTo(e.target.value)} aria-label="الزميل">
          <option value="">— اختر الزميل —</option>
          {mates.map((m) => <option key={m.id} value={m.id}>{m.full_name}{m.role === 'admin' ? ' (المدير)' : ''}</option>)}
        </select>
      )}
      {file && (
        <div className="composer-img">
          <img src={file.url} alt="" />
          <button type="button" className="icon-btn" onClick={() => setFile(null)} aria-label="إزالة الصورة"><Icon name="close" /></button>
        </div>
      )}
      <div className="composer-actions">
        <button type="button" className="link" onClick={() => input.current?.click()}><Icon name="image" /> صورة</button>
        <button type="button" className={`link${thanks ? ' on' : ''}`} onClick={() => setThanks(!thanks)} aria-pressed={thanks}>🙏 شكر زميل</button>
        <button type="submit" disabled={busy}>{busy ? '…' : 'نشر'}</button>
      </div>
      <input ref={input} type="file" accept="image/*" hidden
        onChange={(e) => { const f = e.target.files?.[0]; if (f) setFile({ file: f, url: URL.createObjectURL(f) }); e.target.value = '' }} />
    </form>
  )
}

/** التعليقات على منشور */
function Comments({ post, me, isAdmin, onClose }: { post: Post; me: string; isAdmin: boolean; onClose: () => void }) {
  const [list, setList] = useState<PostComment[] | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    supabase.from('team_post_comments').select('*').eq('post_id', post.id).order('id').then(({ data, error }) => {
      if (error) setError(arabicError(error))
      setList((data as PostComment[]) ?? [])
    })
  }, [post.id])

  useEffect(() => {
    load()
    const ch = supabase
      .channel('comments-' + post.id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_post_comments', filter: `post_id=eq.${post.id}` }, load)
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [post.id, load])

  async function send(e: FormEvent) {
    e.preventDefault()
    const body = text.trim()
    if (!body) return
    setBusy(true)
    const { data, error } = await supabase.from('team_post_comments').insert({ post_id: post.id, body }).select('id').single()
    setBusy(false)
    if (error) return setError(arabicError(error))
    sendPush({ comment_id: (data as { id: number }).id })
    setText('')
    load()
  }

  async function remove(c: PostComment) {
    if (!confirm('حذف التعليق؟')) return
    const { error } = await supabase.from('team_post_comments').delete().eq('id', c.id)
    if (error) return setError(arabicError(error))
    load()
  }

  return (
    <Modal title="التعليقات" onClose={onClose}>
      {list === null ? <p className="muted">…</p> : (
        <ul className="comments">
          {list.map((c) => (
            <li key={c.id}>
              <span className="avatar" style={avatarStyle(c.author_id)}>{initial(c.author_name)}</span>
              <div className="comment-bubble">
                <b>{c.author_name ?? 'عضو سابق'}</b> <small className="muted">{timeAgo(c.created_at)}</small>
                <p>{c.body}</p>
                {(c.author_id === me || isAdmin) && <button className="link muted" onClick={() => remove(c)}>حذف</button>}
              </div>
            </li>
          ))}
          {!list.length && <li className="muted center">لا تعليقات بعد. كن الأول!</li>}
        </ul>
      )}
      {error && <p className="error">{error}</p>}
      <form className="scan-row" onSubmit={send}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="اكتب تعليقًا…" maxLength={1000} aria-label="تعليق" autoFocus />
        <button type="submit" disabled={busy || !text.trim()}>إرسال</button>
      </form>
    </Modal>
  )
}
