import { useEffect, useState } from 'react'
import PayPeriod from '../components/PayPeriod'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import type { Employee } from '../lib/types'

/** صفحة العامل: حضوره وراتبه فقط، للقراءة */
export default function MyPay() {
  const { session } = useAuth()
  const [me, setMe] = useState<Employee | null | undefined>(undefined)

  useEffect(() => {
    supabase
      .from('employees')
      .select('*')
      .eq('profile_id', session!.user.id)
      .maybeSingle()
      .then(({ data }) => setMe((data as Employee | null) ?? null))
  }, [session])

  if (me === undefined) return <p className="muted">جارٍ التحميل…</p>
  if (!me)
    return (
      <div className="card narrow">
        <h2>راتبي</h2>
        <p>حسابك غير مربوط ببطاقة عامل بعد. اطلب من المدير ربطه من صفحة «العمّال».</p>
      </div>
    )

  return (
    <div className="scan-page">
      <h2>راتبي — {me.full_name}</h2>
      <PayPeriod employee={me} editable={false} />
    </div>
  )
}
