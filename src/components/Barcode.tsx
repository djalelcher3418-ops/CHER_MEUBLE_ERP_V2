import JsBarcode from 'jsbarcode'
import { useEffect, useRef } from 'react'

export default function Barcode({ value, height = 50 }: { value: string; height?: number }) {
  const ref = useRef<SVGSVGElement>(null)
  useEffect(() => {
    if (ref.current) {
      JsBarcode(ref.current, value, { format: 'CODE128', height, width: 2, fontSize: 14, margin: 4 })
    }
  }, [value, height])
  return <svg ref={ref} />
}
