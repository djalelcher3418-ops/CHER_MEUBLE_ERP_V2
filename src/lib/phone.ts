// الدخول برقم الهاتف: الرقم يصبح بريدًا داخليًا 0555123456@cher-meuble.app

export const PHONE_DOMAIN = 'cher-meuble.app'

/** 0555 12 34 56 أو +213555123456 → 0555123456 */
export function normPhone(p: string | null | undefined): string {
  let d = String(p ?? '').replace(/\D/g, '')
  if (d.startsWith('00')) d = d.slice(2)
  if (d.startsWith('213')) d = '0' + d.slice(3)
  return d
}

export const validPhone = (p: string) => /^0\d{9}$/.test(normPhone(p))
export const validPin = (p: string) => /^\d{6}$/.test(p)

/** ما يكتبه المستخدم في خانة الدخول: بريد كما هو، أو رقم هاتف */
export function loginEmail(input: string): string {
  const v = input.trim()
  return v.includes('@') ? v : `${normPhone(v)}@${PHONE_DOMAIN}`
}

/** رمز سري عشوائي من 6 أرقام */
export function randomPin(): string {
  const a = new Uint32Array(1)
  crypto.getRandomValues(a)
  return String(100000 + (a[0] % 900000))
}
