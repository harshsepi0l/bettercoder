// The coach pane beside the Code tab can be resized; the code always keeps room to work in.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_WIDTH, MIN_WIDTH, clampCoachWidth, maxCoachWidth, readWidth, startCoachDrag } from '../src/renderer/src/features/shell/coach-width'

test('coach width: stays between its minimum and what leaves the code 420 px', () => {
  assert.equal(maxCoachWidth(1400), 980)
  assert.equal(clampCoachWidth(600, 1400), 600)
  assert.equal(clampCoachWidth(2000, 1400), 980)
  assert.equal(clampCoachWidth(100, 1400), MIN_WIDTH)
  // A narrow row still gives the coach its minimum (the layout switches to tabs before this matters).
  assert.equal(maxCoachWidth(500), MIN_WIDTH)
  assert.equal(clampCoachWidth(400, 500), MIN_WIDTH)
})

test('coach width: without saved storage (tests, private windows) it starts at the default', () => {
  assert.equal(readWidth(), DEFAULT_WIDTH)
})

const at = (type: string, extra: Record<string, unknown> = {}) => Object.assign(new Event(type), extra)

// Regression: the drag's listeners were attached in an effect, after the next render. A press released before then
// was missed, the drag never ended, and its cover stayed up over the whole window (the app looked frozen).
test('coach drag: a press released at once still ends it; moves resize; Esc and losing focus end it too', () => {
  const win = new EventTarget()
  const widths: number[] = []
  let ended = 0
  startCoachDrag(win, { x: 600, width: 380 }, (w) => widths.push(w), () => ended++)
  win.dispatchEvent(at('pointerup'))
  assert.equal(ended, 1, 'released before any render: ended')

  startCoachDrag(win, { x: 600, width: 380 }, (w) => widths.push(w), () => ended++)
  win.dispatchEvent(at('pointermove', { clientX: 550 }))
  win.dispatchEvent(at('pointermove', { clientX: 650 }))
  win.dispatchEvent(at('keydown', { key: 'Escape' }))
  win.dispatchEvent(at('pointermove', { clientX: 100 }))
  win.dispatchEvent(at('pointerup'))
  assert.deepEqual(widths, [430, 330], 'left makes it wider; nothing after it ended')
  assert.equal(ended, 2, 'ended once')

  const stop = startCoachDrag(win, { x: 0, width: 400 }, () => undefined, () => ended++)
  win.dispatchEvent(at('blur'))
  stop()
  assert.equal(ended, 3)
})
