import { useCallback, useEffect, useRef, useState } from 'react'
import TeamNav from '../components/TeamNav'
import { useAuth } from '../lib/auth'
import { arabicError, supabase } from '../lib/supabase'
import { avatarStyle, initial, type GameId, type Ranking } from '../lib/team'

const GAMES: { id: GameId; title: string; emoji: string; text: string }[] = [
  { id: 'memory', title: 'لعبة الذاكرة', emoji: '🧠', text: 'اقلب البطاقات وجد كل زوجين متشابهين بأقل محاولات وأسرع وقت.' },
  { id: 'math', title: 'حساب الورشة', emoji: '📏', text: '10 عمليات حساب بالمقاسات. أجب صحيحًا وبسرعة لتجمع النقاط.' },
]
const MEDALS = ['🥇', '🥈', '🥉']

/** الألعاب: تنافس ودّي بين أفراد الفريق مع ترتيب أسبوعي */
export default function Games() {
  const [playing, setPlaying] = useState<GameId | null>(null)
  const [result, setResult] = useState<{ game: GameId; score: number; top: boolean; best: number } | null>(null)
  const [error, setError] = useState('')
  const [tick, setTick] = useState(0) // لإعادة تحميل الترتيب بعد كل لعبة

  async function finished(game: GameId, score: number) {
    setPlaying(null)
    const { data, error } = await supabase.rpc('submit_game_score', { p_game: game, p_score: score })
    if (error) {
      setError(error.message.includes('submit_game_score') ? 'شغّل ملف supabase/014_team_social.sql في Supabase أولًا.' : arabicError(error))
      setResult({ game, score, top: false, best: score })
    } else {
      setError('')
      const r = data as { top: boolean; best: number }
      setResult({ game, score, top: r.top, best: r.best })
    }
    setTick((t) => t + 1)
  }

  if (playing === 'memory') return <MemoryGame onDone={(s) => finished('memory', s)} onQuit={() => setPlaying(null)} />
  if (playing === 'math') return <MathGame onDone={(s) => finished('math', s)} onQuit={() => setPlaying(null)} />

  return (
    <div className="team-page">
      <TeamNav />
      {error && <p className="error">{error}</p>}

      {result && (
        <div className={`card result${result.top ? ' top' : ''}`}>
          <div className="big-emoji">{result.top ? '🏆' : result.score >= 600 ? '🎉' : '💪'}</div>
          <h2>{result.score} نقطة</h2>
          <p>
            {result.top
              ? 'أنت الأول هذا الأسبوع! نزل منشور تهنئة لكل الفريق.'
              : `أفضل نتيجة لك هذا الأسبوع: ${result.best}. حاول مرة أخرى!`}
          </p>
          <div className="toolbar" style={{ justifyContent: 'center' }}>
            <button onClick={() => { setResult(null); setPlaying(result.game) }}>العب مرة أخرى</button>
            <button className="secondary" onClick={() => setResult(null)}>إغلاق</button>
          </div>
        </div>
      )}

      {GAMES.map((g) => (
        <section key={g.id} className="card game-card">
          <div className="game-top">
            <span className="game-emoji">{g.emoji}</span>
            <div>
              <h3>{g.title}</h3>
              <p className="muted">{g.text}</p>
            </div>
          </div>
          <button className="big-btn" onClick={() => { setResult(null); setPlaying(g.id) }}>العب الآن</button>
          <Leaderboard game={g.id} tick={tick} />
        </section>
      ))}
      <p className="muted center">الترتيب الأسبوعي يبدأ كل سبت. صاحب المركز الأول يظهر في منشورات الفريق 🏆</p>
    </div>
  )
}

