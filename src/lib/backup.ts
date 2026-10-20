import { arabicError, supabase } from './supabase'

export interface BackupFile {
  name: string
  created_at: string
  size: number
}

const LAST_TRY = 'cm-backup-last-try'

/**
 * نسخة أسبوعية تلقائية: عند دخول المدير، إن كانت آخر نسخة أقدم من 7 أيام تُنشأ واحدة جديدة في الخادم.
 * نحاول مرة في اليوم على الأكثر من نفس الهاتف، ولا نزعج المدير إن لم تكن الدالة منشورة بعد.
 */
export async function autoBackup(): Promise<{ name: string } | null> {
  try {
    const last = Number(localStorage.getItem(LAST_TRY) ?? 0)
    if (Date.now() - last < 864e5) return null
    localStorage.setItem(LAST_TRY, String(Date.now()))
  } catch { /* بدون تخزين محلي نحاول مع ذلك */ }
  const { data, error } = await supabase.functions.invoke('backup', { body: { if_older_than_days: 7 } })
  if (error || !data?.ok) return null
  return { name: data.name as string }
}

/** missing: جداول لم تُقرأ (مثلًا ملف SQL لم يُشغَّل بعد): النسخة ناقصة */
export async function backupNow(): Promise<{ name: string; missing: string[] }> {
  const { data, error } = await supabase.functions.invoke('backup', { body: {} })
  if (error) {
    const ctx = (error as { context?: Response }).context
    if (ctx?.status === 404) throw new Error('دالة backup غير منشورة بعد في Supabase. انظر README.')
    // رسالة الخادم إن كان الرد JSON، وإلا الخطأ العام
    const b = await ctx?.clone().json().catch(() => null)
    throw new Error(typeof b?.error === 'string' ? b.error : arabicError(error))
  }
  return { name: data.name as string, missing: (data.missing as string[] | undefined) ?? [] }
}

export async function listBackups(): Promise<BackupFile[]> {
  const { data, error } = await supabase.storage.from('backups').list('', { limit: 50, sortBy: { column: 'name', order: 'desc' } })
  if (error) throw error
  return (data ?? []).filter((f) => f.name.endsWith('.json')).map((f) => ({
    name: f.name, created_at: f.created_at ?? '', size: Number((f.metadata as { size?: number } | null)?.size ?? 0),
  }))
}

async function fetchBackup(name: string): Promise<{ created_at: string; tables: Record<string, Record<string, unknown>[]> }> {
  const { data, error } = await supabase.storage.from('backups').download(name)
  if (error) throw error
  return JSON.parse(await data.text())
}

function save(blob: Blob, file: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = file
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

/** الملف كما هو (JSON): الأنسب للاسترجاع الكامل */
export async function downloadBackupJson(name: string) {
  const { data, error } = await supabase.storage.from('backups').download(name)
  if (error) throw error
  save(data, name)
}

/** نفس النسخة في Excel: ورقة لكل جدول */
export async function downloadBackupExcel(name: string) {
  const [b, XLSX] = await Promise.all([fetchBackup(name), import('xlsx')])
  const wb = XLSX.utils.book_new()
  for (const [table, rows] of Object.entries(b.tables)) {
    const flat = rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v !== null && typeof v === 'object' ? JSON.stringify(v) : v])))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(flat.length ? flat : [{ '': 'فارغ' }]), table.slice(0, 31))
  }
  XLSX.writeFile(wb, name.replace(/\.json$/, '.xlsx'))
}
