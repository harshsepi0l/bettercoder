/**
 * Regression tests for real sessions: "Visualize" on a notebook produced a diagram,
 * not an animation (notebooks didn't count as Python, and the animator couldn't run
 * them); later, word-matching routing looped a session on the same card forever.
 * Intents now come only from buttons, as structured data.
 * Uses tests/fixtures (read-only).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai'
import type { ProjectInfo } from '../src/shared/ipc'
import type { TraceValue } from '../src/shared/trace'
import { findPython, runTrace } from '../src/main/engines/visualize/runner'
import { openCoach } from './helpers'

const NB_DIR = join(import.meta.dirname, 'fixtures', 'notebook')
const hasPython = !!(await findPython())
const hasNumpy = (() => {
  try {
    execFileSync('python3', ['-c', 'import numpy'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

/** A session opened on just the forest notebook, as the learner did. */
const forestOnly: ProjectInfo = {
  root: NB_DIR,
  name: 'forest.ipynb',
  stacks: ['Python'],
  manifests: [],
  languages: [{ name: 'Python', files: 1 }],
  fileCount: 1,
  git: null,
  files: ['forest.ipynb']
}

const cardsOf = (events: Array<{ type: string }>) =>
  events.flatMap((e) => (e.type === 'card' ? [(e as unknown as { card: { kind: string } }).card] : []))

test('a notebook runs top to bottom, and each step points at the right cell line', { skip: !hasPython }, async () => {
  const trace = await runTrace({ root: NB_DIR, file: 'forest.ipynb', scenario: [] })
  assert.equal(trace.stopped, undefined, trace.stopped)
  assert.deepEqual(trace.scenario, ['Run the whole file, top to bottom'])
  // Every step's line is a line of the notebook as the learner sees it (cells), not of a hidden .py.
  for (const s of trace.steps) assert.ok(trace.source[s.line - 1] !== undefined, `step at line ${s.line}`)
  const spreadLine = trace.steps.find((s) => s.func === 'spread' && trace.source[s.line - 1]?.includes('new[r][c] = EMPTY'))
  assert.ok(spreadLine, 'steps inside spread() map to its cell')
  // The magic line (%matplotlib) did not break the run.
  const last = trace.steps.at(-1)!
  assert.match(last.output, /\[\[0, 0, 2\], \[1, 1, 0\]\]/, 'the notebook really ran')
  const forest = last.frames.find((f) => f.func === 'top level')?.locals.find(([k]) => k === 'forest')?.[1] as TraceValue
  assert.ok(forest?.t === 'list' && forest.items.every((r) => r.t === 'list'), 'the grid is recorded as rows of cells')
})

test('NumPy arrays become labelled grids, and a cell error stops the run where it happened', { skip: !hasPython || !hasNumpy }, async () => {
  const trace = await runTrace({ root: NB_DIR, file: 'day17.ipynb', scenario: [] })
  const grid = trace.steps.at(-1)!.frames[0].locals.find(([k]) => k === 'grid')?.[1]
  assert.ok(grid && grid.t === 'list' && grid.label === 'array 3×3', JSON.stringify(grid))
  assert.match(trace.stopped ?? '', /IndexError/)
  const err = trace.steps.find((s) => s.event === 'exception')!
  assert.equal(trace.source[err.line - 1], 'grid[3]')
})

test('the Visualize button routes by intent: only reading, asking and the animator are offered', async () => {
  const { faux, session, events } = await openCoach(forestOnly)
  faux.setResponses([
    // A tool outside the Visualize set is not offered, so calling it gets no card.
    fauxAssistantMessage([fauxToolCall('show_step', { title: 'Plan', lines: [{ text: 'one' }, { text: 'two' }] })], { stopReason: 'toolUse' }),
    fauxAssistantMessage([fauxToolCall('ask_question', { question: 'Which part?', options: ['spread()', 'the whole notebook'] })], {
      stopReason: 'toolUse'
    })
  ])
  await session.send('Visualize my code running.', 'visualize')
  await session.waitForIdle()
  const kinds = cardsOf(events).map((c) => c.kind)
  assert.ok(!kinds.includes('step'), `show_step must not be offered during Visualize: ${JSON.stringify(kinds)}`)
  assert.ok(kinds.includes('question'), 'asking which part is allowed')
})

test('typing the word "visualize" is not force-routed: the model keeps every tool', async () => {
  const { faux, session, events } = await openCoach(forestOnly)
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall('show_step', { title: 'Plan', lines: [{ text: 'read spread' }, { text: 'trace one step' }] })], { stopReason: 'toolUse' }),
    fauxAssistantMessage('**Try it**')
  ])
  await session.send('can u visualize 3?')
  await session.waitForIdle()
  assert.equal(faux.state.callCount, 1, 'the model was called; the card ends the turn')
  assert.ok(cardsOf(events).some((c) => c.kind === 'step'), 'all tools available for typed text')
})

test('after a Visualize run, the next typed message gets every tool back', async () => {
  const { faux, session, events } = await openCoach(forestOnly)
  faux.setResponses([fauxAssistantMessage('**Pick a part**')])
  await session.send('Visualize my code running.', 'visualize')
  await session.waitForIdle()
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall('show_step', { title: 'Next', lines: [{ text: 'a step' }, { text: 'another' }] })], { stopReason: 'toolUse' }),
    fauxAssistantMessage('**Go**')
  ])
  await session.send('what should I check?')
  await session.waitForIdle()
  assert.ok(cardsOf(events).some((c) => c.kind === 'step'))
})

test('answering "all of the notebook" ends in a real animation, not a diagram', { skip: !hasPython }, async () => {
  const { faux, session, events } = await openCoach(forestOnly)
  faux.setResponses([
    fauxAssistantMessage(
      [fauxToolCall('animate_code', { file: 'forest.ipynb', title: 'Fire spreading', note: 'Watch forest change each step' })],
      { stopReason: 'toolUse' }
    ),
    fauxAssistantMessage('**Step through the loop**')
  ])
  await session.send('Animate all of forest.ipynb, top to bottom', 'visualize')
  await session.waitForIdle()
  const kinds = cardsOf(events).map((c) => c.kind)
  assert.ok(kinds.includes('animation'), `got ${JSON.stringify(kinds)}`)
  assert.ok(!kinds.includes('diagram'))
})

test('while visualizing, the coach may still ask a question', async () => {
  const { faux, session, events } = await openCoach(forestOnly)
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall('ask_question', { question: 'Which step?', options: ['the first', 'the second'] })], {
      stopReason: 'toolUse'
    })
  ])
  await session.send('animate spread()', 'visualize')
  await session.waitForIdle()
  assert.ok(cardsOf(events).some((c) => c.kind === 'question'))
})

test('an unfinished cell is skipped (like Jupyter), notebook helpers and sleeps do not stop the run', { skip: !hasPython }, async () => {
  const started = Date.now()
  const trace = await runTrace({ root: NB_DIR, file: 'unfinished.ipynb', scenario: [] })
  assert.ok(Date.now() - started < 8000, 'time.sleep(5) x3 is skipped while recording')
  const skipped = trace.steps.find((s) => s.exception?.includes('this cell was skipped'))
  assert.ok(skipped, 'the stub cell is reported')
  assert.equal(trace.source[skipped.line - 1], 'def make_grid(....):')
  assert.match(trace.steps.at(-1)!.output, /^3\n?$/m, 'the cells after the stub still ran')
  assert.equal(trace.stopped, undefined, 'YouTubeVideo and display() did not stop it')
})
