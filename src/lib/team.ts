import { compressImage } from './chat'
import { supabase, todayISO } from './supabase'

export interface Post {
  id: number
  kind: 'post' | 'kudos' | 'game'
  author_id: string | null
  author_name: string | null
  body: string | null
  image_path: string | null
  kudos_to: string | null
  kudos_name: string | null
  created_at: string
  reactions: Record<string, number>
  my_reactions: string[]
  comments: number
}

export interface PostComment {
  id: number
  post_id: number
  author_id: string | null
  author_name: string | null
  body: string
  created_at: string
}

export interface Member {
  id: string
  full_name: string
  role: 'admin' | 'worker'
}

export interface Ranking {
  profile_id: string
  player_name: string | null
  best: number
  plays: number
}

export type GameId = 'memory' | 'math'

export const REACTIONS = ['❤️', '👏', '😂', '🔥'] as const

/** يرفع صورة المنشور إلى مجلد صاحبها ويعيد مسارها */
export async function uploadTeamImage(myId: string, file: File): Promise<string> {
  const blob = await compressImage(file)
  const path = `${myId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`
  const { error } = await supabase.storage.from('team').upload(path, blob, { contentType: 'image/jpeg' })
  if (error) throw error
  return path
}

/** لون ثابت لكل شخص (من رقم حسابه) لصورته الرمزية */
const HUES = [18, 32, 145, 200, 265, 330, 90, 0]
export function avatarStyle(id: string | null | undefined) {
  let h = 0
  for (const c of id ?? '') h = (h * 31 + c.charCodeAt(0)) >>> 0
  const hue = HUES[h % HUES.length]
  return { background: `hsl(${hue} 45% 42%)`, color: '#fff' }
}

export const initial = (name: string | null | undefined) => (name ?? '؟').trim().charAt(0) || '؟'

/** «الآن»، «منذ 5 د»، «منذ 3 س»، «أمس»، أو التاريخ */
export function timeAgo(ts: string) {
  const s = Math.max(0, (Date.now() - Date.parse(ts)) / 1000)
  if (s < 60) return 'الآن'
  if (s < 3600) return `منذ ${Math.floor(s / 60)} د`
  const d = new Date(ts)
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  if (day === todayISO()) return `منذ ${Math.floor(s / 3600)} س`
  if (s < 2 * 86400) return 'أمس'
  return `${d.getDate()}/${d.getMonth() + 1}`
}
