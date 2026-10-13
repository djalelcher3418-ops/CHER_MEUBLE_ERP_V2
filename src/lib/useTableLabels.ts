import { useEffect } from 'react'

/**
 * يكتب عنوان العمود داخل كل خانة (data-label) حتى تتحول الجداول
 * إلى بطاقات مقروءة على شاشة الهاتف (انظر index.css).
 */
export function useTableLabels(el: HTMLElement | null) {
  useEffect(() => {
    if (!el) return
    let frame = 0
    const apply = () => {
      frame = 0
      el.querySelectorAll('.table-wrap table').forEach((table) => {
        const heads = Array.from(table.querySelectorAll('thead th')).map((th) => th.textContent?.trim() ?? '')
        table.querySelectorAll('tbody tr').forEach((tr) => {
          Array.from(tr.children).forEach((td, i) => {
            const label = td.hasAttribute('colspan') ? '' : heads[i] ?? ''
            if ((td as HTMLElement).dataset.label !== label) (td as HTMLElement).dataset.label = label
          })
        })
      })
    }
    const obs = new MutationObserver(() => { if (!frame) frame = requestAnimationFrame(apply) })
    obs.observe(el, { childList: true, subtree: true })
    apply()
    return () => { obs.disconnect(); if (frame) cancelAnimationFrame(frame) }
  }, [el])
}
