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
  if (msg.includes('Invalid login credentials')) return 'البريد أو كلمة المرور غير صحيحة'
  if (msg.includes('duplicate key') && msg.includes('barcode')) return 'هذا الباركود مستعمل لمادة أخرى'
  if (msg.includes('duplicate key')) return 'هذه القيمة موجودة من قبل'
  if (msg.includes('row-level security')) return 'ليست لديك صلاحية لهذه العملية'
  if (msg.includes('Failed to fetch')) return 'لا يوجد اتصال بالإنترنت'
  return msg
}
