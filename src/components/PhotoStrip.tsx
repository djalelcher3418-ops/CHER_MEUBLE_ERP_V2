import { useRef, useState } from 'react'
import { addOrderPhoto, deleteOrderPhoto, type OrderPhoto } from '../lib/orderPhotos'
import { arabicError } from '../lib/supabase'
import Icon from './Icon'

/** شريط صور الطلبية: عرض، تكبير، إضافة، وحذف */
export default function PhotoStrip({ orderId, photos, canAdd, canDelete, onChanged }: {
  orderId: number
  photos: OrderPhoto[]
  canAdd: boolean
  canDelete: (p: OrderPhoto) => boolean
  onChanged: () => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [view, setView] = useState<OrderPhoto | null>(null)

  async function add(files: FileList | null) {
    if (!files?.length) return
    setBusy(true)
    setError('')
    try {
      for (const f of Array.from(files)) await addOrderPhoto(orderId, f)
      onChanged()
    } catch (e) {
      setError('تعذّر رفع الصورة: ' + arabicError(e))
    }
    setBusy(false)
    if (input.current) input.current.value = ''
  }

  async function remove(p: OrderPhoto) {
    if (!confirm('حذف هذه الصورة؟')) return
    try {
      await deleteOrderPhoto(p)
      setView(null)
      onChanged()
    } catch (e) {
      setError(arabicError(e))
    }
  }

  if (!photos.length && !canAdd) return null

  return (
    <div className="photos">
      <div className="photo-row">
        {photos.map((p) => (
          <button key={p.id} type="button" className="photo" onClick={() => setView(p)} aria-label="عرض الصورة">
            {p.url ? <img src={p.url} alt={p.caption ?? 'صورة الطلبية'} loading="lazy" /> : <span className="muted">…</span>}
          </button>
        ))}
        {canAdd && (
          <button type="button" className="photo add" onClick={() => input.current?.click()} disabled={busy} aria-label="إضافة صورة">
            {busy ? '…' : <Icon name="image" />}
            <small>{busy ? 'جارٍ الرفع' : 'إضافة صورة'}</small>
          </button>
        )}
      </div>
      <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => add(e.target.files)} />
      {error && <p className="error">{error}</p>}
      {view && (
        <div className="viewer" onClick={() => setView(null)}>
          {view.url && <img src={view.url} alt="" />}
          <button className="icon-btn" aria-label="إغلاق"><Icon name="close" /></button>
          {canDelete(view) && (
            <button className="danger viewer-del" onClick={(e) => { e.stopPropagation(); remove(view) }}>حذف الصورة</button>
          )}
        </div>
      )}
    </div>
  )
}
