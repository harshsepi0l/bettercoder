/**
 * The whiteboard: the coach draws an idea in steps (boxes, rows of cells, notes, arrows) on a small grid; the app lays
 * it out and Excalidraw draws it. Pure data and rules, shared by the coach's tool (validation) and the window (layout).
 * Every word on it goes through the no-code check before it is shown (coach/tools/cards.ts).
 */

export type BoxShape = 'box' | 'circle' | 'diamond'

export type BoardItem =
  /** A box with a value or a few words; `label` is its name above it (a variable: label "total", text "5"). */
  | { type: 'box'; id: string; text: string; col: number; row: number; label?: string; width?: number; shape?: BoxShape }
  /** A row of cells (a list, a queue, a string's letters); each cell is `<id>.<index>` for arrows and changes. */
  | { type: 'cells'; id: string; items: string[]; col: number; row: number; label?: string; indexes?: boolean }
  /** Words on the board, no border. */
  | { type: 'note'; id: string; text: string; col: number; row: number }
  /** From one thing to another (a box, a row, one cell, a note). */
  | { type: 'arrow'; id: string; from: string; to: string; label?: string }

export interface BoardChange {
  id: string
  /** New words for a box, note, arrow label, or one cell (`<id>.<index>`). */
  text?: string
  /** All the cells of a row, for a row that grows or shrinks. */
  items?: string[]
}

export interface BoardStep {
  /** One short line: what happens in this step. */
  say: string
  add: BoardItem[]
  change: BoardChange[]
  remove: string[]
  /** What to light up in this step (besides what it added or changed). */
  focus: string[]
}

export interface Board {
  steps: BoardStep[]
}

export const BOARD_LIMITS = {
  steps: 12,
  itemsPerStep: 12,
  itemsOnBoard: 40,
  cells: 12,
  cols: 10,
  rows: 10,
  boxText: 40,
  noteText: 80,
  say: 120
} as const

const ID = /^[A-Za-z][\w-]{0,23}$/

/** Every word on a board, for the no-code check. */
export function boardTexts(board: Board): string[] {
  const out: string[] = []
  for (const s of board.steps) {
    out.push(s.say)
    for (const it of s.add) {
      if (it.type === 'cells') out.push(...it.items, it.label ?? '')
      else if (it.type === 'arrow') out.push(it.label ?? '')
      else out.push(it.text, it.type === 'box' ? (it.label ?? '') : '')
    }
    for (const c of s.change) out.push(c.text ?? '', ...(c.items ?? []))
  }
  return out.filter(Boolean)
}

/** What is on the board after a step: items by id, in the order they were added. */
interface State {
  items: Map<string, BoardItem>
}

function cellsOf(state: State, ref: string): { row: Extract<BoardItem, { type: 'cells' }>; index: number } | null {
  const m = /^(.+)\.(\d+)$/.exec(ref)
  if (!m) return null
  const row = state.items.get(m[1])
  if (row?.type !== 'cells') return null
  const index = Number(m[2])
  return index < row.items.length ? { row, index } : null
}

function exists(state: State, ref: string): boolean {
  return state.items.has(ref) || cellsOf(state, ref) !== null
}

/** Apply one step. Throws with a plain reason the coach can fix. */
function apply(state: State, step: BoardStep, n: number): void {
  const at = `Step ${n + 1}`
  for (const id of step.remove) {
    if (!state.items.has(id)) throw new Error(`${at}: cannot remove "${id}", it is not on the board.`)
    state.items.delete(id)
    // Arrows to or from it go too.
    for (const [k, it] of state.items) if (it.type === 'arrow' && [it.from, it.to].some((r) => r === id || r.startsWith(`${id}.`))) state.items.delete(k)
  }
  if (step.add.length > BOARD_LIMITS.itemsPerStep) throw new Error(`${at}: at most ${BOARD_LIMITS.itemsPerStep} things per step.`)
  for (const it of step.add) {
    if (!ID.test(it.id)) throw new Error(`${at}: "${it.id}" is not a usable id (letters, digits, - or _; start with a letter).`)
    if (state.items.has(it.id)) throw new Error(`${at}: "${it.id}" is already on the board; use change instead.`)
    if (it.type === 'arrow') {
      for (const end of [it.from, it.to]) if (!exists(state, end)) throw new Error(`${at}: the arrow "${it.id}" points at "${end}", which is not on the board yet.`)
    } else {
      if (it.col < 0 || it.col >= BOARD_LIMITS.cols || it.row < 0 || it.row >= BOARD_LIMITS.rows) {
        throw new Error(`${at}: "${it.id}" is off the board (col and row go from 0 to ${BOARD_LIMITS.cols - 1}).`)
      }
      if (it.type === 'cells' && (it.items.length === 0 || it.items.length > BOARD_LIMITS.cells)) throw new Error(`${at}: a row has 1 to ${BOARD_LIMITS.cells} cells.`)
    }
    state.items.set(it.id, it)
  }
  for (const c of step.change) {
    const cell = cellsOf(state, c.id)
    const it = state.items.get(c.id)
    if (cell && c.text !== undefined) {
      const items = [...cell.row.items]
      items[cell.index] = c.text
      state.items.set(cell.row.id, { ...cell.row, items })
    } else if (it?.type === 'cells' && c.items) {
      if (c.items.length > BOARD_LIMITS.cells) throw new Error(`${at}: a row has at most ${BOARD_LIMITS.cells} cells.`)
      state.items.set(it.id, { ...it, items: c.items })
    } else if (it && c.text !== undefined && it.type !== 'cells') {
      state.items.set(it.id, it.type === 'arrow' ? { ...it, label: c.text } : { ...it, text: c.text })
    } else {
      throw new Error(`${at}: cannot change "${c.id}" (give text for a box, note, arrow or one cell like "${c.id}.0"; items for a row).`)
    }
  }
  for (const f of step.focus) if (!exists(state, f)) throw new Error(`${at}: cannot light up "${f}", it is not on the board.`)
  if (state.items.size > BOARD_LIMITS.itemsOnBoard) throw new Error(`${at}: at most ${BOARD_LIMITS.itemsOnBoard} things on the board at once.`)
}

