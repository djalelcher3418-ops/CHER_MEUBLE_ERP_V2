import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { sendPush } from '../lib/push'
import { arabicError, dzd, num, supabase, todayISO } from '../lib/supabase'
import { UNIT_LABELS, type Material, type MaterialNeed, type OrderCost, type OrderTotal, type Profile } from '../lib/types'

// أجزاء من تفاصيل الطلبية خاصة بالمدير (المرحلة 17). كل جزء يتجاهل خطأه إن لم يُشغَّل ملف 017 بعد.

/** ربح الطلبية: المواد المُخرجة + المتوقعة + التكاليف الإضافية */
export function ProfitPanel({ o, needs, onChanged }: { o: OrderTotal; needs: MaterialNeed[]; onChanged: () => void }) {
  const [costs, setCosts] = useState<OrderCost[] | null>(null)
  const [desc, setDesc] = useState('')
  const [adding, setAdding] = useState(false)
  const [amount, setAmount] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(() => {
    supabase.from('order_costs').select('*').eq('order_id', o.id).order('id').then(({ data, error }) => setCosts(error ? null : ((data as OrderCost[]) ?? [])))
  }, [o.id])
  useEffect(() => { load() }, [load])

  const revenue = Number(o.total)
  const materials = Number(o.material_cost)
  const extra = Number(o.extra_cost ?? 0)
  const delivered = o.status === 'delivered' || o.status === 'cancelled'
  const expectedLeft = delivered ? 0 : needs.reduce((a, n) => a + Number(n.remaining) * Number(n.avg_cost), 0)
  const profit = revenue - materials - extra
  const expected = profit - expectedLeft
  const pct = (v: number) => (revenue > 0 ? `${Math.round((v / revenue) * 100)}%` : '—')

  async function add(e: FormEvent) {
    e.preventDefault()
    if (!desc.trim() || !(Number(amount) > 0)) return setError('اكتب البيان والمبلغ')
    if (adding) return
    setAdding(true)
    const { error } = await supabase.from('order_costs').insert({ order_id: o.id, description: desc.trim(), amount: Number(amount), spent_on: todayISO() })
    setAdding(false)
    if (error) return setError(arabicError(error))
    setDesc('')
    setAmount('')
    setError('')
    load()
    onChanged()
  }

  async function remove(c: OrderCost) {
    if (!confirm(`حذف «${c.description}»؟`)) return
    const { error } = await supabase.from('order_costs').delete().eq('id', c.id)
    if (error) return setError(arabicError(error))
    load()
    onChanged()
  }

  return (
    <section className="profit">
      <h4>ربح الطلبية</h4>
      <div className="stats">
        <div className="stat"><span>المواد المُخرَجة</span><strong>{dzd(materials)}</strong></div>
        {extra > 0 && <div className="stat"><span>تكاليف أخرى</span><strong>{dzd(extra)}</strong></div>}
        <div className="stat"><span>الربح حتى الآن</span><strong className={profit < 0 ? 'neg' : 'pos'}>{dzd(profit)}</strong><small className="muted">{pct(profit)} من المبلغ</small></div>
        {expectedLeft > 0 && (
          <div className="stat"><span>الربح المتوقع بعد باقي المواد</span><strong className={expected < 0 ? 'neg' : 'pos'}>{dzd(expected)}</strong><small className="muted">{pct(expected)} (باقي المواد ≈ {dzd(expectedLeft)})</small></div>
        )}
      </div>
      <p className="muted">لا يشمل أجور العمّال والمصاريف العامة. أضف هنا ما صُرف لهذه الطلبية بالذات (نقل، عمل خارجي، قماش اشتُري لها…).</p>
      {costs !== null && (
        <>
          <ul className="list">
            {costs.map((c) => (
              <li key={c.id}>
                <span>{c.description} <small className="muted">{c.spent_on}</small></span>
                <span className="meta"><strong>{dzd(c.amount)}</strong><button type="button" className="link danger" onClick={() => remove(c)} aria-label={`حذف ${c.description}`}>✕</button></span>
              </li>
            ))}
          </ul>
          <form className="scan-row" onSubmit={add}>
            <input aria-label="بيان التكلفة" placeholder="تكلفة أخرى: نقل، تنجيد خارجي…" value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={120} />
            <input aria-label="مبلغ التكلفة" type="number" step="any" min="0" placeholder="المبلغ" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ maxWidth: 120 }} />
            <button type="submit" className="secondary" disabled={adding}>إضافة</button>
          </form>
        </>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  )
}

