import { useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent, type TouchEvent } from 'react'

// ---------------------------------------------------------------------
// تتريس: لوحة 10×20، القطع السبع، معاينة القطعة التالية، وظلّ مكان السقوط.
// التحكم: أزرار كبيرة للهاتف، سحب الإصبع على اللوحة، أو أسهم لوحة المفاتيح.
// ---------------------------------------------------------------------

const W = 10
const H = 20
type Board = number[][] // 0 = فارغ، 1..7 = لون القطعة

const SHAPES: number[][][] = [
  [[1, 1, 1, 1]], // I
  [[2, 2], [2, 2]], // O
  [[0, 3, 0], [3, 3, 3]], // T
  [[0, 4, 4], [4, 4, 0]], // S
  [[5, 5, 0], [0, 5, 5]], // Z
  [[6, 0, 0], [6, 6, 6]], // J
  [[0, 0, 7], [7, 7, 7]], // L
]
/** نقاط الأسطر المكتملة دفعة واحدة (مضروبة في المستوى) */
const LINE_POINTS = [0, 100, 300, 500, 800]
export const TETRIS_MAX = 200000

interface Piece { m: number[][]; x: number; y: number }

const emptyBoard = (): Board => Array.from({ length: H }, () => Array(W).fill(0))
const rotate = (m: number[][]) => m[0].map((_, c) => m.map((row) => row[c]).reverse())

function collides(b: Board, p: Piece) {
  for (let r = 0; r < p.m.length; r++)
    for (let c = 0; c < p.m[r].length; c++) {
      if (!p.m[r][c]) continue
      const x = p.x + c, y = p.y + r
      if (x < 0 || x >= W || y >= H) return true
      if (y >= 0 && b[y][x]) return true
    }
  return false
}

/** كيس عشوائي: كل القطع السبع تظهر مرة قبل أن تتكرر (لعب عادل) */
function makeBag() {
  const bag = [0, 1, 2, 3, 4, 5, 6]
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[bag[i], bag[j]] = [bag[j], bag[i]]
  }
  return bag
}

const spawn = (t: number): Piece => {
  const m = SHAPES[t]
  return { m, x: Math.floor((W - m[0].length) / 2), y: -1 }
}

interface State {
  board: Board
  piece: Piece
  next: number
  bag: number[]
  score: number
  lines: number
  level: number
  over: boolean
}

function newState(): State {
  const bag = makeBag()
  const first = bag.shift()!
  const next = bag.shift()!
  return { board: emptyBoard(), piece: spawn(first), next, bag, score: 0, lines: 0, level: 1, over: false }
}

