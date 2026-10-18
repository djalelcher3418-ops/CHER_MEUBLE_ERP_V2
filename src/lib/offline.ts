import { supabase } from './supabase'

/** خطأ سببه انقطاع الإنترنت (وليس رفضًا من الخادم)؟ */
export function isOffline(e: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  const msg = String((e as { message?: string })?.message ?? e)
  return /Failed to fetch|NetworkError|Load failed|network|fetch failed/i.test(msg)
}

// ---------- نسخة محلية من القوائم (لفتح «إخراج مواد» بدون إنترنت) ----------
export function cacheSet(key: string, value: unknown) {
  try { localStorage.setItem('cm-cache-' + key, JSON.stringify(value)) } catch { /* ممتلئ أو ممنوع */ }
}
export function cacheGet<T>(key: string): T | null {
  try { return JSON.parse(localStorage.getItem('cm-cache-' + key) ?? 'null') as T | null } catch { return null }
}

// ---------- طابور حركات الإخراج غير المرسلة ----------
export interface PendingOut {
  client_ref: string
  material_id: number
  qty: number
  note: string | null
  order_id: number | null
  created_by: string
  at: string
  /** للعرض فقط */
  name: string
  unit_label: string
  /** رفض الخادم (مثلًا الطلبية لم تعد مفتوحة): يبقى للمراجعة */
  error?: string
}

const QUEUE = 'cm-out-queue'
const listeners = new Set<() => void>()

export function pendingOuts(): PendingOut[] {
  try { return JSON.parse(localStorage.getItem(QUEUE) ?? '[]') as PendingOut[] } catch { return [] }
}
function store(q: PendingOut[]) {
  try { localStorage.setItem(QUEUE, JSON.stringify(q)) } catch { /* */ }
  listeners.forEach((f) => f())
}
export function onQueueChange(f: () => void) {
  listeners.add(f)
  return () => { listeners.delete(f) }
}
export function enqueueOut(p: PendingOut) {
  store([...pendingOuts().filter((x) => x.client_ref !== p.client_ref), p])
}
export function dropOut(ref: string) {
  store(pendingOuts().filter((x) => x.client_ref !== ref))
}

/** رقم فريد للحركة: إن أُرسلت مرتين (انقطع الإنترنت بعد الحفظ) تُسجَّل مرة واحدة */
export const newRef = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 3) | 8).toString(16) })

/** يرسل حركة إخراج واحدة. يعيد null عند النجاح، أو الخطأ */
export async function sendOut(p: Omit<PendingOut, 'name' | 'unit_label' | 'at' | 'error'>): Promise<unknown> {
  const row = { material_id: p.material_id, type: 'out', qty: p.qty, note: p.note, order_id: p.order_id, created_by: p.created_by, client_ref: p.client_ref }
  const { error } = await supabase.from('stock_movements').upsert(row, { onConflict: 'client_ref', ignoreDuplicates: true })
  // قبل ملف 017 لا يوجد العمود client_ref: نرسل بدونه
  if (error && /client_ref|ON CONFLICT|no unique/i.test(error.message)) {
    const { client_ref: _ref, ...plain } = row
    void _ref
    return (await supabase.from('stock_movements').insert(plain)).error
  }
  return error
}

let syncing = false
/** يرسل ما في الطابور عند عودة الإنترنت. يعيد عدد ما أُرسل */
export async function syncOuts(): Promise<number> {
  if (syncing || (typeof navigator !== 'undefined' && navigator.onLine === false)) return 0
  syncing = true
  let sent = 0
  try {
    for (const p of pendingOuts().filter((x) => !x.error)) {
      const err = await sendOut(p)
      if (!err) { dropOut(p.client_ref); sent++; continue }
      if (isOffline(err)) break
      store(pendingOuts().map((x) => (x.client_ref === p.client_ref ? { ...x, error: String((err as { message?: string }).message ?? err) } : x)))
    }
  } finally {
    syncing = false
  }
  return sent
}
