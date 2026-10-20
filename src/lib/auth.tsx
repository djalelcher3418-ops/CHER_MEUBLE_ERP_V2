import type { Session } from '@supabase/supabase-js'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { isOffline } from './offline'
import { supabase } from './supabase'
import type { Profile } from './types'

interface AuthState {
  session: Session | null
  profile: Profile | null
  loading: boolean
  isAdmin: boolean
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      if (!data.session) setLoading(false)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      if (!s) {
        setProfile(null)
        setLoading(false)
      }
    })
    return () => data.subscription.unsubscribe()
  }, [])

  // تزداد عند عودة الإنترنت إن كان الحساب من النسخة المحفوظة: نعيد قراءته (قد يكون أُوقف أو تغيّر دوره)
  const [refetch, setRefetch] = useState(0)
  useEffect(() => {
    if (!session) return
    let stale = false
    const back = () => setRefetch((n) => n + 1)
    if (!refetch) setLoading(true) // إعادة القراءة تتم بهدوء دون شاشة التحميل
    supabase
      .from('profiles')
      .select('id, full_name, role, phone, active')
      .eq('id', session.user.id)
      .single()
      .then(({ data, error }) => {
        const key = 'cm-profile-' + session.user.id
        let p = (data as Profile) ?? null
        try {
          // بدون إنترنت: نستعمل آخر بيانات حساب محفوظة حتى يفتح التطبيق في الورشة
          if (p) localStorage.setItem(key, JSON.stringify(p))
          else if (error && isOffline(error)) {
            p = JSON.parse(localStorage.getItem(key) ?? 'null')
            if (!stale) window.addEventListener('online', back, { once: true })
          }
        } catch { /* تخزين محلي غير متاح */ }
        if (stale) return
        setProfile(p)
        setLoading(false)
      })
    return () => { stale = true; window.removeEventListener('online', back) }
  }, [session?.user.id, refetch])

  const value: AuthState = {
    session,
    profile,
    loading,
    isAdmin: profile?.role === 'admin' && profile.active,
    signOut: async () => {
      await supabase.auth.signOut()
    },
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth outside AuthProvider')
  return ctx
}