export default function TetrisGame({ onDone, onQuit }: { onDone: (score: number) => void; onQuit: () => void }) {
  const st = useRef<State>(newState())
  const [, setFrame] = useState(0)
  const [paused, setPaused] = useState(false)
  const [flash, setFlash] = useState<number[]>([]) // الأسطر التي اكتملت للتو
  const draw = () => setFrame((f) => f + 1)
  const ended = useRef(false)

  const finish = useCallback(() => {
    if (ended.current) return
    ended.current = true
    st.current.over = true
    draw()
    setTimeout(() => onDone(Math.min(TETRIS_MAX, st.current.score)), 900)
  }, [onDone])

  /** تثبيت القطعة، حذف الأسطر المكتملة، ثم القطعة التالية */
  const lock = useCallback(() => {
    const s = st.current
    const b = s.board.map((r) => [...r])
    let overTop = false
    s.piece.m.forEach((row, r) => row.forEach((v, c) => {
      if (!v) return
      const y = s.piece.y + r
      if (y < 0) overTop = true
      else b[y][s.piece.x + c] = v
    }))
    if (overTop) { s.board = b; return finish() }
    const full = b.map((row, i) => (row.every((v) => v) ? i : -1)).filter((i) => i >= 0)
    if (full.length) {
      const kept = b.filter((_, i) => !full.includes(i))
      while (kept.length < H) kept.unshift(Array(W).fill(0))
      s.board = kept
      s.score += LINE_POINTS[full.length] * s.level
      s.lines += full.length
      s.level = 1 + Math.floor(s.lines / 10)
      setFlash(full)
      setTimeout(() => setFlash([]), 250)
      if (navigator.vibrate) navigator.vibrate(full.length >= 4 ? [40, 30, 40] : 25)
    } else {
      s.board = b
    }
    if (!s.bag.length) s.bag = makeBag()
    s.piece = spawn(s.next)
    s.next = s.bag.shift()!
    if (collides(s.board, s.piece)) return finish()
    draw()
  }, [finish])

  const move = useCallback((dx: number, dy: number) => {
    const s = st.current
    if (s.over || paused) return false
    const p = { ...s.piece, x: s.piece.x + dx, y: s.piece.y + dy }
    if (collides(s.board, p)) {
      if (dy > 0) lock()
      return false
    }
    s.piece = p
    draw()
    return true
  }, [lock, paused])

  const turn = useCallback(() => {
    const s = st.current
    if (s.over || paused) return
    const m = rotate(s.piece.m)
    // نحاول الدوران في مكانه، ثم بإزاحة بسيطة إن اصطدم بالجدار
    for (const k of [0, -1, 1, -2, 2]) {
      const p = { ...s.piece, m, x: s.piece.x + k }
      if (!collides(s.board, p)) { s.piece = p; draw(); return }
    }
  }, [paused])

  const soft = useCallback(() => { if (move(0, 1)) st.current.score += 1 }, [move])

  const hardDrop = useCallback(() => {
    const s = st.current
    if (s.over || paused) return
    let n = 0
    while (!collides(s.board, { ...s.piece, y: s.piece.y + 1 })) { s.piece = { ...s.piece, y: s.piece.y + 1 }; n++ }
    s.score += n * 2
    lock()
  }, [lock, paused])

  // الجاذبية: تتسارع مع كل مستوى
  const level = st.current.level
  const over = st.current.over
  useEffect(() => {
    if (paused || over) return
    const t = setInterval(() => move(0, 1), Math.max(90, 800 - (level - 1) * 70))
    return () => clearInterval(t)
  }, [move, level, paused, over])

  // إيقاف مؤقت عند الخروج من التطبيق
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') setPaused(true) }
    document.addEventListener('visibilitychange', onHide)
    return () => document.removeEventListener('visibilitychange', onHide)
  }, [])

  // لوحة المفاتيح (على الكمبيوتر)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k: Record<string, () => void> = {
        ArrowLeft: () => move(-1, 0), ArrowRight: () => move(1, 0), ArrowDown: soft,
        ArrowUp: turn, ' ': hardDrop, p: () => setPaused((v) => !v),
      }
      const f = k[e.key]
      if (f) { e.preventDefault(); f() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [move, soft, turn, hardDrop])

  // السحب على اللوحة: يمين/يسار = تحريك، لأسفل = إسقاط، لمسة = تدوير
  const touch = useRef<{ x: number; y: number; moved: number } | null>(null)
  const boardEl = useRef<HTMLDivElement>(null)
  function onTouchStart(e: TouchEvent) {
    const t = e.touches[0]
    touch.current = { x: t.clientX, y: t.clientY, moved: 0 }
  }
  function onTouchMove(e: TouchEvent) {
    const s = touch.current
    if (!s) return
    const t = e.touches[0]
    const cell = (boardEl.current?.clientWidth ?? 300) / W
    const steps = Math.trunc((t.clientX - s.x) / cell)
    // اللوحة دائمًا من اليسار إلى اليمين، حتى في صفحة عربية
    while (s.moved < steps) { move(1, 0); s.moved++ }
    while (s.moved > steps) { move(-1, 0); s.moved-- }
  }
  function onTouchEnd(e: TouchEvent) {
    const s = touch.current
    touch.current = null
    if (!s) return
    const t = e.changedTouches[0]
    const dx = t.clientX - s.x, dy = t.clientY - s.y
    if (dy > 60 && Math.abs(dy) > Math.abs(dx)) hardDrop()
    else if (Math.abs(dx) < 10 && Math.abs(dy) < 10 && !s.moved) turn()
  }

  // الضغط المطوّل على الأزرار يكرّر الحركة
  const repeat = useRef<ReturnType<typeof setInterval> | null>(null)
  const hold = (f: () => void) => ({
    onPointerDown: (e: RPointerEvent) => {
      e.preventDefault()
      f()
      clearInterval(repeat.current!)
      const started = Date.now()
      repeat.current = setInterval(() => { if (Date.now() - started > 180) f() }, 60)
    },
    onPointerUp: () => clearInterval(repeat.current!),
    onPointerLeave: () => clearInterval(repeat.current!),
    onPointerCancel: () => clearInterval(repeat.current!),
  })
  useEffect(() => () => clearInterval(repeat.current!), [])

  const s = st.current
  // اللوحة للعرض: المثبّت + الظلّ + القطعة الحالية
  let ghostY = s.piece.y
  while (!collides(s.board, { ...s.piece, y: ghostY + 1 })) ghostY++
  const cells = s.board.map((row) => row.map((v) => ({ v, ghost: false })))
  s.piece.m.forEach((row, r) => row.forEach((v, c) => {
    if (!v) return
    const gy = ghostY + r, py = s.piece.y + r, x = s.piece.x + c
    if (gy >= 0 && !cells[gy][x].v) cells[gy][x] = { v, ghost: true }
    if (py >= 0) cells[py][x] = { v, ghost: false }
  }))
  const nextM = SHAPES[s.next]

  return (
    <div className="game-screen tetris">
      <div className="game-bar">
        <button className="link" onClick={onQuit}>✕ خروج</button>
        <span>⭐ <b className="t-score">{s.score}</b></span>
        <span>📶 {s.level}</span>
        <span>➖ {s.lines}</span>
        <button className="link" onClick={() => setPaused((v) => !v)} disabled={s.over} aria-label={paused ? 'متابعة' : 'إيقاف مؤقت'}>{paused ? '▶' : '❚❚'}</button>
      </div>

      <div className="tetris-main">
        <div className="tetris-board" ref={boardEl} dir="ltr"
          onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
          {cells.map((row, y) => row.map((c, x) => (
            <i key={`${y}-${x}`} className={`${c.v ? `t${c.v}` : ''}${c.ghost ? ' ghost' : ''}${flash.includes(y) ? ' flash' : ''}`} />
          )))}
          {(paused || s.over) && (
            <div className="tetris-over">
              {s.over ? <><b>انتهت اللعبة</b><span>{s.score} نقطة</span></> : <button onClick={() => setPaused(false)}>▶ متابعة</button>}
            </div>
          )}
        </div>
        <aside className="tetris-side">
          <small className="muted">التالية</small>
          <div className="tetris-next" dir="ltr" style={{ gridTemplateColumns: `repeat(${nextM[0].length}, 1fr)` }}>
            {nextM.flatMap((row, r) => row.map((v, c) => <i key={`${r}-${c}`} className={v ? `t${v}` : ''} />))}
          </div>
        </aside>
      </div>

      <div className="tetris-pad" dir="ltr">
        <button type="button" aria-label="يسار" {...hold(() => move(-1, 0))}>◀</button>
        <button type="button" aria-label="تدوير" onPointerDown={(e) => { e.preventDefault(); turn() }}>⟳</button>
        <button type="button" aria-label="يمين" {...hold(() => move(1, 0))}>▶</button>
        <button type="button" aria-label="نزول" {...hold(soft)}>▼</button>
        <button type="button" aria-label="إسقاط" className="drop" onPointerDown={(e) => { e.preventDefault(); hardDrop() }}>⤓ إسقاط</button>
      </div>
      <p className="muted center tetris-help">اسحب على اللوحة يمينًا ويسارًا، المس للتدوير، واسحب لأسفل للإسقاط.</p>
    </div>
  )
}
