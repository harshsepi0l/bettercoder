/** The coach pane's width beside the Code tab: its bounds and where it is remembered (this computer only). */

const WIDTH_KEY = 'bettercoder.coachWidth'
export const DEFAULT_WIDTH = 380
export const MIN_WIDTH = 300
/** The code beside it always keeps at least this much. */
const MIN_CODE = 420
export const STEP = 16

export function readWidth(): number {
  try {
    const v = Number(localStorage.getItem(WIDTH_KEY))
    return Number.isFinite(v) && v >= MIN_WIDTH ? v : DEFAULT_WIDTH
  } catch {
    return DEFAULT_WIDTH
  }
}

export function saveWidth(width: number): void {
  try {
    localStorage.setItem(WIDTH_KEY, String(Math.round(width)))
  } catch {
    // Remembering the width is a convenience only.
  }
}

/** The widest the coach may be in a row this wide. */
export function maxCoachWidth(rowWidth: number): number {
  return Math.max(MIN_WIDTH, rowWidth - MIN_CODE)
}

export function clampCoachWidth(width: number, rowWidth: number): number {
  return Math.min(Math.max(width, MIN_WIDTH), maxCoachWidth(rowWidth))
}

/**
 * Follow a drag of the coach's handle on `target` (the window): `apply` gets each new width, `done` runs once when it
 * ends (release, cancel, the window losing focus, Esc). The listeners go on at once, so even a press released before
 * the next render ends the drag. Returns a function that ends it early.
 */
export function startCoachDrag(
  target: EventTarget,
  start: { x: number; width: number },
  apply: (width: number) => void,
  done: () => void
): () => void {
  let live = true
  // The handle is on the coach's left edge: moving left makes the coach wider.
  const move = (e: Event) => {
    if (live) apply(start.width + (start.x - (e as PointerEvent).clientX))
  }
  const key = (e: Event) => {
    if ((e as KeyboardEvent).key === 'Escape') end()
  }
  const end = () => {
    if (!live) return
    live = false
    target.removeEventListener('pointermove', move)
    target.removeEventListener('pointerup', end)
    target.removeEventListener('pointercancel', end)
    target.removeEventListener('blur', end)
    target.removeEventListener('keydown', key)
    done()
  }
  target.addEventListener('pointermove', move)
  target.addEventListener('pointerup', end)
  target.addEventListener('pointercancel', end)
  target.addEventListener('blur', end)
  target.addEventListener('keydown', key)
  return end
}
