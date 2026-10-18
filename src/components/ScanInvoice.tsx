import { useRef, useState } from 'react'
import { scanInvoice, type InvoiceScan, type ScanKind } from '../lib/invoiceScan'
import Icon from './Icon'

/** زر «تصوير فاتورة»: يفتح الكاميرا أو المعرض، ويعيد ما قُرئ من الصورة */
export default function ScanInvoiceButton({ kind, onResult }: { kind: ScanKind; onResult: (s: InvoiceScan) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function read(file: File | undefined) {
    if (!file) return
    setBusy(true)
    setError('')
    try {
      onResult(await scanInvoice(file, kind))
    } catch (e) {
      setError((e as Error).message)
    }
    setBusy(false)
  }

  return (
    <div className="scan-invoice">
      <button type="button" className="secondary big-btn" onClick={() => input.current?.click()} disabled={busy} aria-busy={busy}>
        <Icon name="camera" />
        {busy ? 'جارٍ قراءة الفاتورة… (حتى نصف دقيقة)' : kind === 'purchase' ? 'تصوير فاتورة المورد وملء البيانات' : 'تصوير فاتورة أو طلب الزبون وملء البيانات'}
      </button>
      <input ref={input} type="file" accept="image/*" hidden
        onChange={(e) => { read(e.target.files?.[0]); e.target.value = '' }} />
      {error && <p className="error">{error}</p>}
    </div>
  )
}

/** ملخّص ما قُرئ، مع أي ملاحظة تحتاج المراجعة */
export function ScanSummary({ scan, computed }: { scan: InvoiceScan; computed: number }) {
  const diff = scan.total != null && Math.abs(scan.total - computed) > 1
  return (
    <div className={`scan-summary${diff || scan.note ? ' warn' : ''}`} role="status">
      <strong>قُرئت الفاتورة. راجع البيانات قبل الحفظ.</strong>
      {scan.total != null && (
        <span>
          مجموع الفاتورة المكتوب: {scan.total.toLocaleString('fr-DZ')} دج
          {diff && ` — لا يساوي مجموع الأسطر هنا (${computed.toLocaleString('fr-DZ')} دج)`}
        </span>
      )}
      {scan.note && <span>{scan.note}</span>}
    </div>
  )
}
