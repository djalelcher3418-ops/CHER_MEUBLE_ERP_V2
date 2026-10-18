import { useEffect, useState } from 'react'
import { backupNow, downloadBackupExcel, downloadBackupJson, listBackups, type BackupFile } from '../lib/backup'
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
      <Backups />

      <section className="card">
        <h3>كيف أشغّل ملف SQL؟</h3>
        <ol style={{ margin: 0, paddingInlineStart: 20 }}>
          <li>افتح ملف SQL من مستودع GitHub وانسخ محتواه كاملًا.</li>
          <li>في Supabase: SQL Editor ← New query ← الصق ← Run.</li>
          <li>كل ملف يُشغَّل مرة واحدة فقط، وبالترتيب.</li>
        </ol>
        <h3 style={{ marginTop: 16 }}>كيف أنشر دالة؟</h3>
        <p style={{ margin: 0 }}>في Supabase: Edge Functions ← Deploy a new function ← Via Editor، ثم اكتب اسم الدالة والصق ملفها ← Deploy.</p>
        <h3 style={{ marginTop: 16 }}>أغلق التسجيل المفتوح (مهم)</h3>
        <p style={{ margin: 0 }}>
          الحسابات تُنشأ من صفحة «الحسابات» فقط. في Supabase: Authentication ← Sign In / Providers ← أطفئ
          «Allow new users to sign up». حتى لو بقي مفتوحًا، أي حساب يُسجَّل من الخارج يبقى موقوفًا بعد تشغيل 009.
        </p>
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

/** النسخ الاحتياطية: تلقائية كل أسبوع، مع تنزيلها Excel أو JSON */
function Backups() {
  const [files, setFiles] = useState<BackupFile[] | null>(null)
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const load = () => listBackups().then(setFiles, () => setFiles([]))
  useEffect(() => { load() }, [])

  async function run(key: string, f: () => Promise<unknown>, done?: string) {
    setBusy(key)
    setMsg(null)
    try {
      await f()
      if (done) setMsg({ ok: true, text: done })
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message })
    }
    setBusy('')
  }
  const when = (f: BackupFile) => f.created_at ? new Date(f.created_at).toLocaleString('fr-DZ', { dateStyle: 'medium', timeStyle: 'short' }) : f.name

  return (
    <section className="card backups">
      <div className="page-head" style={{ marginBottom: 6 }}>
        <h3 style={{ margin: 0 }}>النسخ الاحتياطية</h3>
        <button className="secondary" disabled={!!busy} onClick={() => run('now', async () => { await backupNow(); await load() }, 'تم حفظ نسخة جديدة ✓')}>
          {busy === 'now' ? 'جارٍ الحفظ…' : 'نسخة الآن'}
        </button>
      </div>
      <p className="muted" style={{ marginTop: 0 }}>تُحفظ نسخة كاملة تلقائيًا كل أسبوع عند فتحك للتطبيق، وتبقى آخر 12 نسخة في الخادم. نزّل واحدة من حين لآخر واحفظها خارج الهاتف.</p>
      {msg && <p className={msg.ok ? 'success' : 'error'}>{msg.text}</p>}
      {files === null ? <p className="muted">…</p> : !files.length ? (
        <p className="muted">لا توجد نسخ بعد.</p>
      ) : (
        <ul className="list">
          {files.map((f) => (
            <li key={f.name}>
              <span>{when(f)} <small className="muted">{f.size ? `${Math.max(1, Math.round(f.size / 1024))} KB` : ''}</small></span>
              <span className="toolbar" style={{ margin: 0 }}>
                <button className="link" disabled={!!busy} onClick={() => run(f.name + 'x', () => downloadBackupExcel(f.name))}>{busy === f.name + 'x' ? '…' : 'Excel'}</button>
                <button className="link" disabled={!!busy} onClick={() => run(f.name + 'j', () => downloadBackupJson(f.name))}>{busy === f.name + 'j' ? '…' : 'JSON'}</button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
