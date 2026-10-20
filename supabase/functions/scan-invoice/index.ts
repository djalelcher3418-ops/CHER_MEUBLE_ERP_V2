// CHER MEUBLE — قراءة فاتورة من صورة (Supabase Edge Function)
//
// للمدير فقط. يرسل التطبيق صورة فاتورة (JPEG بصيغة base64)، فيقرؤها Gemini أو Claude
// (حسب المفتاح المضبوط) ويعيد المعلومات منظّمة: الطرف الآخر، التاريخ، رقم الفاتورة، الأسطر، والمجموع.
// لا يُحفظ شيء هنا: التطبيق يملأ النموذج والمدير يراجع ثم يحفظ بنفسه.
//
// يحتاج سرًّا واحدًا في Supabase → Edge Functions → Secrets، أحدهما:
//   GEMINI_API_KEY    = مفتاح Google من aistudio.google.com (يقرأ به Gemini)
//   ANTHROPIC_API_KEY = مفتاح من console.anthropic.com (يقرأ به Claude Opus 5.5)
// اختياري: GEMINI_MODEL لتغيير نموذج Gemini، و INVOICE_AI = claude لتفضيل Claude إن وُجد المفتاحان
//
// الطلب (JSON):
//   { "kind": "purchase" | "sale", "image": "<base64 jpeg>" }
//   { "action": "ping" } → { ok, key } لصفحة حالة النظام
//   purchase = فاتورة من مورد (مشتريات)، sale = فاتورة/طلب زبون (مبيعات)

import Anthropic from 'npm:@anthropic-ai/sdk@0.135.0'
import { createClient } from 'npm:@supabase/supabase-js@2.49.4'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
const fail = (message: string, status = 400, code?: string) => json({ error: message, code }, status)

const UNITS = ['piece', 'sheet', 'meter', 'm2', 'kg', 'liter', 'roll', 'box'] as const
const MAX_IMAGE_B64 = 6_900_000 // أقل من 5 ميغابايت بعد فك الترميز (حدّ الصورة عند Claude)

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: 'null' }] })

// شكل الجواب: Claude ملزَم به حرفيًا (structured outputs)
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['readable', 'party_name', 'party_phone', 'party_match', 'invoice_date', 'invoice_ref', 'lines', 'discount', 'total', 'note'],
  properties: {
    readable: { type: 'boolean', description: 'false إن لم تكن الصورة فاتورة أو كانت غير مقروءة' },
    party_name: nullable({ type: 'string' }),
    party_phone: nullable({ type: 'string' }),
    party_match: nullable({ type: 'string' }),
    invoice_date: nullable({ type: 'string', description: 'YYYY-MM-DD' }),
    invoice_ref: nullable({ type: 'string' }),
    lines: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['description', 'qty', 'unit', 'unit_price', 'line_total', 'match'],
        properties: {
          description: { type: 'string' },
          qty: nullable({ type: 'number' }),
          unit: nullable({ type: 'string', enum: [...UNITS] }),
          unit_price: nullable({ type: 'number' }),
          line_total: nullable({ type: 'number' }),
          match: nullable({ type: 'string' }),
        },
      },
    },
    discount: nullable({ type: 'number' }),
    total: nullable({ type: 'number' }),
    note: nullable({ type: 'string' }),
  },
}

interface Scan {
  readable: boolean
  party_name: string | null
  party_phone: string | null
  party_match: string | null
  invoice_date: string | null
  invoice_ref: string | null
  lines: { description: string; qty: number | null; unit: string | null; unit_price: number | null; line_total: number | null; match: string | null }[]
  discount: number | null
  total: number | null
  note: string | null
}

const SYSTEM = `You read photographed invoices for CHER MEUBLE, a furniture workshop in Algeria, and return their contents as data.
Invoices are usually in French or Arabic (sometimes both), handwritten or printed, with amounts in Algerian dinars (DA / DZD / دج).

Rules:
- Copy names and item descriptions as written on the invoice (keep the original language). Do not translate.
- Numbers: Algerian invoices write thousands with spaces or dots and decimals with a comma ("12 500,00" or "12.500,00" = 12500). Return plain numbers.
- Dates: convert to YYYY-MM-DD. Day comes before month (12/03/2026 = 2026-03-12).
- unit: map the line's unit to one of piece, sheet (plaque/panneau/لوح), meter (ml/m), m2, kg, liter, roll (rouleau), box (carton/boîte). Use null if none fits.
- If a value is missing or you cannot read it with confidence, use null rather than guessing. Never invent lines.
- party_match / match: only when the invoice clearly refers to one of the known names given in the request, return that known name exactly as listed; otherwise null.
- Put anything the reviewer should double-check (illegible parts, totals that don't add up, TVA/timbre lines) in note, in Arabic, one or two short sentences.
- readable is false only if the image is not an invoice/receipt/order or is too blurry to read; then return empty lines.`

