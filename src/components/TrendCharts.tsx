import { useState } from 'react'
import { dzd } from '../lib/supabase'

export interface MonthPoint {
  /** «أكتوبر» */
  label: string
  /** دفعات الزبائن */
  received: number
  /** موردون + رواتب + تسبيقات + مصاريف */
  spent: number
}

/** 150 ألف، 1.2 مليون — لمحور القيم */
const compact = (v: number) => {
  const a = Math.abs(v)
  const s = v < 0 ? '−' : ''
  if (a >= 1e6) return `${s}${+(a / 1e6).toFixed(1)} مليون`
  if (a >= 1e3) return `${s}${Math.round(a / 1e3)} ألف`
  return `${s}${Math.round(a)}`
}

/** حدّ أعلى «نظيف» للمحور: 1، 2، 2.5، 5 × 10ⁿ */
const niceMax = (v: number) => {
  if (v <= 0) return 1
  const p = 10 ** Math.floor(Math.log10(v))
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p
  return 10 * p
}

const W = 340
const H = 190
const PAD = { top: 22, bottom: 26, start: 54, end: 8 }

/**
 * رسمان منفصلان (لا محوران في رسم واحد):
 * 1) المقبوض والمصروف لكل شهر — عمودان متجاوران؛ المصروف مخطّط أيضًا حتى لا يعتمد التمييز على اللون وحده
 * 2) الصافي لكل شهر — من خط الصفر، الموجب أخضر والسالب برتقالي مخطّط بإشارة «−»
 * الأشهر من اليمين (الأقدم) إلى اليسار (الأحدث) كاتجاه القراءة.
 */
