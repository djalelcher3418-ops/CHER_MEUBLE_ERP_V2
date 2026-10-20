// CHER MEUBLE — إدارة حسابات الدخول (Supabase Edge Function)
//
// للمدير فقط. يدخل العامل برقم هاتفه ورمز سري من 6 أرقام؛
// داخليًا يصبح الهاتف بريدًا من نوع 0555123456@cher-meuble.app
//
// الطلبات المقبولة (JSON):
//   { "action": "create", "full_name", "phone", "pin", "role": "worker"|"admin", "employee_id"? }
//   { "action": "reset_pin", "profile_id", "pin" }
//   { "action": "set_active", "profile_id", "active": true|false }

import { createClient } from 'npm:@supabase/supabase-js@2.49.4'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
const fail = (message: string, status = 400) => json({ error: message }, status)

const DOMAIN = 'cher-meuble.app'
const normPhone = (p: unknown) => {
  let d = String(p ?? '').replace(/\D/g, '')
  if (d.startsWith('00')) d = d.slice(2)
  if (d.startsWith('213')) d = '0' + d.slice(3)
  return d
}
const validPhone = (p: string) => /^0\d{9}$/.test(p)
const validPin = (p: unknown) => typeof p === 'string' && /^\d{6}$/.test(p)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return fail('method', 405)

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const { data: auth } = await db.auth.getUser(token)
  if (!auth?.user) return fail('unauthorized', 401)
  const { data: me } = await db.from('profiles').select('id, role, active').eq('id', auth.user.id).maybeSingle()
  if (!me?.active || me.role !== 'admin') return fail('هذه العملية للمدير فقط', 403)

  const input = await req.json().catch(() => ({}))

  if (input.action === 'create') {
    const name = String(input.full_name ?? '').trim()
    const phone = normPhone(input.phone)
    const role = input.role === 'admin' ? 'admin' : 'worker'
    if (!name) return fail('اكتب الاسم')
    if (!validPhone(phone)) return fail('رقم الهاتف غير صحيح (10 أرقام تبدأ بـ 0)')
    if (!validPin(input.pin)) return fail('الرمز السري يجب أن يكون 6 أرقام')

    const { data: created, error } = await db.auth.admin.createUser({
      email: `${phone}@${DOMAIN}`,
      password: input.pin,
      email_confirm: true,
      user_metadata: { full_name: name },
      app_metadata: { created_by_admin: true }, // لا يستطيع أحد غير الخادم وضع هذه العلامة
    })
    if (error || !created?.user) {
      const msg = String(error?.message ?? '')
      if (/already|registered|exists/i.test(msg)) return fail('هذا الرقم مسجّل من قبل')
      return fail('تعذّر إنشاء الحساب: ' + msg, 500)
    }
    const id = created.user.id
    // المشغّل handle_new_user ينشئ الملف الشخصي؛ نكمل الهاتف والدور
    const { error: pErr } = await db.from('profiles').update({ full_name: name, phone, role, active: true }).eq('id', id)
    if (pErr) {
      // لا نترك حسابًا ناقصًا: نحذفه حتى يمكن إعادة المحاولة بنفس الرقم
      await db.auth.admin.deleteUser(id).catch(() => {})
      return fail('تعذّر إنشاء الحساب: ' + pErr.message, 500)
    }
    if (input.employee_id) {
      await db.from('employees').update({ profile_id: id, phone }).eq('id', input.employee_id).is('profile_id', null)
    }
    return json({ id, login: phone })
  }

  const target = String(input.profile_id ?? '')
  if (!target) return fail('حساب غير محدد')
  if (target === me.id && input.action === 'set_active') return fail('لا يمكنك إيقاف حسابك أنت')

  if (input.action === 'reset_pin') {
    if (!validPin(input.pin)) return fail('الرمز السري يجب أن يكون 6 أرقام')
    const { error } = await db.auth.admin.updateUserById(target, { password: input.pin })
    if (error) return fail('تعذّر تغيير الرمز: ' + error.message, 500)
    // من كان داخلًا بالرمز القديم (هاتف ضائع مثلًا) يخرج (ملف 018)
    const { error: rErr } = await db.rpc('revoke_user_sessions', { p_user: target })
    return json({ ok: true, sessions_ended: !rErr })
  }

  if (input.action === 'set_active') {
    const active = input.active === true
    const { error } = await db.auth.admin.updateUserById(target, { ban_duration: active ? 'none' : '876000h' })
    if (error) return fail('تعذّر تغيير حالة الحساب: ' + error.message, 500)
    const { error: aErr } = await db.from('profiles').update({ active }).eq('id', target)
    if (aErr) {
      // نرجع الحظر كما كان حتى لا يختلف تسجيل الدخول عن حالة الحساب
      await db.auth.admin.updateUserById(target, { ban_duration: active ? '876000h' : 'none' }).catch(() => {})
      return fail('تعذّر تغيير حالة الحساب: ' + aErr.message, 500)
    }
    if (!active) {
      await db.from('push_subscriptions').delete().eq('profile_id', target)
      await db.rpc('revoke_user_sessions', { p_user: target })
    }
    return json({ ok: true })
  }

  return fail('bad request')
})