/** Why a board cannot be drawn, or null. */
export function boardProblem(board: Board): string | null {
  if (board.steps.length === 0 || board.steps.length > BOARD_LIMITS.steps) return `A board has 1 to ${BOARD_LIMITS.steps} steps.`
  const state: State = { items: new Map() }
  try {
    board.steps.forEach((s, n) => apply(state, s, n))
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
  return null
}

// ── Layout ──────────────────────────────────────────────────────────

/** Grid unit in board pixels. */
export const COL = 150
export const ROW = 110
const BOX_H = 64
const CELL = 54
const LABEL_GAP = 22

/** One thing to draw, in board pixels. `lit`: changed or named in this step; `fresh`: added in this step. */
export type Drawn =
  | { kind: 'rect' | 'ellipse' | 'diamond'; id: string; x: number; y: number; w: number; h: number; text: string; lit: boolean; fresh: boolean }
  | { kind: 'text'; id: string; x: number; y: number; text: string; size: 'name' | 'note' | 'index'; lit: boolean; fresh: boolean }
  | { kind: 'arrow'; id: string; from: string; to: string; label?: string; lit: boolean; fresh: boolean }

/** The board as it stands after step `at` (0-based), laid out. Assumes a valid board (boardProblem is null). */
export function boardScene(board: Board, at: number): Drawn[] {
  const state: State = { items: new Map() }
  const last = Math.max(0, Math.min(at, board.steps.length - 1))
  for (let n = 0; n <= last; n++) apply(state, board.steps[n], n)
  const step = board.steps[last]
  const fresh = new Set(step.add.map((a) => a.id))
  const lit = new Set([...step.focus, ...step.change.map((c) => c.id), ...fresh])
  const isLit = (id: string) => lit.has(id) || (id.includes('.') && lit.has(id.slice(0, id.lastIndexOf('.'))))
  const isFresh = (id: string) => fresh.has(id) || (id.includes('.') && fresh.has(id.slice(0, id.lastIndexOf('.'))))

  const out: Drawn[] = []
  for (const it of state.items.values()) {
    if (it.type === 'arrow') continue
    const x = it.col * COL
    const y = it.row * ROW + LABEL_GAP
    if (it.type === 'note') {
      out.push({ kind: 'text', id: it.id, x, y: y + 16, text: it.text, size: 'note', lit: isLit(it.id), fresh: isFresh(it.id) })
      continue
    }
    if (it.label) out.push({ kind: 'text', id: `${it.id}~label`, x, y: y - LABEL_GAP, text: it.label, size: 'name', lit: isLit(it.id), fresh: isFresh(it.id) })
    if (it.type === 'box') {
      const kind = it.shape === 'circle' ? 'ellipse' : it.shape === 'diamond' ? 'diamond' : 'rect'
      const w = Math.max(1, Math.min(4, it.width ?? 1)) * COL - 30
      out.push({ kind, id: it.id, x, y, w, h: BOX_H, text: it.text, lit: isLit(it.id), fresh: isFresh(it.id) })
    } else {
      it.items.forEach((v, i) => {
        const id = `${it.id}.${i}`
        out.push({ kind: 'rect', id, x: x + i * CELL, y, w: CELL, h: CELL, text: v, lit: isLit(id), fresh: isFresh(id) })
        if (it.indexes !== false) out.push({ kind: 'text', id: `${id}~index`, x: x + i * CELL + CELL / 2 - 4, y: y + CELL + 4, text: String(i), size: 'index', lit: false, fresh: isFresh(id) })
      })
    }
  }
  // An arrow at a whole row points at its first cell (a row has no shape of its own).
  const end = (ref: string) => (state.items.get(ref)?.type === 'cells' ? `${ref}.0` : ref)
  for (const it of state.items.values()) {
    if (it.type === 'arrow') out.push({ kind: 'arrow', id: it.id, from: end(it.from), to: end(it.to), label: it.label, lit: isLit(it.id), fresh: isFresh(it.id) })
  }
  return out
}
