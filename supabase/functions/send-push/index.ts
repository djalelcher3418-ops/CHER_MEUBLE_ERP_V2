// CHER MEUBLE — دالة إرسال التنبيهات (Supabase Edge Function)
//
// يستدعيها التطبيق بعد إرسال رسالة أو بعد أن تصبح طلبية جاهزة.
// تتأكد أن المستدعي هو صاحب الحدث، ثم ترسل تنبيهًا لهواتف المعنيين فقط.
// مفاتيح VAPID تُنشأ تلقائيًا أول مرة وتُحفظ في الجدول push_config.
//
// الطلبات المقبولة (JSON):
//   { "action": "public-key" }  → المفتاح العام لتسجيل الهاتف
//   { "message_id": 123 }       → تنبيه برسالة جديدة لأعضاء الدردشة
//   { "order_id": 45 }          → تنبيه للمدير بأن طلبية بدأت أو أصبحت جاهزة
//   { "post_id": 7 }            → منشور جديد في صفحة الفريق (أو شكر زميل) لكل الفريق
//   { "comment_id": 9 }         → تعليق جديد لصاحب المنشور

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.49.4'
import webpush from 'npm:web-push@3.6.7'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

interface Payload {
  title: string
  body: string
  url: string
  tag: string
}

/** يقرأ مفاتيح VAPID أو ينشئها أول مرة */
async function vapidKeys(db: SupabaseClient): Promise<{ public_key: string; private_key: string }> {
  const { data } = await db.from('push_config').select('public_key, private_key').eq('id', 1).maybeSingle()
  if (data) return data
  const k = webpush.generateVAPIDKeys()
  await db.from('push_config').upsert({ id: 1, public_key: k.publicKey, private_key: k.privateKey }, { onConflict: 'id', ignoreDuplicates: true })
  const again = await db.from('push_config').select('public_key, private_key').eq('id', 1).single()
  if (again.error) throw again.error
  return again.data
}

const RECENT_MS = 10 * 60 * 1000 // لا نرسل تنبيهًا لحدث أقدم من 10 دقائق

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method' }, 405)

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })

  // من يستدعي الدالة؟
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const { data: auth } = await db.auth.getUser(token)
  if (!auth?.user) return json({ error: 'unauthorized' }, 401)
  const { data: me } = await db.from('profiles').select('id, full_name, role, active').eq('id', auth.user.id).maybeSingle()
  if (!me?.active) return json({ error: 'forbidden' }, 403)

  const keys = await vapidKeys(db)
  const input = await req.json().catch(() => ({}))

  if (input.action === 'public-key') return json({ publicKey: keys.public_key })

  const { data: people } = await db.from('profiles').select('id, role').eq('active', true)
  const active = people ?? []
  let recipients: string[] = []
  let payload: Payload

  if (input.message_id) {
    const { data: m } = await db
      .from('messages')
      .select('id, chat_id, sender_id, sender_name, body, created_at, chats(kind, worker_id)')
      .eq('id', input.message_id)
      .maybeSingle()
    const chat = (m?.chats ?? null) as { kind: string; worker_id: string | null } | null
    if (!m || !chat || m.sender_id !== me.id) return json({ error: 'not your message' }, 403)
    if (Date.now() - Date.parse(m.created_at) > RECENT_MS) return json({ sent: 0, reason: 'old' })
    recipients = active
      .filter((p) => p.id !== me.id && (chat.kind === 'team' || p.role === 'admin' || p.id === chat.worker_id))
      .map((p) => p.id)
    const text = (m.body ?? '').trim()
    payload = {
      title: chat.kind === 'team' ? `${m.sender_name} · كل الفريق` : (m.sender_name ?? 'رسالة جديدة'),
      body: text ? (text.length > 140 ? text.slice(0, 140) + '…' : text) : '📷 صورة',
      url: `/messages/${m.chat_id}`,
      tag: `chat-${m.chat_id}`,
    }
  } else if (input.order_id) {
    const { data: o } = await db.from('orders').select('id, title, status').eq('id', input.order_id).maybeSingle()
    const { data: ev } = await db
      .from('order_events')
      .select('status, created_by, created_at')
      .eq('order_id', input.order_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!o || !ev || ev.created_by !== me.id || ev.status !== o.status) return json({ error: 'not your change' }, 403)
    if (!['in_production', 'ready'].includes(o.status)) return json({ sent: 0, reason: 'status' })
    if (Date.now() - Date.parse(ev.created_at) > RECENT_MS) return json({ sent: 0, reason: 'old' })
    recipients = active.filter((p) => p.role === 'admin' && p.id !== me.id).map((p) => p.id)
    payload = {
      title: o.status === 'ready' ? '✓ طلبية جاهزة' : 'بدأ العمل على طلبية',
      body: `${o.id} — ${o.title} (${me.full_name})`,
      url: `/orders?open=${o.id}`,
      tag: `order-${o.id}`,
    }
  } else if (input.post_id) {
    const { data: p } = await db
      .from('team_posts')
      .select('id, kind, author_id, author_name, body, kudos_to, kudos_name, created_at')
      .eq('id', input.post_id)
      .maybeSingle()
    if (!p || p.author_id !== me.id) return json({ error: 'not your post' }, 403)
    if (Date.now() - Date.parse(p.created_at) > RECENT_MS) return json({ sent: 0, reason: 'old' })
    recipients = active.filter((x) => x.id !== me.id).map((x) => x.id)
    const text = (p.body ?? '').trim()
    payload = {
      title: p.kind === 'kudos' ? `🙏 ${p.author_name} يشكر ${p.kudos_name}` : `📣 ${p.author_name} نشر في الفريق`,
      body: text ? (text.length > 140 ? text.slice(0, 140) + '…' : text) : '📷 صورة',
      url: '/team',
      tag: `post-${p.id}`,
    }
  } else if (input.comment_id) {
    const { data: c } = await db
      .from('team_post_comments')
      .select('id, author_id, author_name, body, created_at, team_posts(author_id)')
      .eq('id', input.comment_id)
      .maybeSingle()
    const post = (c?.team_posts ?? null) as { author_id: string | null } | null
    if (!c || c.author_id !== me.id) return json({ error: 'not your comment' }, 403)
    if (Date.now() - Date.parse(c.created_at) > RECENT_MS) return json({ sent: 0, reason: 'old' })
    recipients = active.filter((x) => x.id !== me.id && x.id === post?.author_id).map((x) => x.id)
    const text = c.body.trim()
    payload = {
      title: `💬 ${c.author_name} علّق على منشورك`,
      body: text.length > 140 ? text.slice(0, 140) + '…' : text,
      url: '/team',
      tag: `comment-${c.id}`,
    }
  } else {
    return json({ error: 'bad request' }, 400)
  }

  if (!recipients.length) return json({ sent: 0 })
  const { data: subs } = await db.from('push_subscriptions').select('id, endpoint, p256dh, auth').in('profile_id', recipients)

  webpush.setVapidDetails('https://cher-meuble-erp-v2.pages.dev', keys.public_key, keys.private_key)
  const body = JSON.stringify(payload)
  const dead: number[] = []
  let sent = 0
  await Promise.all(
    (subs ?? []).map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, { TTL: 60 * 60 * 24, urgency: 'high' })
        sent++
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode
        if (code === 404 || code === 410) dead.push(s.id) // الهاتف ألغى الاشتراك
      }
    }),
  )
  if (dead.length) await db.from('push_subscriptions').delete().in('id', dead)
  return json({ sent, removed: dead.length })
})
