import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from '@earendil-works/pi-ai'
import type { HarnessEvent } from '../src/shared/harness'
import type { ProjectInfo } from '../src/shared/ipc'
import { openCoach } from './helpers'
import { cardProblem, mermaidLabels } from '../src/main/coach/tools/cards'

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'bc-cards-'))
  await writeFile(
    join(root, 'todos.py'),
    ['class TodoList:', '    def remove(self, number):', '        if number < 1:', '            raise IndexError()', '        del self.items[number]', ''].join('\n')
  )
  const project: ProjectInfo = { root, name: 'todo', stacks: ['Python'], manifests: [], languages: [{ name: 'Python', files: 1 }], fileCount: 1, git: null }
  return openCoach(project)
}

const cards = (events: HarnessEvent[]) => events.flatMap((e) => (e.type === 'card' ? [e.card] : []))

test('a question card is shown and ends the turn to wait for the learner', async () => {
  const { faux, session, events } = await setup()
  faux.setResponses([
    fauxAssistantMessage(
      [fauxText('Let me check one thing.'), fauxToolCall('ask_question', { question: 'Where does a Python list start counting?', options: ['At 0', 'At 1'] })],
      { stopReason: 'toolUse' }
    ),
    fauxAssistantMessage('this should never be requested')
  ])
  await session.send('remove deletes the wrong item')
  await session.waitForIdle()
  const shown = cards(events)
  assert.equal(shown.length, 1)
  assert.equal(shown[0].kind, 'question')
  assert.equal(faux.state.callCount, 1, 'the turn must stop at the question')
})

// Real session (Grok, .NET calculator): cards batched with ask_question did not end the turn, so the coach
// answered its own questions for 10 rounds without the learner ever clicking.
test('a question batched with other cards still ends the turn', async () => {
  const { faux, session, events } = await setup()
  faux.setResponses([
    fauxAssistantMessage(
      [
        fauxText('**Replace Hello World with input**'),
        fauxToolCall('show_diagram', { title: 'Input flow', mermaid: 'flowchart LR\n  A[Prompt] --> B[Read the line]' }),
        fauxToolCall('point_to_code', { path: 'todos.py', start_line: 2, end_line: 3, note: 'Where the number arrives' }),
        fauxToolCall('ask_question', { question: 'Ready to try step 1 yourself?', options: ['I will write it now', 'Show a tiny hint'] })
      ],
      { stopReason: 'toolUse' }
    ),
    fauxAssistantMessage('this should never be requested')
  ])
  await session.send('What should I do next?')
  await session.waitForIdle()
  assert.deepEqual(cards(events).map((c) => c.kind).sort(), ['code_ref', 'diagram', 'question'])
  assert.equal(faux.state.callCount, 1, 'the turn must stop at the question')
})

test('a card ends the turn: no extra model call that only repeats the headline', async () => {
  const { faux, session } = await setup()
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall('show_step', { title: 'Plan', lines: [{ text: 'look at remove' }, { text: 'check the index' }] })], { stopReason: 'toolUse' }),
    fauxAssistantMessage('Have a look.')
  ])
  await session.send('where is the bug?')
  await session.waitForIdle()
  assert.equal(faux.state.callCount, 1)
})

test('point_to_code shows the learner\'s own lines with the focus line', async () => {
  const { faux, session, events } = await setup()
  faux.setResponses([
    fauxAssistantMessage(
      [fauxToolCall('point_to_code', { path: 'todos.py', start_line: 2, end_line: 5, focus_line: 5, note: 'Which position does this delete when number is 1?' })],
      { stopReason: 'toolUse' }
    ),
    fauxAssistantMessage('Have a look.')
  ])
  await session.send('where is the bug?')
  await session.waitForIdle()
  const ref = cards(events).find((c) => c.kind === 'code_ref')
  assert.ok(ref && ref.kind === 'code_ref')
  assert.equal(ref.focusLine, 5)
  assert.equal(ref.lines.at(-1), '        del self.items[number]', 'their own line, read from disk')
})

test('strict: a card containing code is rejected and never shown; the model is told why', async () => {
  const { faux, session, events } = await setup()
  let toolError = ''
  faux.setResponses([
    fauxAssistantMessage(
      [fauxToolCall('show_step', { title: 'Fix', idea: { term: 'Off by one', explanation: 'Change line 5 to `del self.items[number - 1]`' }, lines: [{ text: 'run the tests' }] })],
      { stopReason: 'toolUse' }
    ),
    (context) => {
      const r = context.messages.filter((m) => m.role === 'toolResult').at(-1)
      toolError = r && r.role === 'toolResult' ? JSON.stringify(r.content) : ''
      return fauxAssistantMessage(
        [fauxToolCall('show_step', { title: 'Try this', lines: [{ text: 'compare the number they type with the list position' }, { text: 'run the tests again' }] })],
        { stopReason: 'toolUse' }
      )
    },
    fauxAssistantMessage('Your turn.')
  ])
  await session.send('just tell me the fix')
  await session.waitForIdle()
  const shown = cards(events)
  assert.equal(shown.length, 1)
  assert.ok(!JSON.stringify(shown).includes('number - 1'))
  assert.match(toolError, /plain words/)
})

