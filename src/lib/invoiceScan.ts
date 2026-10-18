import { compressImage } from './chat'
import { arabicError, supabase } from './supabase'
import type { Unit } from './types'

export type ScanKind = 'purchase' | 'sale'

/** ما قرأه Claude من صورة الفاتورة (يُراجَع قبل الحفظ) */
export interface InvoiceScan {
  kind: ScanKind
  readable: boolean
  party_name: string | null
  party_phone: string | null
  /** اسم مورد/زبون موجود في البرنامج إن تعرّف عليه */
  party_match: string | null
  invoice_date: string | null
  invoice_ref: string | null
  lines: {
    description: string
    qty: number | null
    unit: Unit | null
    unit_price: number | null
    line_total: number | null
    /** اسم مادة موجودة في البرنامج إن تعرّف عليها (المشتريات فقط) */
    match: string | null
  }[]
  discount: number | null
  total: number | null
  note: string | null
}

const toBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''))
    r.onerror = () => reject(new Error('image'))
    r.readAsDataURL(blob)
  })

async function functionError(error: unknown): Promise<string> {
  const ctx = (error as { context?: Response })?.context
  if (ctx && typeof ctx.json === 'function') {
    try {
      const body = await ctx.clone().json()
      if (body?.error) return String(body.error)
    } catch { /* ليس JSON */ }
    if (ctx.status === 404) return 'دالة scan-invoice غير منشورة بعد في Supabase. انظر README.'
  }
  const msg = arabicError(error)
  return /Failed to send|fetch/i.test(msg) ? 'تعذّر الوصول إلى دالة scan-invoice. تأكد أنها منشورة في Supabase.' : msg
}

/** يصغّر الصورة (مع إبقاء الكتابة واضحة) ثم يرسلها لدالة القراءة */
export async function scanInvoice(file: File, kind: ScanKind): Promise<InvoiceScan> {
  let blob: Blob
  try {
    blob = await compressImage(file, 2000, 0.85)
  } catch {
    throw new Error('هذا الملف ليس صورة يمكن قراءتها')
  }
  const image = await toBase64(blob)
  const { data, error } = await supabase.functions.invoke('scan-invoice', { body: { kind, image } })
  if (error) throw new Error(await functionError(error))
  const scan = data as InvoiceScan
  if (!scan.readable) throw new Error('لم نتمكن من قراءة فاتورة في هذه الصورة. صوّرها من قريب وبإضاءة جيدة، كاملةً ومستوية.')
  return scan
}

/** رقم الهاتف أرقامًا فقط بالصيغة المحلية: «+213 770 11 22 33» → «0770112233» */
export const phoneDigits = (p: string | null | undefined) => {
  let d = (p ?? '').replace(/\D/g, '')
  if (d.startsWith('00')) d = d.slice(2)
  if (d.startsWith('213')) d = '0' + d.slice(3)
  return d
}

/** سعر الوحدة: المكتوب، أو مجموع السطر ÷ الكمية */
export const linePrice = (l: InvoiceScan['lines'][number]) =>
  l.unit_price ?? (l.line_total != null && l.qty ? Math.round((l.line_total / l.qty) * 100) / 100 : null)
