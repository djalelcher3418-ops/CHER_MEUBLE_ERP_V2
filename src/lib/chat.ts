import { pushActive } from './push'
import { supabase } from './supabase'

export interface ChatSummary {
  chat_id: number
  kind: 'team' | 'worker'
  title: string
  last_text: string | null
  last_at: string | null
  unread: number
}

export interface Message {
  id: number
  chat_id: number
  sender_id: string | null
  sender_name: string | null
  body: string | null
  image_path: string | null
  created_at: string
}

export interface ChatRead {
  chat_id: number
  profile_id: string
  last_read_at: string
}

/** تصغير الصورة قبل الرفع (أقصى ضلع 1600 بكسل، JPEG) لتوفير الإنترنت والتخزين */
export function compressImage(file: File, max = 1600, quality = 0.75): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height))
      const c = document.createElement('canvas')
      c.width = Math.round(img.width * s)
      c.height = Math.round(img.height * s)
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
      URL.revokeObjectURL(url)
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('image'))), 'image/jpeg', quality)
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image')) }
    img.src = url
  })
}

/** يرفع الصورة إلى مجلد الدردشة ويعيد مسارها */
export async function uploadChatImage(chatId: number, file: File): Promise<string> {
  const blob = await compressImage(file)
  const path = `${chatId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`
  const { error } = await supabase.storage.from('chat').upload(path, blob, { contentType: 'image/jpeg' })
  if (error) throw error
  return path
}

const URL_TTL_S = 3600
const URL_REUSE_MS = 45 * 60 * 1000 // نجدّد الرابط قبل انتهاء صلاحيته
const urlCache = new Map<string, { url: string; at: number }>()
const fresh = (p: string) => {
  const c = urlCache.get(p)
  return c && Date.now() - c.at < URL_REUSE_MS ? c.url : undefined
}

/** روابط مؤقتة (ساعة) لعرض الصور الخاصة */
export async function signedUrls(paths: string[]): Promise<Map<string, string>> {
  const missing = paths.filter((p) => !fresh(p))
  if (missing.length) {
    const { data } = await supabase.storage.from('chat').createSignedUrls(missing, URL_TTL_S)
    const now = Date.now()
    for (const d of data ?? []) if (d.path && d.signedUrl) urlCache.set(d.path, { url: d.signedUrl, at: now })
  }
  const out = new Map<string, string>()
  for (const p of paths) {
    const u = fresh(p)
    if (u) out.set(p, u)
  }
  return out
}

/** مدة صلاحية روابط الصور المعروضة قبل طلب روابط جديدة */
export const IMAGE_URL_REFRESH_MS = URL_REUSE_MS

/** تنبيه على الهاتف عندما يكون التطبيق في الخلفية (بعد موافقة المستخدم) */
export async function notify(title: string, body: string) {
  if (pushActive()) return // الخادم يرسل التنبيه بنفسه
  if (!('Notification' in window) || Notification.permission !== 'granted' || document.visibilityState === 'visible') return
  try {
    const reg = await navigator.serviceWorker?.getRegistration()
    if (reg) await reg.showNotification(title, { body, tag: 'chat', icon: '/favicon.svg', badge: '/favicon.svg' })
    else new Notification(title, { body })
  } catch {
    /* المتصفح لا يدعم التنبيهات */
  }
}