test('diagram labels are checked, and links or directives are refused', () => {
  assert.deepEqual(mermaidLabels('flowchart LR\n  A[You type 1] --> B[List position 0]'), ['You type 1', 'List position 0'])
  assert.equal(
    cardProblem({ kind: 'diagram', title: 'Indexes', mermaid: 'flowchart LR\n A[You type 1] --> B[Position 0 in the list]' }),
    null
  )
  assert.match(
    cardProblem({ kind: 'diagram', title: 'Fix', mermaid: 'flowchart LR\n A[del self.items(number - 1);] --> B[done]' }) ?? '',
    /looks like code/
  )
})

test('a diagram with a click handler is refused', async () => {
  const { faux, session, events } = await setup()
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall('show_diagram', { title: 'x', mermaid: 'flowchart LR\n A-->B\n click A "https://evil.example"' })], {
      stopReason: 'toolUse'
    }),
    fauxAssistantMessage('ok')
  ])
  await session.send('draw it')
  await session.waitForIdle()
  assert.equal(cards(events).length, 0)
})

test('the Visualize button ends in a whiteboard, even if the model first answers in words', async () => {
  const { faux, session, events } = await setup()
  faux.setResponses([
    fauxAssistantMessage('**remove() deletes by position**\n- It uses the number directly'),
    fauxAssistantMessage(
      [
        fauxToolCall('draw_board', {
          title: 'What remove(1) deletes',
          note: 'Watch which cell goes',
          steps: [
            { say: 'Your list has three things', add: [{ type: 'cells', id: 'items', label: 'items', items: ['"milk"', '"eggs"', '"tea"'], col: 0, row: 0 }] },
            { say: 'number is 1, so position 1 goes', add: [{ type: 'box', id: 'number', label: 'number', text: '1', col: 0, row: 2 }, { type: 'arrow', id: 'at', from: 'number', to: 'items.1' }] },
            { say: 'eggs is gone, not milk', change: [{ id: 'items', items: ['"milk"', '"tea"'] }], remove: ['at'] }
          ]
        })
      ],
      { stopReason: 'toolUse' }
    ),
    fauxAssistantMessage('**Step to the end**')
  ])
  await session.send('Draw what my code does on the whiteboard.', 'visualize')
  await session.waitForIdle()
  const board = cards(events).find((c) => c.kind === 'board')
  assert.ok(board && board.kind === 'board', 'a whiteboard card should be shown')
  assert.equal(board.board.steps.length, 3)
  // The words came first, so the coach was nudged once to draw: words, board, and the card ends the turn.
  assert.equal(faux.state.callCount, 2)
})

test('the whiteboard refuses code in its words, and anything that points at nothing; data values are fine', () => {
  const board = (say: string, text: string) => ({ kind: 'board' as const, title: 't', note: 'n', board: { steps: [{ say, add: [{ type: 'box' as const, id: 'a', text, col: 0, row: 0 }], change: [], remove: [], focus: [] }] } })
  assert.equal(cardProblem(board('a list of numbers', '[1, 2, 3]')), null)
  assert.equal(cardProblem(board('a dict', "{'a': 1}")), null)
  assert.match(cardProblem(board('the loop', 'for i in range(10):')) ?? '', /code/)
  assert.match(cardProblem(board('total = total + n', '5')) ?? '', /code/)
})

// Regression: a real Grok session sent point_to_code without a note; the call failed and cost a whole round.
test('point_to_code works without a note', async () => {
  const { faux, session, events } = await setup()
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall('point_to_code', { path: 'todos.py', start_line: 2, end_line: 4, focus_line: 3 })], { stopReason: 'toolUse' }),
    fauxAssistantMessage('Have a look.')
  ])
  await session.send('where is the bug?')
  await session.waitForIdle()
  const ref = cards(events).find((c) => c.kind === 'code_ref')
  assert.ok(ref && ref.kind === 'code_ref')
  assert.equal(ref.note, undefined)
  assert.equal(ref.focusLine, 3)
})

test('chat: everything the coach says between two learner messages is one coach card', async () => {
  const { coachTurns } = await import('../src/shared/chat')
  const kinds = ['user', 'assistant', 'card', 'tool', 'card', 'user', 'user', 'assistant', 'notice']
  assert.deepEqual(
    coachTurns(kinds.map((kind) => ({ kind }))),
    [
      { from: 0, to: 1, user: true },
      { from: 1, to: 5, user: false },
      { from: 5, to: 6, user: true },
      { from: 6, to: 7, user: true },
      { from: 7, to: 9, user: false }
    ]
  )
})

test('visualize tab: lists every whiteboard the coach drew in the session, oldest first; old animations are left out', async () => {
  const { boardsFromChat } = await import('../src/shared/chat')
  const board = (title: string) => ({ kind: 'board' as const, title, note: 'n', board: { steps: [{ say: 's', add: [], change: [], remove: [], focus: [] }] } })
  const items = [
    { kind: 'user' as const, id: 'u', text: 'how?' },
    { kind: 'card' as const, id: 'a', card: board('first') },
    { kind: 'card' as const, id: 'old', card: { kind: 'animation' as const, title: 'from the old animator', note: 'n' } },
    { kind: 'card' as const, id: 'b', card: board('second') }
  ]
  assert.deepEqual(boardsFromChat(items).map((a) => [a.id, a.card.title]), [
    ['a', 'first'],
    ['b', 'second']
  ])
})

test('tabs: an idea has no Map or Tasks; Visualize (the whiteboard) is always open', async () => {
  const { lockedSections } = await import('../src/shared/chat')
  assert.deepEqual(lockedSections(true), ['map', 'tasks'])
  assert.deepEqual(lockedSections(false), [])
})
