import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai'
import type { HarnessEvent } from '../src/shared/harness'
import type { ProjectInfo } from '../src/shared/ipc'
import { openCoach } from './helpers'

const IDEA: ProjectInfo = { root: '', name: 'how do i serialize data', stacks: [], manifests: [], languages: [], fileCount: 0, git: null }
const fixture = (name: string) => readFileSync(join(import.meta.dirname, 'fixtures', 'examples', name), 'utf8')
const cards = (events: HarnessEvent[]) => events.flatMap((e) => (e.type === 'card' ? [e.card] : []))

/**
 * Regression (real session, 2026-11-04: "how do i serialize data in python?"): the coach could only draw a diagram.
 * It now runs a small hidden example in the animator, even with no project folder; the window gets the variables and
 * output, never the coach's code.
 */
test('animate_example: a hidden example runs in the animator and its code never reaches the window', async () => {
  const { faux, session, events } = await openCoach(IDEA)
  const python = fixture('serialize.py')
  let result = ''
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall('animate_example', { python, title: 'A dict becomes text and back', note: 'Watch person turn into text' })], {
      stopReason: 'toolUse'
    }),
    (ctx) => {
      const last = ctx.messages.at(-1) as { role: string; content: Array<{ text?: string }> }
      result = last.content[0]?.text ?? ''
      return fauxAssistantMessage('**Text goes over the wire**')
    }
  ])
  await session.send('how do i serialize data in python?')
  await session.waitForIdle()
  const card = cards(events).find((c) => c.kind === 'animation')
  assert.ok(card && card.kind === 'animation', `an animation card (tool said: ${result})`)
  assert.equal(card.trace.example, true)
  assert.deepEqual(card.trace.source, [], 'no source sent to the window')
  const sent = JSON.stringify(events)
  assert.doesNotMatch(sent, /json\.dumps/, 'the code is nowhere in what the window gets')
  assert.equal(card.trace.steps.at(-1)?.output.trim(), '{"name": "Ada", "age": 36}', 'the serialized text is shown as data')
  assert.match(result, /hidden/)
})

test('animate_example: an example that prints code is sent back to the coach', async () => {
  const { faux, session, events } = await openCoach(IDEA)
  let error = ''
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall('animate_example', { python: fixture('prints-code.py'), title: 'Sneaky', note: 'x' })], { stopReason: 'toolUse' }),
    (ctx) => {
      const last = ctx.messages.at(-1) as { role: string; content: Array<{ text?: string }> }
      error = last.content[0]?.text ?? ''
      return fauxAssistantMessage('**Try again**')
    }
  ])
  await session.send('show me')
  await session.waitForIdle()
  assert.match(error, /shows code/)
  assert.equal(cards(events).filter((c) => c.kind === 'animation').length, 0)
})

test('animate_example: only steps that change something on screen are kept (regression: empty and repeated steps)', async () => {
  const { visibleSteps } = await import('../src/shared/example-steps')
  const step = (locals: Array<[string, number]>, output = '') => ({
    event: 'line' as const,
    file: 'example.py',
    line: 1,
    func: 'top level',
    frames: [{ func: 'top level', locals: locals.map(([n, v]) => [n, { t: 'num' as const, v }] as [string, { t: 'num'; v: number }]) }],
    output,
    scenarioStep: 0
  })
  const kept = visibleSteps([step([]), step([]), step([['a', 1]]), step([['a', 1]]), step([['a', 1]], 'hi\n'), step([['a', 2]], 'hi\n'), step([['a', 2]], 'hi\n')])
  assert.deepEqual(
    kept.map((s) => [s.frames[0].locals.map(([, v]) => (v as { v: number }).v), s.output]),
    [
      [[1], ''],
      [[1], 'hi\n'],
      [[2], 'hi\n']
    ]
  )
})

/** Regression (2026-11-04, serialize example): going back to steps 1-2 dropped `text` from the box, and step 1 lit nothing. */
test('example player: values made later stay in the box (empty until made), and step 1 lights what it made', async () => {
  const { changedNames, localsWithPending } = await import('../src/shared/example-steps')
  const v = (n: number) => ({ t: 'num' as const, v: n })
  const step = (locals: Array<[string, ReturnType<typeof v>]>) => ({
    event: 'line' as const,
    file: 'example',
    line: 1,
    func: 'top level',
    frames: [{ func: 'top level', locals }],
    output: '',
    scenarioStep: 0
  })
  const steps = [step([['person', v(1)]]), step([['person', v(1)]]), step([['person', v(1)], ['text', v(2)]])]
  assert.deepEqual(localsWithPending(steps, 0, steps[0].frames[0]), [
    ['person', v(1)],
    ['text', undefined]
  ])
  assert.deepEqual([...changedNames(undefined, steps[0])], ['0:person'])
  assert.deepEqual([...changedNames(steps[1], steps[2])], ['0:text'])
})

/** Regression (2026-11-04): scrollIntoView scrolled the whole chat back to a playing animation. */
test('player scrolling: only the animator box moves, by as little as needed', async () => {
  const { revealInBox } = await import('../src/renderer/src/lib/scroll')
  const box = (scrollTop: number) => ({ scrollTop, clientHeight: 100, getBoundingClientRect: () => ({ top: 500 }) })
  // An item at content offset 150 (below the visible 0..100): scroll just enough to show it.
  const at = (offset: number, b: { scrollTop: number }) => ({ getBoundingClientRect: () => ({ top: 500 + offset - b.scrollTop, height: 20 }) })
  const b1 = box(0)
  assert.equal(revealInBox(b1, at(150, b1)), 70)
  assert.equal(b1.scrollTop, 70, 'the box itself scrolled; nothing else was touched')
  const b2 = box(40)
  assert.equal(revealInBox(b2, at(60, b2)), 40, 'already visible: no move')
  const b3 = box(0)
  assert.equal(revealInBox(b3, at(300, b3), 'center'), 260)
})
