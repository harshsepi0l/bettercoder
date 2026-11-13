import { boardScene, type Board, type Drawn } from '../../src/shared/board'

/** Font sizes and the width rule the canvas uses (features/visualize/board-elements.ts). */
const FONT = { name: 16, note: 18, index: 13 } as const
const textWidth = (text: string, size: number) => Math.max(...text.split('\n').map((l) => l.length)) * size * 0.55

interface Rect { id: string; x: number; y: number; w: number; h: number }

function rectOf(d: Exclude<Drawn, { kind: 'arrow' }>): Rect {
  if (d.kind === 'text') return { id: d.id, x: d.x, y: d.y, w: textWidth(d.text, FONT[d.size]), h: FONT[d.size] * 1.4 * d.text.split('\n').length }
  return { id: d.id, x: d.x, y: d.y, w: d.w, h: d.h }
}

/** The thing a drawn piece belongs to: "nums.2~index" and "nums.2" belong to "nums"; "total~label" to "total". */
const owner = (id: string) => id.split('~')[0].split('.')[0]

/** Pairs of things on the finished board that cover each other (a piece and its own label or cells never count). */
export function boardOverlaps(board: Board): string[] {
  const drawn = boardScene(board, board.steps.length - 1).filter((d): d is Exclude<Drawn, { kind: 'arrow' }> => d.kind !== 'arrow')
  const rects = drawn.map(rectOf)
  const out: string[] = []
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i]
      const b = rects[j]
      if (owner(a.id) === owner(b.id)) continue
      const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
      const iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
      if (ix > 4 && iy > 4) out.push(`${owner(a.id)} × ${owner(b.id)}`)
    }
  }
  return [...new Set(out)]
}
