import { dzd } from './supabase'
import type { OrderStatus } from './types'

/** رقم جزائري (0555… أو +213555…) → رابط واتساب برسالة جاهزة. null إن لم يوجد رقم صالح */
export function waLink(phone: string | null | undefined, text: string): string | null {
  let d = String(phone ?? '').replace(/\D/g, '')
  if (d.startsWith('00')) d = d.slice(2)
  if (d.startsWith('0')) d = '213' + d.slice(1)
  if (d.length < 11) return null
  return `https://wa.me/${d}?text=${encodeURIComponent(text)}`
}

/** نص رسالة للزبون حسب حالة الطلبية */
export function orderMessage(o: { id: number; title: string; customer_name: string; status: OrderStatus; due_date: string | null }, remaining: number): string {
  const rest = remaining > 0 ? `\nالباقي للدفع: ${dzd(remaining)}` : ''
  const head = `السلام عليكم ${o.customer_name}،`
  const sign = '\n\nCHER MEUBLE'
  switch (o.status) {
    case 'ready':
      return `${head}\nطلبيتكم رقم ${o.id} (${o.title}) جاهزة للاستلام.${rest}${sign}`
    case 'delivered':
      return `${head}\nشكرًا لثقتكم. تم تسليم طلبيتكم رقم ${o.id} (${o.title}).${rest}${sign}`
    case 'cancelled':
      return `${head}\nبخصوص طلبيتكم رقم ${o.id} (${o.title}).${sign}`
    default:
      return `${head}\nطلبيتكم رقم ${o.id} (${o.title}) قيد الإنجاز في الورشة${o.due_date ? `، وموعد التسليم المتوقع ${o.due_date}` : ''}.${rest}${sign}`
  }
}
