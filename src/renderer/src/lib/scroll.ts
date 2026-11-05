/** What `revealInBox` needs from the DOM (so it can be tested without one). */
interface Box {
  scrollTop: number
  clientHeight: number
  getBoundingClientRect(): { top: number }
  scrollTo?(options: { top: number; behavior?: 'smooth' | 'auto' }): void
}
interface Item {
  getBoundingClientRect(): { top: number; height: number }
}

/**
 * Scroll only `box` so `item` shows: `nearest` moves as little as needed, `center` puts it in the middle.
 * Unlike scrollIntoView it never scrolls anything around the box (regression: a playing animation kept pulling the
 * chat back to it while the learner scrolled away).
 */
export function revealInBox(box: Box, item: Item, where: 'nearest' | 'center' = 'nearest'): number {
  const b = box.getBoundingClientRect()
  const r = item.getBoundingClientRect()
  const top = r.top - b.top + box.scrollTop
  let next = box.scrollTop
  if (where === 'center') next = top - (box.clientHeight - r.height) / 2
  else if (top < box.scrollTop) next = top
  else if (top + r.height > box.scrollTop + box.clientHeight) next = top + r.height - box.clientHeight
  next = Math.max(0, Math.round(next))
  if (next !== box.scrollTop) {
    if (box.scrollTo) box.scrollTo({ top: next, behavior: 'smooth' })
    else box.scrollTop = next
  }
  return next
}
