import { compressImage } from './chat'
import { supabase } from './supabase'

/** رابط صورة المنتج (المخزن عام للقراءة حتى تظهر في كتالوج الزبائن) */
export const productPhotoUrl = (path: string | null | undefined) =>
  path ? supabase.storage.from('products').getPublicUrl(path).data.publicUrl : null

/** يرفع صورة المنتج ويعيد مسارها */
export async function uploadProductPhoto(productId: number, file: File): Promise<string> {
  const blob = await compressImage(file, 1600, 0.82)
  const path = `${productId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`
  const { error } = await supabase.storage.from('products').upload(path, blob, { contentType: 'image/jpeg' })
  if (error) throw error
  return path
}

/** رابط صفحة الكتالوج العامة للزبائن */
export const catalogUrl = () => `${location.origin}/catalogue`
