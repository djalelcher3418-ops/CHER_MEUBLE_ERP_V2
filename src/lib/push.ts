import { supabase } from './supabase'

const FLAG = 'cm-push-on'

export const pushSupported = () =>
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

/** هل هذا الهاتف مسجّل لتنبيهات الخادم (تصل والتطبيق مغلق)؟ */
export function pushActive(): boolean {
  try { return localStorage.getItem(FLAG) === '1' } catch { return false }
}
function setActive(on: boolean) {
  try { localStorage.setItem(FLAG, on ? '1' : '0') } catch { /* تخزين غير متاح */ }
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4)
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

function swReady(ms = 8000): Promise<ServiceWorkerRegistration | null> {
  return Promise.race([navigator.serviceWorker.ready, new Promise<null>((r) => setTimeout(() => r(null), ms))])
}

export type PushResult = 'ok' | 'denied' | 'unsupported' | 'server'

/** يسجّل هذا الهاتف لتنبيهات الخادم. ask = طلب الإذن من المستخدم إن لم يُعطَ بعد */
export async function enablePush(ask = true): Promise<PushResult> {
  if (!pushSupported()) return 'unsupported'
  let perm = Notification.permission
  if (perm === 'default' && ask) perm = await Notification.requestPermission()
  if (perm !== 'granted') return 'denied'
  const reg = await swReady()
  if (!reg) return 'unsupported'
  const { data, error } = await supabase.functions.invoke('send-push', { body: { action: 'public-key' } })
  const publicKey = (data as { publicKey?: string } | null)?.publicKey
  if (error || !publicKey) { setActive(false); return 'server' }
  try {
    let sub = await reg.pushManager.getSubscription()
    const want = keyBytes(publicKey)
    const have = sub?.options.applicationServerKey ? new Uint8Array(sub.options.applicationServerKey) : null
    if (sub && have && (have.length !== want.length || have.some((b, i) => b !== want[i]))) {
      await sub.unsubscribe() // تغيّر مفتاح الخادم
      sub = null
    }
    sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: want })
    const j = sub.toJSON()
    const { error: saveErr } = await supabase.rpc('save_push_subscription', {
      p_endpoint: j.endpoint,
      p_p256dh: j.keys?.p256dh,
      p_auth: j.keys?.auth,
      p_user_agent: navigator.userAgent.slice(0, 200),
    })
    if (saveErr) { setActive(false); return 'server' }
    setActive(true)
    return 'ok'
  } catch {
    setActive(false)
    return 'server'
  }
}

/** عند تسجيل الخروج: هذا الهاتف لا يستقبل تنبيهات الحساب بعد الآن */
export async function forgetPush() {
  setActive(false)
  if (!pushSupported()) return
  try {
    const reg = await swReady(3000)
    const sub = await reg?.pushManager.getSubscription()
    if (sub) await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
  } catch { /* لا شيء */ }
}

/** يطلب من الخادم إرسال التنبيه (لا ننتظر النتيجة) */
export function sendPush(body: { message_id: number } | { order_id: number }) {
  supabase.functions.invoke('send-push', { body }).then(() => {}, () => {})
}
