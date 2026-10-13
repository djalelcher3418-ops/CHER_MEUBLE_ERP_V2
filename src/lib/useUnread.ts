import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { notify, type Message } from './chat'
import { supabase } from './supabase'

/** عدد الرسائل غير المقروءة، يتحدّث فورًا عند وصول رسالة جديدة */
export function useUnread(myId: string | undefined) {
  const [count, setCount] = useState(0)
  const refreshRef = useRef<() => void>(() => {})
  const { pathname } = useLocation()

  useEffect(() => {
    if (!myId) return
    let alive = true
    const refresh = () => {
      supabase.rpc('chat_overview').then(({ data }) => {
        if (alive) setCount(((data as { unread: number }[]) ?? []).reduce((a, r) => a + (r.unread || 0), 0))
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

  return count
}
