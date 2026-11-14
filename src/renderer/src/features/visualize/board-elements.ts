import type { Drawn } from '../../../../shared/board'

/**
 * The whiteboard's look: board shapes (shared/board.ts) as Excalidraw element skeletons. Kept free of Excalidraw
 * itself so it can be tested; the font ids are Excalidraw's own numbers (5 = Excalifont, the hand-drawn one).
 */

const EXCALIFONT = 5

/** Excalidraw takes raw colours, so the theme's are repeated here (globals.css): one set per app theme. */
export const BOARD_THEMES = {
  dark: { background: '#0f0f10', stroke: '#77777a', fill: '#171718', text: '#f4f2ed', name: '#8f8f8a', litStroke: '#c0394b', litFill: '#24141a', litText: '#ec7480' },
  light: { background: '#ffffff', stroke: '#8a8a8f', fill: '#f6f6f4', text: '#1c1c1e', name: '#66666b', litStroke: '#8b1e2d', litFill: '#fbf1f2', litText: '#8b1e2d' }
} as const
export type BoardTheme = keyof typeof BOARD_THEMES

const FONT = { name: 16, note: 18, index: 13, value: 18 } as const

/** Rough width of a hand-drawn line of text, for framing the board (Excalidraw measures the real one). */
function textWidth(text: string, size: number): number {
  return Math.max(...text.split('\n').map((l) => l.length)) * size * 0.55
}

/** What the camera should take in: every shape of the board (the last step, so it never moves while playing). */
export function boardBounds(drawn: readonly Drawn[]): { x: number; y: number; w: number; h: number } {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const d of drawn) {
    if (d.kind === 'arrow') continue
    const w = d.kind === 'text' ? textWidth(d.text, FONT[d.size]) : d.w
    const h = d.kind === 'text' ? FONT[d.size] * 1.4 * d.text.split('\n').length : d.h
    x0 = Math.min(x0, d.x)
    y0 = Math.min(y0, d.y)
    x1 = Math.max(x1, d.x + w)
    y1 = Math.max(y1, d.y + h)
  }
  return Number.isFinite(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : { x: 0, y: 0, w: 1, h: 1 }
}


/**
 * Excalidraw skeletons for a board step. `fade` (0 to 1) is how far the things added in this step have appeared.
 * Plain objects: the caller passes them to Excalidraw's convertToExcalidrawElements.
 */
export function boardSkeletons(drawn: readonly Drawn[], fade = 1, theme: BoardTheme = 'dark'): Array<Record<string, unknown>> {
  const BOARD_COLORS = BOARD_THEMES[theme]
  const opacity = (fresh: boolean) => (fresh ? Math.round(100 * fade) : 100)
  // Arrows start at the middle of one shape and end at the middle of the other; Excalidraw moves the ends to the edges.
  const middle = new Map<string, [number, number]>()
  const shapes = new Set(drawn.filter((d) => d.kind !== 'arrow' && d.kind !== 'text').map((d) => d.id))
  for (const d of drawn) if (d.kind !== 'arrow' && d.kind !== 'text') middle.set(d.id, [d.x + d.w / 2, d.y + d.h / 2])
  for (const d of drawn) if (d.kind === 'text') middle.set(d.id, [d.x + textWidth(d.text, FONT[d.size]) / 2, d.y + FONT[d.size] * 0.7])
  return drawn.map((d) => {
    const common = { id: d.id, roughness: 1, strokeWidth: d.lit ? 2 : 1, opacity: opacity(d.fresh), locked: true }
    switch (d.kind) {
      case 'text':
        return {
          ...common,
          type: 'text',
          x: d.x,
          y: d.y,
          text: d.text,
          fontSize: FONT[d.size],
          fontFamily: EXCALIFONT,
          strokeColor: d.lit ? BOARD_COLORS.litText : d.size === 'note' ? BOARD_COLORS.text : BOARD_COLORS.name
        }
      case 'arrow': {
        const [x, y] = middle.get(d.from) ?? [0, 0]
        const [tx, ty] = middle.get(d.to) ?? [x + 1, y]
        return {
          ...common,
          type: 'arrow',
          x,
          y,
          points: [
            [0, 0],
            [tx - x, ty - y]
          ],
          strokeColor: d.lit ? BOARD_COLORS.litStroke : BOARD_COLORS.stroke,
          // Excalidraw binds arrows to shapes only; at a note, the arrow just ends there.
          ...(shapes.has(d.from) ? { start: { id: d.from } } : {}),
          ...(shapes.has(d.to) ? { end: { id: d.to } } : {}),
          ...(d.label ? { label: { text: d.label, fontSize: FONT.name, fontFamily: EXCALIFONT, strokeColor: d.lit ? BOARD_COLORS.litText : BOARD_COLORS.name } } : {})
        }
      }
      default:
        return {
          ...common,
          type: d.kind === 'rect' ? 'rectangle' : d.kind,
          x: d.x,
          y: d.y,
          width: d.w,
          height: d.h,
          strokeColor: d.lit ? BOARD_COLORS.litStroke : BOARD_COLORS.stroke,
          backgroundColor: d.lit ? BOARD_COLORS.litFill : BOARD_COLORS.fill,
          fillStyle: 'solid',
          roundness: d.kind === 'rect' ? { type: 3 } : null,
          label: { text: d.text, fontSize: FONT.value, fontFamily: EXCALIFONT, strokeColor: d.lit ? BOARD_COLORS.litText : BOARD_COLORS.text }
        }
    }
  })
}