const clip = (s: unknown, n: number) => (typeof s === 'string' && s.trim() ? s.trim().slice(0, n) : null)
const amount = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 1e12 ? Math.round(v * 1000) / 1000 : null)

/** ننظّف الجواب: أطوال معقولة، أرقام موجبة، ومطابقات من القوائم المعروفة فقط */
function clean(s: Scan, parties: string[], items: string[]): Scan {
  const inList = (v: unknown, list: string[]) => (typeof v === 'string' && list.includes(v) ? v : null)
  const date = typeof s.invoice_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.invoice_date) ? s.invoice_date : null
  return {
    readable: !!s.readable,
    party_name: clip(s.party_name, 120),
    party_phone: clip(s.party_phone, 30),
    party_match: inList(s.party_match, parties),
    invoice_date: date,
    invoice_ref: clip(s.invoice_ref, 60),
    lines: (Array.isArray(s.lines) ? s.lines : []).slice(0, 80).flatMap((l) => {
      const description = clip(l?.description, 200)
      if (!description) return []
      return [{
        description,
        qty: amount(l.qty),
        unit: (UNITS as readonly string[]).includes(String(l.unit)) ? String(l.unit) : null,
        unit_price: amount(l.unit_price),
        line_total: amount(l.line_total),
        match: inList(l.match, items),
      }]
    }),
    discount: amount(s.discount),
    total: amount(s.total),
    note: clip(s.note, 400),
  }
}

class ReadError extends Error {
  constructor(message: string, public status = 502, public code?: string) { super(message) }
}

/**
 * أيّ خدمة تقرأ الفاتورة؟
 * - Gemini إن وُجد GEMINI_API_KEY (أو GOOGLE_API_KEY)، أو وُضع مفتاح Google (يبدأ بـ AIza) في ANTHROPIC_API_KEY
 * - وإلا Claude بالمفتاح ANTHROPIC_API_KEY
 * - INVOICE_AI = gemini | claude يفرض الاختيار إن وُجد المفتاحان
 */
function provider(): { name: 'gemini' | 'claude'; key: string } | null {
  const anthropic = (Deno.env.get('ANTHROPIC_API_KEY') ?? '').trim()
  const google = (Deno.env.get('GEMINI_API_KEY') || Deno.env.get('GOOGLE_API_KEY') || '').trim() || (anthropic.startsWith('AIza') ? anthropic : '')
  const claude = anthropic && !anthropic.startsWith('AIza') ? anthropic : ''
  const want = (Deno.env.get('INVOICE_AI') ?? '').toLowerCase()
  if (want === 'claude' && claude) return { name: 'claude', key: claude }
  if (google) return { name: 'gemini', key: google }
  if (claude) return { name: 'claude', key: claude }
  return null
}

/** Claude Opus 5.5: صورة + structured outputs، مع بديل تلقائي عند الرفض */
async function readWithClaude(key: string, image: string, task: string): Promise<string> {
  const client = new Anthropic({ apiKey: key })
  const res = await client.beta.messages.create({
    model: 'claude-opus-5-5',
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
    system: SYSTEM,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image } },
        { type: 'text', text: task },
      ],
    }],
  })
  if (res.stop_reason === 'refusal') throw new ReadError('تعذّرت قراءة هذه الصورة. جرّب صورة أخرى أو أدخل الفاتورة يدويًا.', 422, 'refusal')
  if (res.stop_reason === 'max_tokens') throw new ReadError('الفاتورة طويلة جدًا لقراءتها مرة واحدة. صوّر جزءًا منها.', 422, 'too_long')
  const text = res.content.find((b) => b.type === 'text')
  if (!text || text.type !== 'text') throw new ReadError('لم يصل جواب مقروء. أعد المحاولة.')
  return text.text
}

