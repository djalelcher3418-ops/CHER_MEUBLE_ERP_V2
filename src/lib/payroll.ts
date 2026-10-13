// حساب الرواتب: فترة الأجر من يوم 15 إلى يوم 14 من الشهر الموالي (كما في تطبيق الفريق)
import type { Absence, Advance } from './types'

export const PERIOD_START_DAY = 15

export const MONTHS = ['جانفي', 'فيفري', 'مارس', 'أفريل', 'ماي', 'جوان', 'جويلية', 'أوت', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']
/** أيام الأسبوع تبدأ بالسبت */
export const WEEK = ['س', 'ح', 'ن', 'ث', 'ر', 'خ', 'ج']

const pad = (n: number) => String(n).padStart(2, '0')
export const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

export interface Period {
  start: Date
  end: Date
  from: string
  to: string
  days: Date[]
  label: string
}

/** الفترة الحالية (offset = 0) أو السابقة (-1) أو التالية (+1) */
export function periodRange(offset: number, now = new Date()): Period {
  let m = now.getMonth()
  if (now.getDate() < PERIOD_START_DAY) m -= 1
  m += offset
  const start = new Date(now.getFullYear(), m, PERIOD_START_DAY)
  const end = new Date(now.getFullYear(), m + 1, PERIOD_START_DAY - 1)
  const days: Date[] = []
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) days.push(new Date(d))
  return {
    start,
    end,
    from: ymd(start),
    to: ymd(end),
    days,
    label: `${start.getDate()} ${MONTHS[start.getMonth()]} إلى ${end.getDate()} ${MONTHS[end.getMonth()]} ${end.getFullYear()}`,
  }
}

export interface PaySummary {
  totalDays: number
  absentDays: number
  workedDays: number
  gross: number
  advances: number
  net: number
}

/** كل أيام الفترة تُحسب حضورًا إلا الغيابات المسجّلة (نصف يوم = 0.5) */
export function paySummary(p: Period, wage: number, absences: Absence[], advances: Advance[]): PaySummary {
  const absentDays = absences
    .filter((a) => a.day >= p.from && a.day <= p.to)
    .reduce((s, a) => s + (a.half_day ? 0.5 : 1), 0)
  const workedDays = p.days.length - absentDays
  const gross = workedDays * wage
  const adv = advances.filter((a) => a.given_on >= p.from && a.given_on <= p.to).reduce((s, a) => s + Number(a.amount), 0)
  return { totalDays: p.days.length, absentDays, workedDays, gross, advances: adv, net: gross - adv }
}

/** الشهر الحالي بصيغة YYYY-MM */
export const thisMonth = () => ymd(new Date()).slice(0, 7)

/** أول وآخر يوم من شهر YYYY-MM */
export function monthRange(month: string) {
  const [y, m] = month.split('-').map(Number)
  return { from: ymd(new Date(y, m - 1, 1)), to: ymd(new Date(y, m, 0)), label: `${MONTHS[m - 1]} ${y}` }
}