function Leaderboard({ game, tick }: { game: GameId; tick: number }) {
  const { session } = useAuth()
  const [all, setAll] = useState(false)
  const [rows, setRows] = useState<Ranking[] | null>(null)

  useEffect(() => {
    supabase.rpc('game_leaderboard', { p_game: game, p_all: all }).then(({ data }) => setRows((data as Ranking[]) ?? []))
  }, [game, all, tick])

  return (
    <div className="board">
      <div className="board-head">
        <b>الترتيب</b>
        <div className="mini-seg">
          <button type="button" className={!all ? 'on' : ''} onClick={() => setAll(false)}>هذا الأسبوع</button>
          <button type="button" className={all ? 'on' : ''} onClick={() => setAll(true)}>كل الأوقات</button>
        </div>
      </div>
      {rows === null ? <p className="muted">…</p> : !rows.length ? (
        <p className="muted">لم يلعب أحد بعد{all ? '' : ' هذا الأسبوع'}. كن الأول!</p>
      ) : (
        <ol className="ranks">
          {rows.map((r, i) => (
            <li key={r.profile_id} className={r.profile_id === session?.user.id ? 'me' : ''}>
              <span className="rank">{MEDALS[i] ?? i + 1}</span>
              <span className="avatar" style={avatarStyle(r.profile_id)}>{initial(r.player_name)}</span>
              <span className="chat-main"><b>{r.player_name}</b><span>{r.plays} محاولة</span></span>
              <strong>{r.best}</strong>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

/** عدّاد الثواني: يبدأ عند أول تشغيل ويتوقف عند انتهاء اللعبة */
function useStopwatch(running: boolean) {
  const [sec, setSec] = useState(0)
  const start = useRef<number | null>(null)
  useEffect(() => {
    if (!running) return
    if (start.current === null) start.current = Date.now()
    const t = setInterval(() => setSec(Math.floor((Date.now() - start.current!) / 1000)), 250)
    return () => clearInterval(t)
  }, [running])
  return sec
}

const shuffle = <T,>(a: T[]) => {
  const b = [...a]
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[b[i], b[j]] = [b[j], b[i]]
  }
  return b
}

// ---------------------------------------------------------------------
// لعبة الذاكرة: 8 أزواج من أدوات الورشة
// ---------------------------------------------------------------------
const CARDS = ['🛏️', '🪑', '🛋️', '🚪', '🪚', '🔨', '🪛', '📏']

function MemoryGame({ onDone, onQuit }: { onDone: (score: number) => void; onQuit: () => void }) {
  const [deck] = useState(() => shuffle([...CARDS, ...CARDS]))
  const [open, setOpen] = useState<number[]>([])
  const [found, setFound] = useState<Set<string>>(new Set())
  const [moves, setMoves] = useState(0)
  const [started, setStarted] = useState(false)
  const done = found.size === CARDS.length
  const sec = useStopwatch(started && !done)

  function flip(i: number) {
    if (open.length === 2 || open.includes(i) || found.has(deck[i])) return
    if (!started) setStarted(true)
    const next = [...open, i]
    setOpen(next)
    if (next.length < 2) return
    const m = moves + 1
    setMoves(m)
    const [a, b] = next
    if (deck[a] === deck[b]) {
      const f = new Set(found).add(deck[a])
      setFound(f)
      setOpen([])
      if (f.size === CARDS.length) {
        // النقاط: 1000 ناقص المحاولات الزائدة والثواني، ولا تقل عن 50
        const score = Math.round(Math.max(50, Math.min(1000, 1000 - Math.max(0, m - CARDS.length) * 30 - sec * 4)))
        setTimeout(() => onDone(score), 700)
      }
    } else {
      setTimeout(() => setOpen([]), 750)
    }
  }

  return (
    <div className="game-screen">
      <div className="game-bar">
        <button className="link" onClick={onQuit}>✕ خروج</button>
        <span>⏱ {sec} ث</span>
        <span>🔁 {moves}</span>
        <span>✅ {found.size}/{CARDS.length}</span>
      </div>
      <div className="memory-grid">
        {deck.map((c, i) => {
          const shown = open.includes(i) || found.has(c)
          return (
            <button key={i} type="button" className={`mcard${shown ? ' shown' : ''}${found.has(c) ? ' found' : ''}`}
              onClick={() => flip(i)} aria-label={shown ? c : 'بطاقة مقلوبة'}>
              <span>{shown ? c : 'CM'}</span>
            </button>
          )
        })}
      </div>
      {done && <p className="center success">أحسنت! 🎉</p>}
    </div>
  )
}

// ---------------------------------------------------------------------
// حساب الورشة: 10 عمليات بالمقاسات (سم)
// ---------------------------------------------------------------------
interface Q { a: number; op: '+' | '−' | '×' | '÷'; b: number; answer: number; choices: number[] }
const rnd = (min: number, max: number, step = 1) => min + step * Math.floor(Math.random() * ((max - min) / step + 1))

function makeQuestion(): Q {
  const kind = rnd(0, 3)
  let a: number, b: number, answer: number, op: Q['op']
  if (kind === 0) { a = rnd(60, 240, 5); b = rnd(5, 120, 5); op = '+'; answer = a + b }
  else if (kind === 1) { a = rnd(120, 280, 5); b = rnd(5, 110, 5); op = '−'; answer = a - b }
  else if (kind === 2) { a = rnd(2, 6); b = rnd(20, 200, 10); op = '×'; answer = a * b }
  else { b = rnd(2, 6); answer = rnd(20, 80, 5); a = answer * b; op = '÷' }
  const near = new Set<number>([answer])
  for (const d of shuffle([5, 10, 15, 20, 25, 30, 40, 50])) {
    if (near.size === 4) break
    const v = answer + (Math.random() < 0.5 ? -d : d)
    if (v > 0) near.add(v)
  }
  return { a, op, b, answer, choices: shuffle([...near]) }
}

const ROUNDS = 10

function MathGame({ onDone, onQuit }: { onDone: (score: number) => void; onQuit: () => void }) {
  const [qs] = useState(() => Array.from({ length: ROUNDS }, makeQuestion))
  const [i, setI] = useState(0)
  const [right, setRight] = useState(0)
  const [flash, setFlash] = useState<{ pick: number; ok: boolean } | null>(null)
  const sec = useStopwatch(i < ROUNDS)
  const q = qs[Math.min(i, ROUNDS - 1)]

  const finish = useCallback((correct: number, seconds: number) => {
    const bonus = Math.max(0, 200 - seconds * 4) * (correct / ROUNDS)
    onDone(Math.round(Math.min(1000, correct * 80 + bonus)))
  }, [onDone])

  function pick(v: number) {
    if (flash) return
    const ok = v === q.answer
    const correct = right + (ok ? 1 : 0)
    setFlash({ pick: v, ok })
    setRight(correct)
    setTimeout(() => {
      setFlash(null)
      if (i + 1 >= ROUNDS) { setI(ROUNDS); finish(correct, sec) } else setI(i + 1)
    }, ok ? 250 : 650)
  }

  return (
    <div className="game-screen">
      <div className="game-bar">
        <button className="link" onClick={onQuit}>✕ خروج</button>
        <span>⏱ {sec} ث</span>
        <span>✅ {right}</span>
        <span>{Math.min(i + 1, ROUNDS)}/{ROUNDS}</span>
      </div>
      <div className="progress"><i style={{ width: `${(i / ROUNDS) * 100}%` }} /></div>
      <div className="math-q" dir="ltr" aria-live="polite">{q.a} {q.op} {q.b}</div>
      <p className="muted center">بالسنتيمتر — اختر الجواب</p>
      <div className="math-choices">
        {q.choices.map((c) => (
          <button key={c} type="button" onClick={() => pick(c)}
            className={flash && (c === q.answer ? 'right' : c === flash.pick ? 'wrong' : '') || ''}>
            {c}
          </button>
        ))}
      </div>
    </div>
  )
}