export default function TrendCharts({ data }: { data: MonthPoint[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const n = data.length
  if (!n) return null
  const plotW = W - PAD.start - PAD.end
  const band = plotW / n
  // RTL: الشهر الأول (الأقدم) في اليمين
  const bandX = (i: number) => PAD.start + (n - 1 - i) * band
  const last = n - 1

  // ----- الرسم 1 -----
  const max1 = niceMax(Math.max(...data.map((d) => Math.max(d.received, d.spent))))
  const plotH = H - PAD.top - PAD.bottom
  const y1 = (v: number) => PAD.top + plotH - (v / max1) * plotH
  const barW = Math.min(18, (band - 10) / 2)

  // ----- الرسم 2 -----
  const nets = data.map((d) => d.received - d.spent)
  const ext = niceMax(Math.max(1, ...nets.map(Math.abs)))
  const lo = Math.min(0, ...nets) < 0 ? -ext : 0
  const hi = Math.max(0, ...nets) > 0 ? ext : 0
  const span = hi - lo || 1
  const y2 = (v: number) => PAD.top + ((hi - v) / span) * plotH
  const netW = Math.min(24, band - 12)

  const tip = hover !== null && data[hover]

  /** عمود بطرف مستدير 4px وقاعدة مستقيمة على خط الأساس */
  const column = (x: number, yTop: number, yBase: number, w: number) => {
    const h = Math.abs(yBase - yTop)
    if (h < 0.5) return ''
    const r = Math.min(4, h, w / 2)
    if (yTop < yBase) // للأعلى
      return `M${x},${yBase} V${yTop + r} Q${x},${yTop} ${x + r},${yTop} H${x + w - r} Q${x + w},${yTop} ${x + w},${yTop + r} V${yBase} Z`
    return `M${x},${yBase} V${yTop - r} Q${x},${yTop} ${x + r},${yTop} H${x + w - r} Q${x + w},${yTop} ${x + w},${yTop - r} V${yBase} Z`
  }

  const hit = (i: number) => (
    <rect key={`hit-${i}`} x={bandX(i)} y={0} width={band} height={H} fill="transparent"
      onPointerEnter={() => setHover(i)} onPointerDown={() => setHover(i)} onPointerLeave={(e) => { if (e.pointerType === 'mouse') setHover(null) }}
      role="img" aria-label={`${data[i].label}: المقبوض ${dzd(data[i].received)}، المصروف ${dzd(data[i].spent)}، الصافي ${dzd(nets[i])}`} />
  )

  const axisLabels = (yOf: (v: number) => number, ticks: number[]) => ticks.map((t) => (
    <g key={t}>
      <line x1={PAD.start} x2={W - PAD.end} y1={yOf(t)} y2={yOf(t)} className="chart-grid" />
      <text x={PAD.start - 6} y={yOf(t) + 4} className="chart-tick" textAnchor="end">{compact(t)}</text>
    </g>
  ))

  const monthLabels = data.map((d, i) => (
    <text key={i} x={bandX(i) + band / 2} y={H - 8} className={`chart-tick${i === hover ? ' on' : ''}`} textAnchor="middle">{d.label}</text>
  ))

  return (
    <div className="charts">
      <svg width="0" height="0" aria-hidden="true" style={{ position: 'absolute' }}>
        <defs>
          <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" className="chart-hatch" />
          </pattern>
        </defs>
      </svg>

      <figure className="chart">
        <figcaption>
          <strong>المقبوض والمصروف</strong>
          <span className="chart-legend">
            <span><i className="key key-in" /> دفعات الزبائن</span>
            <span><i className="key key-out" /> المصروف (موردون، رواتب، مصاريف)</span>
          </span>
        </figcaption>
        <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" direction="ltr">
          {axisLabels(y1, [0, max1 / 2, max1])}
          {data.map((d, i) => {
            const cx = bandX(i) + band / 2
            const xIn = cx + 1 // في RTL: المقبوض يمين المصروف
            const xOut = cx - 1 - barW
            return (
              <g key={i} className={hover !== null && hover !== i ? 'dim' : ''}>
                <path d={column(xIn, y1(d.received), y1(0), barW)} className="bar-in" />
                <path d={column(xOut, y1(d.spent), y1(0), barW)} className="bar-out" />
                <path d={column(xOut, y1(d.spent), y1(0), barW)} fill="url(#hatch)" />
                {i === last && (
                  <>
                    {d.received > 0 && <text x={xIn + barW / 2} y={y1(d.received) - 5} className="chart-value" textAnchor="middle">{compact(d.received)}</text>}
                    {d.spent > 0 && <text x={xOut + barW / 2} y={y1(d.spent) - 5} className="chart-value" textAnchor="middle">{compact(d.spent)}</text>}
                  </>
                )}
              </g>
            )
          })}
          <line x1={PAD.start} x2={W - PAD.end} y1={y1(0)} y2={y1(0)} className="chart-base" />
          {monthLabels}
          {data.map((_, i) => hit(i))}
        </svg>
      </figure>

      <figure className="chart">
        <figcaption><strong>الصافي النقدي لكل شهر</strong><span className="muted">المقبوض ناقص المصروف</span></figcaption>
        <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" direction="ltr">
          {axisLabels(y2, Array.from(new Set([lo, (lo + hi) / 2, hi, 0])))}
          {nets.map((v, i) => {
            const x = bandX(i) + (band - netW) / 2
            const neg = v < 0
            return (
              <g key={i} className={hover !== null && hover !== i ? 'dim' : ''}>
                <path d={column(x, y2(v), y2(0), netW)} className={neg ? 'bar-out' : 'bar-in'} />
                {neg && <path d={column(x, y2(v), y2(0), netW)} fill="url(#hatch)" />}
                {i === last && v !== 0 && (
                  <text x={x + netW / 2} y={neg ? y2(v) + 14 : y2(v) - 5} className="chart-value" textAnchor="middle">{compact(v)}</text>
                )}
              </g>
            )
          })}
          <line x1={PAD.start} x2={W - PAD.end} y1={y2(0)} y2={y2(0)} className="chart-base" />
          {monthLabels}
          {data.map((_, i) => hit(i))}
        </svg>
      </figure>

      <p className="chart-tip" aria-live="polite">
        {tip
          ? <><strong>{tip.label}</strong>: المقبوض {dzd(tip.received)}، المصروف {dzd(tip.spent)}، الصافي <b className={tip.received - tip.spent < 0 ? 'neg' : 'pos'}>{dzd(tip.received - tip.spent)}</b></>
          : <span className="muted">المس شهرًا لترى أرقامه</span>}
      </p>

      <details className="chart-table">
        <summary>عرض الأرقام في جدول</summary>
        <div className="table-wrap">
          <table>
            <thead><tr><th>الشهر</th><th>المقبوض</th><th>المصروف</th><th>الصافي</th></tr></thead>
            <tbody>
              {data.map((d, i) => (
                <tr key={i}>
                  <td>{d.label}</td>
                  <td>{dzd(d.received)}</td>
                  <td>{dzd(d.spent)}</td>
                  <td className={nets[i] < 0 ? 'neg' : 'pos'}>{dzd(nets[i])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}
