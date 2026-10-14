import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const configMissing = !url || !key

export const supabase = createClient(url ?? 'http://localhost', key ?? 'missing')

/** تنسيق المبالغ بالدينار الجزائري */
export const dzd = (n: number | null | undefined) =>
  `${Number(n ?? 0).toLocaleString('fr-DZ', { maximumFractionDigits: 2 })} دج`

/** تنسيق الكميات */
export const num = (n: number | null | undefined) =>
  Number(n ?? 0).toLocaleString('fr-DZ', { maximumFractionDigits: 3 })

/** رسالة خطأ مفهومة بالعربية */
export function arabicError(e: unknown): string {
  const msg = (e as { message?: string })?.message ?? String(e)
  if (msg.includes('Invalid login credentials')) return 'رقم الهاتف (أو البريد) أو الرمز السري غير صحيح'
  if (msg.includes('banned')) return 'هذا الحساب موقوف. اتصل بالمدير.'
  if (msg.includes('Password should be')) return 'الرمز السري قصير أو ضعيف'
  if (msg.includes('duplicate key') && msg.includes('barcode')) return 'هذا الباركود مستعمل لمادة أخرى'
  if (msg.includes('duplicate key')) return 'هذه القيمة موجودة من قبل'
  if (msg.includes('foreign key')) return 'لا يمكن الحذف لأنه مرتبط بسجلات أخرى'
  if (msg.includes('row-level security')) return 'ليست لديك صلاحية لهذه العملية'
  if (msg.includes('Failed to fetch')) return 'لا يوجد اتصال بالإنترنت'
  return msg
}

/** تاريخ اليوم بالتوقيت المحلي بصيغة YYYY-MM-DD */
export function todayISO(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** تاريخ ووقت بصيغة 13/10/2026 22:44 */
export function dateTime(ts: string | number | Date): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`
}
