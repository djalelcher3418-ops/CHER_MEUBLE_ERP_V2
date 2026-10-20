import { supabase } from './supabase'

export interface LastPrice {
  price: number
  date: string
}

/**
 * آخر سعر شراء لكل مادة (للمدير). من العرض material_last_price (ملف 019)،
 * وقبله من آخر 1000 سطر شراء مباشرة.
 */
export async function loadLastPrices(): Promise<Map<number, LastPrice>> {
  const out = new Map<number, LastPrice>()
  const v = await supabase.from('material_last_price').select('material_id, last_price, last_date')
  if (!v.error) {
    for (const r of v.data as { material_id: number; last_price: number; last_date: string }[]) {
      out.set(r.material_id, { price: Number(r.last_price), date: r.last_date })
    }
    return out
  }
  const { data } = await supabase
    .from('purchase_items')
    .select('material_id, unit_price, purchases(purchase_date)')
    .gt('unit_price', 0)
    .order('id', { ascending: false })
    .limit(1000)
  const rows = (data ?? []) as unknown as { material_id: number; unit_price: number; purchases: { purchase_date: string } | null }[]
  for (const r of rows) {
    const date = r.purchases?.purchase_date ?? ''
    const had = out.get(r.material_id)
    if (!had || date > had.date) out.set(r.material_id, { price: Number(r.unit_price), date })
  }
  return out
}
