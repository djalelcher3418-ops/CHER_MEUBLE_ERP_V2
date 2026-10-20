import { useEffect, useRef, useState, type FormEvent } from 'react'
import Icon from '../components/Icon'
import Modal from '../components/Modal'
import { catalogUrl, productPhotoUrl, uploadProductPhoto } from '../lib/catalog'
import { arabicError, dzd, num, supabase } from '../lib/supabase'
import { BED_SIZES, UNIT_LABELS, type Material, type Product, type ProductMaterial } from '../lib/types'

type Recipe = { material_id: string; qty: string }
type Draft = {
  id?: number
  name: string
  description: string
  price: string
  size: string
  fabric: string
  legs: string
  public: boolean
  photo_path: string | null
  recipe: Recipe[]
}
const emptyDraft: Draft = { name: '', description: '', price: '', size: '', fabric: '', legs: '', public: true, photo_path: null, recipe: [] }

/** الكتالوج: منتجات الورشة بصورها وأسعارها ومكوّناتها من المواد */
export default function Catalog() {
  const [products, setProducts] = useState<Product[]>([])
  const [recipes, setRecipes] = useState<ProductMaterial[]>([])
  const [materials, setMaterials] = useState<Material[]>([])
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  async function load() {
    const [p, r, m] = await Promise.all([
      supabase.from('products').select('*').eq('active', true).order('name'),
      supabase.from('product_materials').select('*'),
      supabase.from('materials').select('*').eq('active', true).order('name'),
    ])
    if (p.error) setError(p.error.message.includes('products') ? 'شغّل ملف supabase/017_catalog_planning.sql في Supabase أولًا.' : arabicError(p.error))
    setProducts((p.data as Product[]) ?? [])
    setRecipes((r.data as ProductMaterial[]) ?? [])
    setMaterials((m.data as Material[]) ?? [])
  }
  useEffect(() => { load() }, [])

  /** تكلفة المواد لقطعة واحدة حسب متوسط سعر الشراء */
  const costOf = (productId: number) =>
    recipes.filter((r) => r.product_id === productId)
      .reduce((a, r) => a + Number(r.qty) * Number(materials.find((m) => m.id === r.material_id)?.avg_cost ?? 0), 0)

  function edit(p: Product) {
    setDraft({
      id: p.id, name: p.name, description: p.description ?? '', price: String(p.price), size: p.size ?? '',
      fabric: p.fabric ?? '', legs: p.legs ?? '', public: p.public, photo_path: p.photo_path,
      recipe: recipes.filter((r) => r.product_id === p.id).map((r) => ({ material_id: String(r.material_id), qty: String(r.qty) })),
    })
  }

  async function archive(p: Product) {
    if (!confirm(`إخفاء «${p.name}» من الكتالوج؟ (الطلبيات القديمة لا تتأثر)`)) return
    const { error } = await supabase.from('products').update({ active: false }).eq('id', p.id)
    if (error) return setError(arabicError(error))
    load()
  }

  async function share() {
    const url = catalogUrl()
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { prompt('انسخ الرابط:', url) }
  }

  return (
    <div>
      <div className="page-head">
        <h2>الكتالوج</h2>
        <button onClick={() => setDraft({ ...emptyDraft })}>+ منتج جديد</button>
      </div>
      {error && <p className="error">{error}</p>}

      <div className="card share-row">
        <span>
          <strong>كتالوج الزبائن</strong>
          <small className="muted">صفحة بصور المنتجات وأسعارها، بدون حساب. أرسلها للزبون.</small>
        </span>
        <div className="toolbar">
          <a className="btn wa" href={`https://wa.me/?text=${encodeURIComponent(`كتالوج CHER MEUBLE: ${catalogUrl()}`)}`} target="_blank" rel="noreferrer">واتساب</a>
          <button className="secondary" onClick={share}>{copied ? 'نُسخ ✓' : 'نسخ الرابط'}</button>
          <a className="btn secondary-link" href="/catalogue" target="_blank" rel="noreferrer">فتح</a>
        </div>
      </div>

      {!products.length && !error && (
        <div className="card center">
          <p>لا توجد منتجات بعد. أضف أسرّتك وأرائكك المعتادة بصورها وأسعارها، ثم اخترها بضغطة عند إنشاء الطلبية.</p>
        </div>
      )}

      <div className="products">
        {products.map((p) => {
          const cost = costOf(p.id)
          const url = productPhotoUrl(p.photo_path)
          return (
            <article key={p.id} className="card product">
              <div className="product-photo">{url ? <img src={url} alt={p.name} loading="lazy" /> : <Icon name="image" />}</div>
              <div className="product-body">
                <h3>{p.name}</h3>
                <div className="line-tags">
                  {p.size && <span className="size-tag">{p.size}</span>}
                  {p.fabric && <span className="spec-tag">قماش: {p.fabric}</span>}
                  {p.legs && <span className="spec-tag">أرجل: {p.legs}</span>}
                  {!p.public && <span className="spec-tag">مخفي عن الزبائن</span>}
                </div>
                <p className="product-price">{dzd(p.price)}</p>
                {cost > 0 && (
                  <small className="muted">
                    مواد القطعة ≈ {dzd(cost)}، الهامش ≈ {Number(p.price) > 0 ? Math.round(((Number(p.price) - cost) / Number(p.price)) * 100) : 0}%
                  </small>
                )}
                <div className="toolbar">
                  <button className="secondary" onClick={() => edit(p)}>تعديل</button>
                  <button className="link danger" onClick={() => archive(p)}>إخفاء</button>
                </div>
              </div>
            </article>
          )
        })}
      </div>

      {draft && <ProductForm draft={draft} materials={materials} onClose={() => setDraft(null)} onDone={() => { setDraft(null); load() }} />}
    </div>
  )
}

