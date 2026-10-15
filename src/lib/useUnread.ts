import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { notify, type Message } from './chat'
import { supabase } from './supabase'

export interface Unread {
  /** رسائل لم تُقرأ */
  chat: number
  /** منشورات جديدة من الزملاء منذ آخر زيارة لصفحة الفريق */
  feed: number
  /** إعادة العدّ الآن (مثلًا بعد فتح صفحة المنشورات) */
  refresh: () => void
}

export const UnreadContext = createContext<Unread>({ chat: 0, feed: 0, refresh: () => {} })
export const useUnreadCounts = () => useContext(UnreadContext)

/** عدد الرسائل غير المقروءة والمنشورات الجديدة، يتحدّث فورًا عند وصول جديد */
export function useUnread(myId: string | undefined): Unread {
  const [counts, setCounts] = useState({ chat: 0, feed: 0 })
  const refreshRef = useRef<() => void>(() => {})
  const { pathname } = useLocation()

  useEffect(() => {
    if (!myId) return
    let alive = true
    let seq = 0
    const refresh = () => {
      const mine = ++seq // نأخذ فقط آخر عدّ طُلب، فلا يغلبه ردّ قديم وصل متأخرًا
      Promise.all([supabase.rpc('chat_overview'), supabase.rpc('feed_unread')]).then(([c, f]) => {
        if (!alive || mine !== seq) return
        setCounts({
          chat: ((c.data as { unread: number }[]) ?? []).reduce((a, r) => a + (r.unread || 0), 0),
          // قبل تشغيل ملف «الفريق» في Supabase تفشل الدالة فنعتبرها صفرًا
          feed: f.error ? 0 : Number(f.data) || 0,
        })
      })
    }
    refreshRef.current = refresh
    refresh()
    const channel = supabase
      .channel('unread-' + myId)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (p) => {
        const m = p.new as Message
        if (m.sender_id !== myId) notify(m.sender_name ?? 'رسالة جديدة', m.body?.trim() || '📷 صورة')
        refresh()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_reads' }, refresh)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'team_posts' }, refresh)
      .subscribe()
    const onVisible = () => { if (document.visibilityState === 'visible') refresh() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive = false
      document.removeEventListener('visibilitychange', onVisible)
      supabase.removeChannel(channel)
    }
  }, [myId])

  // عند الانتقال بين الصفحات (مثلًا بعد قراءة دردشة) نعيد العدّ
  useEffect(() => {
    refreshRef.current()
  }, [pathname])

  const refresh = useCallback(() => refreshRef.current(), [])
  return useMemo(() => ({ ...counts, refresh }), [counts, refresh])
}