// نفس شكل الجواب بصيغة Gemini (responseSchema: مجموعة OpenAPI، والقيمة الفارغة بـ nullable)
const g = (type: string, extra: Record<string, unknown> = {}) => ({ type, nullable: true, ...extra })
const GEMINI_SCHEMA = {
  type: 'OBJECT',
  required: ['readable', 'party_name', 'party_phone', 'party_match', 'invoice_date', 'invoice_ref', 'lines', 'discount', 'total', 'note'],
  propertyOrdering: ['readable', 'party_name', 'party_phone', 'party_match', 'invoice_date', 'invoice_ref', 'lines', 'discount', 'total', 'note'],
  properties: {
    readable: { type: 'BOOLEAN' },
    party_name: g('STRING'),
    party_phone: g('STRING'),
    party_match: g('STRING'),
    invoice_date: g('STRING', { description: 'YYYY-MM-DD' }),
    invoice_ref: g('STRING'),
    lines: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        required: ['description', 'qty', 'unit', 'unit_price', 'line_total', 'match'],
        propertyOrdering: ['description', 'qty', 'unit', 'unit_price', 'line_total', 'match'],
        properties: {
          description: { type: 'STRING' },
          qty: g('NUMBER'),
          unit: g('STRING', { format: 'enum', enum: [...UNITS] }),
          unit_price: g('NUMBER'),
          line_total: g('NUMBER'),
          match: g('STRING'),
        },
      },
    },
    discount: g('NUMBER'),
    total: g('NUMBER'),
    note: g('STRING'),
  },
}

