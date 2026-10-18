// CHER MEUBLE — نسخة احتياطية كاملة (Supabase Edge Function)
//
// تحفظ كل جداول البرنامج في ملف JSON داخل المخزن الخاص «backups» (لا يراه إلا المدير)،
// وتُبقي آخر 12 نسخة فقط. يستدعيها التطبيق تلقائيًا مرة في الأسبوع عند دخول المدير،
// ويمكن جدولتها أيضًا من Supabase (Integrations → Cron) بالمفتاح السري للمشروع.
//
// الطلب (JSON):
//   { "if_older_than_days": 7 }  → نسخة جديدة فقط إن كانت آخر نسخة أقدم من 7 أيام
//   {}                           → نسخة الآن
//   { "action": "ping" }         → لصفحة حالة النظام

import { createClient } from 'npm:@supabase/supabase-js@2.49.4'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-backup-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

const BUCKET = 'backups'
const KEEP = 12
// بدون أسرار الخادم (push_config) واشتراكات الهواتف
const TABLES = [
  'profiles', 'customers', 'suppliers', 'material_categories', 'materials', 'stock_movements',
  'purchases', 'purchase_items', 'supplier_payments', 'orders', 'order_items', 'customer_payments',
  'order_events', 'order_photos', 'order_costs', 'order_material_plan', 'products', 'product_materials',
  'employees', 'absences', 'payroll_payments', 'employee_advances', 'expense_categories', 'expenses',
  'chats', 'messages', 'team_posts', 'team_post_comments', 'team_post_reactions', 'game_scores',
]

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method' }, 405)

  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const db = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

  // من يطلب؟ المدير من التطبيق، أو الجدولة بمفتاح الخادم أو بالسرّ BACKUP_SECRET
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const secret = Deno.env.get('BACKUP_SECRET')
  let allowed = token === serviceKey || (!!secret && req.headers.get('x-backup-secret') === secret)
  if (!allowed && token) {
    const { data: auth } = await db.auth.getUser(token)
    if (auth?.user) {
      const { data: me } = await db.from('profiles').select('role, active').eq('id', auth.user.id).maybeSingle()
      allowed = !!me?.active && me.role === 'admin'
    }
  }
  if (!allowed) return json({ error: 'النسخ الاحتياطية للمدير فقط' }, 403)

  const input = await req.json().catch(() => ({}))
  if (input.action === 'ping') return json({ ok: true })
  const { data: files, error: listError } = await db.storage.from(BUCKET).list('', { limit: 100, sortBy: { column: 'name', order: 'desc' } })
  if (listError) return json({ error: 'مخزن النسخ غير موجود. شغّل supabase/017_catalog_planning.sql أولًا.' }, 500)
  const backups = (files ?? []).filter((f) => f.name.endsWith('.json'))

  const days = Number(input.if_older_than_days)
  if (days > 0 && backups[0]) {
    const lastAt = Date.parse(backups[0].created_at ?? '')
    if (Number.isFinite(lastAt) && Date.now() - lastAt < days * 864e5) return json({ skipped: true, last: backups[0].name })
  }

  // كل جدول صفحةً صفحة (الخادم يعطي 1000 صف في المرة)
  const tables: Record<string, unknown[]> = {}
  const missing: string[] = []
  for (const t of TABLES) {
    const rows: unknown[] = []
    let failed = false
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from(t).select('*').order('id', { ascending: true, nullsFirst: true }).range(from, from + 999)
      // بعض الجداول بلا عمود id: نعيد بدون ترتيب
      const res = error && /column .*id/.test(error.message) ? await db.from(t).select('*').range(from, from + 999) : { data, error }
      if (res.error) { failed = true; break }
      rows.push(...(res.data ?? []))
      if (!res.data || res.data.length < 1000) break
    }
    if (failed) missing.push(t)
    else tables[t] = rows
  }

  const now = new Date()
  const stamp = now.toISOString().slice(0, 16).replace(/[:T]/g, '-')
  const name = `CHER-MEUBLE-${stamp}.json`
  const { data: ver } = await db.rpc('erp_schema_version')
  const body = JSON.stringify({ app: 'CHER MEUBLE ERP', created_at: now.toISOString(), schema_version: ver ?? null, tables })
  const up = await db.storage.from(BUCKET).upload(name, new Blob([body], { type: 'application/json' }), { contentType: 'application/json' })
  if (up.error) return json({ error: 'تعذّر حفظ النسخة: ' + up.error.message }, 500)

  // نحذف الأقدم ونُبقي آخر 12
  const old = backups.slice(KEEP - 1).map((f) => f.name)
  if (old.length) await db.storage.from(BUCKET).remove(old)

  const rows = Object.values(tables).reduce((a, r) => a + r.length, 0)
  return json({ ok: true, name, rows, tables: Object.keys(tables).length, missing })
})
