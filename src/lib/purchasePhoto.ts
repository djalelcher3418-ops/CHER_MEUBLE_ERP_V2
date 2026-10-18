import { compressImage } from './chat'
import { supabase } from './supabase'

/** يحفظ صورة فاتورة المورد مع الشراء (ويحذف الصورة السابقة إن وُجدت) */
export async function savePurchasePhoto(purchaseId: number, file: File, previous?: string | null): Promise<string> {
  const blob = await compressImage(file, 2000, 0.85) // تبقى الكتابة مقروءة
  const path = `${purchaseId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`
  const up = await supabase.storage.from('purchases').upload(path, blob, { contentType: 'image/jpeg' })
  if (up.error) throw up.error
  const { error } = await supabase.from('purchases').update({ invoice_photo: path }).eq('id', purchaseId)
  if (error) {
    await supabase.storage.from('purchases').remove([path])
    throw error
  }
  if (previous) supabase.storage.from('purchases').remove([previous]).then(() => {})
  return path
}

export const removePurchasePhoto = (path: string) => supabase.storage.from('purchases').remove([path]).then(() => {})
