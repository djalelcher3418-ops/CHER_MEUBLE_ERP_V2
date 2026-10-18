import { useEffect, useState } from 'react'
import { productPhotoUrl } from '../lib/catalog'
import { dzd, supabase } from '../lib/supabase'
import type { Product } from '../lib/types'

/** كتالوج الزبائن: صفحة عامة بدون حساب، بصور المنتجات وأسعارها */
export default function Shop() {
  const [items, setItems] = useState<Product[] | null>(null)
  const [view, setView] = useState<Product | null>(null)

  useEffect(() => {
    supabase.rpc('catalog_public').then(({ data, error }) => setItems(error ? [] : ((data as Product[]) ?? [])))
  }, [])

  return (
    <div className="track shop">
      <header className="track-head">
        <div className="login-logo">CM</div>
        <h1 className="brand">CHER MEUBLE</h1>
        <p className="muted">ورشة صناعة الأثاث — الكتالوج</p>
      </header>

      {items === null && <p className="muted center">جارٍ التحميل…</p>}
      {items?.length === 0 && <p className="card center">الكتالوج فارغ حاليًا. اتصلوا بالورشة لمعرفة منتجاتنا.</p>}

      <div className="shop-grid">
        {items?.map((p) => {
          const url = productPhotoUrl(p.photo_path)
          return (
            <button key={p.id} type="button" className="shop-item" onClick={() => setView(p)}>
              <span className="shop-photo">{url ? <img src={url} alt={p.name} loading="lazy" /> : null}</span>
              <span className="shop-name">{p.name}</span>
              {p.size && <span className="size-tag">{p.size}</span>}
              <strong>{dzd(p.price)}</strong>
            </button>
          )
        })}
      </div>

      {view && (
        <div className="modal-backdrop" onClick={() => setView(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>{view.name}</h3>
              <button className="link" onClick={() => setView(null)} aria-label="إغلاق">✕</button>
            </div>
            {productPhotoUrl(view.photo_path) && <img className="shop-big" src={productPhotoUrl(view.photo_path)!} alt={view.name} />}
            {view.description && <p>{view.description}</p>}
            <ul className="list">
              {view.size && <li><span className="muted">المقاس</span><strong dir="ltr">{view.size}</strong></li>}
              {view.fabric && <li><span className="muted">القماش</span><strong>{view.fabric}</strong></li>}
              {view.legs && <li><span className="muted">الأرجل</span><strong>{view.legs}</strong></li>}
              <li className="net"><span>السعر</span><strong>{dzd(view.price)}</strong></li>
            </ul>
            <p className="muted">الأسعار قابلة للتغيير، ويمكن تعديل المقاس والقماش حسب الطلب. للطلب اتصلوا بالورشة.</p>
          </div>
        </div>
      )}

      <p className="muted center">شكرًا لزيارتكم — CHER MEUBLE</p>
    </div>
  )
}