function ProductForm({ draft: initial, materials, onClose, onDone }: { draft: Draft; materials: Material[]; onClose: () => void; onDone: () => void }) {
  const [d, setD] = useState(initial)
  const [photo, setPhoto] = useState<{ file: File; url: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.url) }, [photo])
  // رقم المنتج بعد أول حفظ: إعادة «حفظ» بعد خطأ (مكوّنات/صورة) تعدّله ولا تنشئ منتجًا ثانيًا
  const savedId = useRef(initial.id)

  const set = (patch: Partial<Draft>) => setD({ ...d, ...patch })
  const setRecipe = (i: number, patch: Partial<Recipe>) => set({ recipe: d.recipe.map((r, k) => (k === i ? { ...r, ...patch } : r)) })
  const cost = d.recipe.reduce((a, r) => a + (Number(r.qty) || 0) * Number(materials.find((m) => String(m.id) === r.material_id)?.avg_cost ?? 0), 0)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!d.name.trim()) return setError('اكتب اسم المنتج')
    const recipe = d.recipe.filter((r) => r.material_id && Number(r.qty) > 0)
    if (new Set(recipe.map((r) => r.material_id)).size !== recipe.length) return setError('كل مادة مرة واحدة فقط في المكوّنات')
    if (busy) return
    setBusy(true)
    setError('')
    const row = {
      name: d.name.trim(), description: d.description.trim() || null, price: Number(d.price) || 0,
      size: d.size.trim() || null, fabric: d.fabric.trim() || null, legs: d.legs.trim() || null, public: d.public,
    }
    const res = savedId.current
      ? await supabase.from('products').update(row).eq('id', savedId.current).select('id').single()
      : await supabase.from('products').insert(row).select('id').single()
    if (res.error) { setBusy(false); return setError(arabicError(res.error)) }
    const id = (res.data as { id: number }).id
    savedId.current = id

    // المكوّنات: نستبدلها كلها بما في النموذج
    const del = await supabase.from('product_materials').delete().eq('product_id', id)
    const ins = recipe.length
      ? await supabase.from('product_materials').insert(recipe.map((r) => ({ product_id: id, material_id: Number(r.material_id), qty: Number(r.qty) })))
      : { error: null }
    if (del.error || ins.error) { setBusy(false); return setError('حُفظ المنتج لكن المكوّنات لم تُحفظ: ' + arabicError(del.error ?? ins.error)) }

    if (photo) {
      try {
        const path = await uploadProductPhoto(id, photo.file)
        const up = await supabase.from('products').update({ photo_path: path }).eq('id', id)
        if (up.error) throw up.error
        if (d.photo_path) supabase.storage.from('products').remove([d.photo_path]).then(() => {})
      } catch (err) {
        setBusy(false)
        return setError('حُفظ المنتج لكن الصورة لم تُرفع: ' + arabicError(err))
      }
    }
    onDone()
  }

  const shownPhoto = photo?.url ?? productPhotoUrl(d.photo_path)
  return (
    <Modal title={d.id ? 'تعديل منتج' : 'منتج جديد'} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <div className="product-photo-edit">
          {shownPhoto ? <img src={shownPhoto} alt="" /> : <span className="muted"><Icon name="image" /></span>}
          <button type="button" className="secondary" onClick={() => input.current?.click()}>
            <Icon name="camera" /> {shownPhoto ? 'تغيير الصورة' : 'إضافة صورة'}
          </button>
          <input ref={input} type="file" accept="image/*" hidden aria-label="صورة المنتج"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) setPhoto({ file: f, url: URL.createObjectURL(f) }); e.target.value = '' }} />
        </div>
        <label>اسم المنتج<input value={d.name} onChange={(e) => set({ name: e.target.value })} placeholder="سرير أمير بلوح رأس مبطّن" required maxLength={120} /></label>
        <div className="grid3">
          <label>السعر (دج)<input type="number" step="any" min="0" value={d.price} onChange={(e) => set({ price: e.target.value })} required /></label>
          <label>المقاس
            <input list="product-sizes" value={d.size} onChange={(e) => set({ size: e.target.value })} maxLength={40} />
            <datalist id="product-sizes">{BED_SIZES.map((s) => <option key={s} value={s} />)}</datalist>
          </label>
          <label>القماش<input value={d.fabric} onChange={(e) => set({ fabric: e.target.value })} maxLength={60} /></label>
          <label>الأرجل<input value={d.legs} onChange={(e) => set({ legs: e.target.value })} maxLength={60} /></label>
        </div>
        <label>وصف قصير للزبون<textarea rows={2} value={d.description} onChange={(e) => set({ description: e.target.value })} maxLength={1000} /></label>
        <label className="check"><input type="checkbox" checked={d.public} onChange={(e) => set({ public: e.target.checked })} /> يظهر في كتالوج الزبائن</label>

        <h4>المكوّنات لقطعة واحدة <small className="muted">(لحساب المواد اللازمة للطلبيات وتكلفتها)</small></h4>
        <div className="table-wrap">
          <table>
            <thead><tr><th>المادة</th><th>الكمية</th><th></th></tr></thead>
            <tbody>
              {d.recipe.map((r, i) => {
                const m = materials.find((x) => String(x.id) === r.material_id)
                return (
                  <tr key={i}>
                    <td>
                      <select aria-label="مادة المكوّن" value={r.material_id} onChange={(e) => setRecipe(i, { material_id: e.target.value })}>
                        <option value="">— اختر —</option>
                        {materials.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                      </select>
                    </td>
                    <td><input aria-label="كمية المكوّن" type="number" step="any" min="0" value={r.qty} placeholder={m ? UNIT_LABELS[m.unit] : ''} onChange={(e) => setRecipe(i, { qty: e.target.value })} /></td>
                    <td><button type="button" className="link danger" onClick={() => set({ recipe: d.recipe.filter((_, k) => k !== i) })}>✕</button></td>
                  </tr>
                )
              })}
              {!d.recipe.length && <tr><td colSpan={3} className="muted center">لا مكوّنات بعد</td></tr>}
            </tbody>
          </table>
        </div>
        <button type="button" className="secondary" onClick={() => set({ recipe: [...d.recipe, { material_id: '', qty: '' }] })}>+ مادة</button>
        {cost > 0 && (
          <p className="muted">
            تكلفة مواد القطعة ≈ {dzd(cost)}
            {Number(d.price) > 0 && <>، الهامش ≈ {num(Math.round(((Number(d.price) - cost) / Number(d.price)) * 100))}%</>}
          </p>
        )}

        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={busy}>{busy ? 'جارٍ الحفظ…' : 'حفظ المنتج'}</button>
      </form>
    </Modal>
  )
}
