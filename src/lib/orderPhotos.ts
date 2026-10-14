import { compressImage } from './chat'
import { supabase } from './supabase'

export interface OrderPhoto {
  id: number
  order_id: number
  path: string
  caption: string | null
  created_by: string | null
  created_at: string
  url?: string
}

const BUCKET = 'orders'

/** صور طلبية أو عدة طلبيات، مع روابط مؤقتة للعرض */
export async function loadOrderPhotos(orderIds: number[]): Promise<OrderPhoto[]> {
  if (!orderIds.length) return []
  const { data, error } = await supabase.from('order_photos').select('*').in('order_id', orderIds).order('created_at')
  if (error) throw error
  const rows = (data as OrderPhoto[]) ?? []
  if (!rows.length) return rows
  const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrls(rows.map((r) => r.path), 3600)
  const byPath = new Map<string, string>()
  for (const s of signed ?? []) if (s.path && s.signedUrl) byPath.set(s.path, s.signedUrl)
  return rows.map((r) => ({ ...r, url: byPath.get(r.path) }))
}

/** يصغّر الصورة ويرفعها ثم يسجّلها للطلبية */
export async function addOrderPhoto(orderId: number, file: File, caption?: string) {
  const blob = await compressImage(file)
  const path = `${orderId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`
  const up = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg' })
  if (up.error) throw up.error
  const { error } = await supabase.from('order_photos').insert({ order_id: orderId, path, caption: caption?.trim() || null })
  if (error) {
    await supabase.storage.from(BUCKET).remove([path])
    throw error
  }
}

export async function deleteOrderPhoto(p: OrderPhoto) {
  const { error } = await supabase.from('order_photos').delete().eq('id', p.id)
  if (error) throw error
  await supabase.storage.from(BUCKET).remove([p.path])
}

/** رابط التتبع الذي يُرسل للزبون */
export const trackUrl = (token: string) => `${window.location.origin}/track/${token}`