/** إسناد الطلبية لعامل: تظهر له في الورشة ويصله تنبيه */
export function AssignWorker({ o, onChanged }: { o: OrderTotal; onChanged: () => void }) {
  const [workers, setWorkers] = useState<Profile[]>([])
  const [error, setError] = useState('')
  useEffect(() => {
    supabase.from('profiles').select('*').eq('active', true).eq('role', 'worker').order('full_name')
      .then(({ data }) => setWorkers((data as Profile[]) ?? []))
  }, [])
  if (o.assigned_to === undefined) return null // قبل ملف 017

  async function assign(id: string) {
    const { error } = await supabase.from('orders').update({ assigned_to: id || null }).eq('id', o.id)
    if (error) return setError(arabicError(error))
    if (id) sendPush({ assigned_order_id: o.id })
    setError('')
    onChanged()
  }

  return (
    <div>
      <label>العامل المسؤول
        <select value={o.assigned_to ?? ''} onChange={(e) => assign(e.target.value)}>
          <option value="">— غير مُسندة —</option>
          {workers.map((w) => <option key={w.id} value={w.id}>{w.full_name}</option>)}
        </select>
      </label>
      {error && <p className="error">{error}</p>}
    </div>
  )
}

/** المواد اللازمة للطلبية: من مكوّنات منتجات الكتالوج + ما يُضاف يدويًا، مقارنة بالمخزون */
export function MaterialNeeds({ orderId, needs, short, onChanged }: { orderId: number; needs: MaterialNeed[]; short: Set<number>; onChanged: () => void }) {
  const [materials, setMaterials] = useState<Material[]>([])
  const [adding, setAdding] = useState(false)
  const [mat, setMat] = useState('')
  const [qty, setQty] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (adding && !materials.length) supabase.from('materials').select('*').eq('active', true).order('name').then(({ data }) => setMaterials((data as Material[]) ?? []))
  }, [adding, materials.length])

  async function add(e: FormEvent) {
    e.preventDefault()
    if (!mat || !(Number(qty) > 0)) return setError('اختر المادة واكتب الكمية')
    const { error } = await supabase.from('order_material_plan').upsert({ order_id: orderId, material_id: Number(mat), qty: Number(qty) })
    if (error) return setError(arabicError(error))
    setMat('')
    setQty('')
    setAdding(false)
    setError('')
    onChanged()
  }

  async function removeManual(n: MaterialNeed) {
    const { error } = await supabase.from('order_material_plan').delete().match({ order_id: orderId, material_id: n.material_id })
    if (error) return setError(arabicError(error))
    onChanged()
  }

  return (
    <section>
      <h4>المواد اللازمة</h4>
      {!needs.length && <p className="muted">لا توجد مواد محسوبة. اختر المنتجات من الكتالوج عند إنشاء الطلبية، أو أضف المواد يدويًا.</p>}
      {needs.length > 0 && (
        <ul className="list needs">
          {needs.map((n) => {
            const missing = Number(n.remaining) - Math.max(0, Number(n.stock))
            const state = Number(n.remaining) <= 0 ? 'done' : missing > 0 ? 'short' : short.has(n.material_id) ? 'tight' : 'ok'
            return (
              <li key={n.material_id} className={`need-${state}`}>
                <span>
                  <strong>{n.name}</strong>
                  <small className="muted">
                    اللازم {num(n.needed)} {UNIT_LABELS[n.unit]}، خرج {num(n.taken)}، المخزون {num(n.stock)}
                  </small>
                </span>
                <span className="meta">
                  <span className="need-state">
                    {state === 'done' ? 'اكتمل' : state === 'short' ? `ينقص ${num(missing)}` : state === 'tight' ? 'لا يكفي كل الطلبيات' : 'متوفر'}
                  </span>
                  {n.manual && <button type="button" className="link danger" onClick={() => removeManual(n)} aria-label={`حذف ${n.name} من المواد اللازمة`}>✕</button>}
                </span>
              </li>
            )
          })}
        </ul>
      )}
      {adding ? (
        <form className="scan-row" onSubmit={add}>
          <select aria-label="مادة لازمة" value={mat} onChange={(e) => setMat(e.target.value)}>
            <option value="">— المادة —</option>
            {materials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <input aria-label="الكمية اللازمة" type="number" step="any" min="0" placeholder="الكمية" value={qty} onChange={(e) => setQty(e.target.value)} style={{ maxWidth: 110 }} />
          <button type="submit" className="secondary">إضافة</button>
        </form>
      ) : (
        <button type="button" className="link" onClick={() => setAdding(true)}>+ إضافة مادة لازمة يدويًا</button>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  )
}
