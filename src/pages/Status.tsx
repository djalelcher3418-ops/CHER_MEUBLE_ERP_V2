import { useEffect, useState } from 'react'
import { checkDatabase, checkServices, type Check } from '../lib/health'

/** حالة النظام: ما الذي شُغّل في Supabase وما الذي ينقص */
export default function Status() {
  const [db, setDb] = useState<Check[] | null>(null)
  const [svc, setSvc] = useState<Check[] | null>(null)
  const [round, setRound] = useState(0)

  useEffect(() => {
    setDb(null)
    setSvc(null)
    checkDatabase().then(setDb)
    checkServices().then(setSvc)
  }, [round])

  const all = [...(db ?? []), ...(svc ?? [])]
  const done = db && svc
  const missing = all.filter((c) => c.ok === false)

  return (
    <div>
      <div className="page-head">
        <h2>حالة النظام</h2>
        <button className="secondary" onClick={() => setRound(round + 1)} disabled={!done}>إعادة الفحص</button>
      </div>
      {done && (missing.length
        ? <p className="error">ينقص {missing.length} من خطوات الإعداد. نفّذها بالترتيب من الأعلى إلى الأسفل.</p>
        : <p className="success">كل شيء جاهز ✓</p>)}

      <CheckList title="قاعدة البيانات (ملفات SQL)" items={db} />
      <CheckList title="الخدمات" items={svc} />

      <section className="card">
        <h3>كيف أشغّل ملف SQL؟</h3>
        <ol style={{ margin: 0, paddingInlineStart: 20 }}>
          <li>افتح ملف SQL من مستودع GitHub وانسخ محتواه كاملًا.</li>
          <li>في Supabase: SQL Editor ← New query ← الصق ← Run.</li>
          <li>كل ملف يُشغَّل مرة واحدة فقط، وبالترتيب.</li>
        </ol>
        <h3 style={{ marginTop: 16 }}>كيف أنشر دالة؟</h3>
        <p style={{ margin: 0 }}>في Supabase: Edge Functions ← Deploy a new function ← Via Editor، ثم اكتب اسم الدالة والصق ملفها ← Deploy.</p>
      </section>
    </div>
  )
}

function CheckList({ title, items }: { title: string; items: Check[] | null }) {
  return (
    <section className="card">
      <h3>{title}</h3>
      {!items ? (
        <p className="muted">جارٍ الفحص…</p>
      ) : (
        <ul className="list">
          {items.map((c) => (
            <li key={c.key}>
              <span>
                <b>{c.ok ? '✓' : '✗'} {c.label}</b>
                {!c.ok && <span className="muted" style={{ display: 'block' }}>{c.fix}</span>}
              </span>
              <span className={`status ${c.ok ? 'st-ready' : 'st-cancelled'}`}>{c.ok ? 'جاهز' : 'ناقص'}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
