// Coach modes (2026-11-13): Chat, Tasks, Visualize, Map and Sources sit at the top of the coach pane. A message sent
// from a mode other than Chat carries it as a tag (structured UI state, never guessed from words); the learner never sees it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { fauxAssistantMessage, fauxText, fauxToolCall } from '@earendil-works/pi-ai'
import type { ProjectInfo } from '../src/shared/ipc'
import type { HarnessEvent } from '../src/shared/harness'
import { readIntent, readMode, stripIntent, withIntent, withMode } from '../src/main/coach/turn'
import { turnReminder } from '../src/main/coach/prompts'
import { openCoach } from './helpers'

const root = join(import.meta.dirname, 'fixtures', 'session-check', 'calculator')
const project: ProjectInfo = { root, name: 'MathCalculator', stacks: ['C#'], manifests: ['MathCalculator.csproj'], languages: [{ name: 'C#', files: 1 }], fileCount: 2, git: null }

test('a mode tag rides with the message, beside an intent, and is taken off what the learner sees', () => {
  const both = withIntent(withMode('why 11?', 'visualize'), 'stuck')
  assert.equal(readMode(both), 'visualize')
  assert.equal(readIntent(both), 'stuck')
  assert.equal(stripIntent(both), 'why 11?')
  // Chat is the default: no tag at all, so a plain message stays byte-for-byte what it was before modes.
  assert.equal(withMode('hi', 'chat'), 'hi')
  assert.equal(readMode('hi'), null)
  // A mode word typed by the learner is just words.
  assert.equal(readMode('show me the map'), null)
})

test('the reminder names the mode, but the Visualize button already says to draw', () => {
  assert.match(turnReminder(null, false, 'map'), /on the Map of their project/)
  assert.match(turnReminder(null, false, 'tasks'), /on Tasks/)
  assert.doesNotMatch(turnReminder(null, false, 'chat'), /They are on/)
  assert.doesNotMatch(turnReminder('visualize', false, 'visualize'), /They are on Visualize/)
})

test('a message sent from Visualize must be drawn: other cards are blocked, and the chat shows only their words', async () => {
  const { faux, session, events } = await openCoach(project)
  let blocked = ''
  faux.setResponses([
    fauxAssistantMessage([fauxText('**Here is the step**'), fauxToolCall('show_step', { title: 'T', lines: [{ text: 'a ← read a line' }] })], { stopReason: 'toolUse' }),
    (ctx) => {
      blocked = JSON.stringify((ctx as { messages: unknown[] }).messages.at(-1))
      return fauxAssistantMessage(
        [fauxToolCall('draw_board', { title: 'Sum', note: 'n', steps: [{ say: 'start', add: [{ type: 'box', id: 's', label: 's', text: '0', col: 1, row: 1 }] }] })],
        { stopReason: 'toolUse' }
      )
    },
    fauxAssistantMessage('**Drawn**')
  ])
  await session.send('why does it print 11?', undefined, 'visualize')
  await session.waitForIdle()
  assert.match(blocked, /on Visualize: draw it with draw_board/)
  const cards = events.flatMap((e: HarnessEvent) => (e.type === 'card' ? [e.card.kind] : []))
  assert.deepEqual(cards, ['board'])
  const said = events.flatMap((e: HarnessEvent) => (e.type === 'user' ? [e.text] : []))
  assert.deepEqual(said, ['why does it print 11?'])
})
