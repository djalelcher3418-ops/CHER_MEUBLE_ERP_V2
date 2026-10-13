import type { ReactNode } from 'react'

export default function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="link" onClick={onClose} aria-label="إغلاق">✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}