/** Gemini: صورة + JSON مقيّد بالشكل. النموذج قابل للتغيير بالسرّ GEMINI_MODEL */
async function readWithGemini(key: string, image: string, task: string): Promise<string> {
  const model = (Deno.env.get('GEMINI_MODEL') ?? '').trim() || 'gemini-flash-latest'
  const base = (Deno.env.get('GEMINI_BASE_URL') ?? 'https://generativelanguage.googleapis.com').replace(/\/$/, '')
  let res: Response
  try {
    res = await fetch(`${base}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'image/jpeg', data: image } }, { text: task }] }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: GEMINI_SCHEMA, temperature: 0, maxOutputTokens: 16000 },
      }),
    })
  } catch {
    throw new ReadError('تعذّر الاتصال بخدمة Gemini. أعد المحاولة.')
  }
  const body = await res.json().catch(() => ({})) as {
    error?: { message?: string; status?: string }
    promptFeedback?: { blockReason?: string }
    candidates?: { finishReason?: string; content?: { parts?: { text?: string }[] } }[]
  }
  if (!res.ok) {
    const why = `${body.error?.status ?? ''} ${body.error?.message ?? ''}`
    if (/API_KEY_INVALID|API key not valid/i.test(why) || res.status === 401) throw new ReadError('مفتاح Gemini (GEMINI_API_KEY) غير صحيح.', 502, 'bad_key')
    if (res.status === 404) throw new ReadError(`نموذج Gemini «${model}» غير متاح. ضع اسم نموذج صحيح في السرّ GEMINI_MODEL (مثل gemini-flash-latest).`, 502, 'model')
    if (res.status === 429) throw new ReadError('انتهت الحصة المتاحة لمفتاح Gemini الآن. أعد المحاولة بعد قليل، أو فعّل الفوترة في Google AI Studio.', 429, 'rate')
    if (res.status === 403) throw new ReadError('مفتاح Gemini لا يملك صلاحية هذا الطلب. تحقق منه في Google AI Studio.', 502, 'denied')
    if (res.status === 400) throw new ReadError('تعذّر إرسال الصورة إلى Gemini. جرّب صورة أوضح.', 400, 'bad_request')
    throw new ReadError(`خدمة Gemini غير متاحة الآن (${res.status}). أعد المحاولة لاحقًا.`, 502, 'api')
  }
  const cand = body.candidates?.[0]
  if (body.promptFeedback?.blockReason || /SAFETY|PROHIBITED|BLOCKLIST|RECITATION/.test(cand?.finishReason ?? '')) {
    throw new ReadError('تعذّرت قراءة هذه الصورة. جرّب صورة أخرى أو أدخل الفاتورة يدويًا.', 422, 'refusal')
  }
  if (cand?.finishReason === 'MAX_TOKENS') throw new ReadError('الفاتورة طويلة جدًا لقراءتها مرة واحدة. صوّر جزءًا منها.', 422, 'too_long')
  const text = (cand?.content?.parts ?? []).map((p) => p.text ?? '').join('')
  if (!text.trim()) throw new ReadError('لم يصل جواب مقروء. أعد المحاولة.')
  return text
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return fail('method', 405)

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const { data: auth } = await db.auth.getUser(token)
  if (!auth?.user) return fail('unauthorized', 401)
  const { data: me } = await db.from('profiles').select('role, active').eq('id', auth.user.id).maybeSingle()
  if (!me?.active || me.role !== 'admin') return fail('قراءة الفواتير للمدير فقط', 403)

  const input = await req.json().catch(() => ({}))
  const ai = provider()
  // لصفحة «حالة النظام»: الدالة منشورة؟ والمفتاح مضبوط؟ وأيّ خدمة تقرأ؟
  if (input.action === 'ping') return json({ ok: true, key: !!ai, provider: ai?.name ?? null })
  if (!ai) {
    return fail('مفتاح القراءة غير مضبوط بعد. أضف GEMINI_API_KEY (أو ANTHROPIC_API_KEY) في Supabase → Edge Functions → Secrets.', 503, 'no_key')
  }

  const kind = input.kind === 'sale' ? 'sale' : 'purchase'
  const image = typeof input.image === 'string' ? input.image : ''
  if (!image || image.length > MAX_IMAGE_B64 || !/^[A-Za-z0-9+/=]+$/.test(image.slice(0, 200))) {
    return fail('الصورة غير صالحة أو كبيرة جدًا')
  }

  // الأسماء المعروفة تساعد النموذج على ربط الفاتورة بما هو موجود في البرنامج
  const [parties, items] = kind === 'purchase'
    ? await Promise.all([
        db.from('suppliers').select('name').eq('active', true).order('name').limit(500),
        db.from('materials').select('name').eq('active', true).order('name').limit(800),
      ])
    : [await db.from('customers').select('name').eq('active', true).order('name').limit(800), { data: [] }]
  const partyNames = ((parties.data ?? []) as { name: string }[]).map((r) => r.name)
  const itemNames = ((items.data ?? []) as { name: string }[]).map((r) => r.name)

  const task = kind === 'purchase'
    ? `This is a purchase invoice from a supplier to CHER MEUBLE. party = the supplier (the seller who issued it), never CHER MEUBLE itself.
Known suppliers: ${JSON.stringify(partyNames)}
Known materials (for each line's match): ${JSON.stringify(itemNames)}`
    : `This is a sales document (invoice, quote or order note) for a customer of CHER MEUBLE. party = the customer (the buyer), never CHER MEUBLE itself. Lines are furniture pieces; leave match null.
Known customers: ${JSON.stringify(partyNames)}`

  try {
    const raw = ai.name === 'gemini' ? await readWithGemini(ai.key, image, task) : await readWithClaude(ai.key, image, task)
    const scan = clean(JSON.parse(raw) as Scan, partyNames, itemNames)
    return json({ kind, ...scan })
  } catch (e) {
    if (e instanceof ReadError) return fail(e.message, e.status, e.code)
    if (e instanceof Anthropic.AuthenticationError) return fail('مفتاح Claude (ANTHROPIC_API_KEY) غير صحيح.', 502, 'bad_key')
    if (e instanceof Anthropic.PermissionDeniedError) return fail('حساب Claude لا يسمح بهذا الطلب. تحقق من الرصيد والصلاحيات في console.anthropic.com.', 502, 'denied')
    if (e instanceof Anthropic.RateLimitError) return fail('ضغط كبير الآن. أعد المحاولة بعد دقيقة.', 429, 'rate')
    if (e instanceof Anthropic.BadRequestError) return fail('تعذّر إرسال الصورة. جرّب صورة أوضح.', 400, 'bad_request')
    if (e instanceof Anthropic.APIError) return fail(`خدمة القراءة غير متاحة الآن (${e.status ?? '؟'}). أعد المحاولة لاحقًا.`, 502, 'api')
    if (e instanceof SyntaxError) return fail('وصل جواب غير مفهوم. أعد المحاولة.', 502)
    return fail('تعذّر الاتصال بخدمة القراءة. أعد المحاولة.', 502)
  }
})
