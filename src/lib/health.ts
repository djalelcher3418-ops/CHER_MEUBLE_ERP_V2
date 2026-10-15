import { supabase } from './supabase'

export interface Check {
  key: string
  label: string
  fix: string
  ok: boolean | null
  detail?: string
}

type Probe = () => PromiseLike<{ error: { message?: string } | null; data?: unknown }>

const DB_CHECKS: { key: string; label: string; fix: string; probe: Probe; okIf?: (data: unknown) => boolean }[] = [
  { key: 'p1', label: 'المواد والمشتريات والموردون', fix: 'شغّل supabase/001_phase1.sql', probe: () => supabase.from('materials').select('id').limit(1) },
  { key: 'p2', label: 'الزبائن والطلبيات', fix: 'شغّل supabase/002_phase2.sql', probe: () => supabase.from('customers').select('id').limit(1) },
  { key: 'p3', label: 'العمّال والرواتب والمصاريف', fix: 'شغّل supabase/003_phase3.sql', probe: () => supabase.from('employees').select('id').limit(1) },
  { key: 'p4', label: 'لوحة الورشة وسجل الحالات', fix: 'شغّل supabase/004_phase4.sql', probe: () => supabase.from('order_events').select('id').limit(1) },
  { key: 'p5', label: 'الرسائل', fix: 'شغّل supabase/005_messages.sql', probe: () => supabase.rpc('chat_overview') },
  { key: 'p6', label: 'اشتراكات التنبيهات', fix: 'شغّل supabase/006_push.sql', probe: () => supabase.from('push_subscriptions').select('id').limit(1) },
  {
    key: 'p8', label: 'حسابات الهاتف ورقم النسخة', fix: 'شغّل supabase/007_accounts.sql ثم supabase/008_version.sql',
    probe: () => supabase.rpc('erp_schema_version'), okIf: (v) => Number(v) >= 8,
  },
  {
    key: 'p9', label: 'إصلاحات الأمان والدقة', fix: 'شغّل supabase/009_hardening.sql',
    probe: () => supabase.rpc('erp_schema_version'), okIf: (v) => Number(v) >= 9,
  },
  {
    key: 'p10', label: 'صور الطلبيات ورابط التتبع', fix: 'شغّل supabase/010_photos_tracking.sql',
    probe: () => supabase.rpc('erp_schema_version'), okIf: (v) => Number(v) >= 10,
  },
  {
    key: 'p11', label: 'عروض الأسعار', fix: 'شغّل supabase/011_quotes.sql',
    probe: () => supabase.rpc('erp_schema_version'), okIf: (v) => Number(v) >= 11,
  },
  {
    key: 'p12', label: 'مقاسات الأسرّة في الطلبيات', fix: 'شغّل supabase/012_bed_size.sql',
    probe: () => supabase.rpc('erp_schema_version'), okIf: (v) => Number(v) >= 12,
  },
]

/** فحص قاعدة البيانات: هل شُغّلت كل ملفات SQL؟ */
export async function checkDatabase(): Promise<Check[]> {
  return Promise.all(
    DB_CHECKS.map(async (c) => {
      const { error, data } = await c.probe()
      const ok = !error && (c.okIf ? c.okIf(data) : true)
      return { key: c.key, label: c.label, fix: c.fix, ok, detail: error?.message }
    }),
  )
}

async function functionStatus(name: string, body: Record<string, unknown>, deployedStatuses: number[]): Promise<boolean> {
  const { error } = await supabase.functions.invoke(name, { body })
  if (!error) return true
  const status = (error as { context?: Response }).context?.status
  return status !== undefined && deployedStatuses.includes(status)
}

/** فحص الخدمات: دوال الخادم ومكان حفظ الصور */
export async function checkServices(): Promise<Check[]> {
  const [push, users, bucket] = await Promise.all([
    functionStatus('send-push', { action: 'public-key' }, []),
    functionStatus('manage-users', { action: 'ping' }, [400, 403]),
    supabase.storage.from('chat').list('', { limit: 1 }),
  ])
  return [
    { key: 'f1', label: 'دالة التنبيهات send-push', fix: 'انشر supabase/functions/send-push (انظر README)', ok: push },
    { key: 'f2', label: 'دالة الحسابات manage-users', fix: 'انشر supabase/functions/manage-users (انظر README)', ok: users },
    { key: 's1', label: 'مكان حفظ صور الرسائل', fix: 'شغّل supabase/005_messages.sql', ok: !bucket.error, detail: bucket.error?.message },
  ]
}
