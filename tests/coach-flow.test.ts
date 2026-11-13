// The real broken session (Grok, .NET MathCalculator): the coach answered its own questions for
// 10 rounds, every question card stayed greyed out, the Python animator was offered for C#, and each file
// read came with a "Checking your Program.cs" bubble.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { fauxAssistantMessage, fauxText, fauxToolCall } from '@earendil-works/pi-ai'
import { applyEvent, questionStates, type ChatItem } from '../src/shared/chat'
import type { ProjectInfo } from '../src/shared/ipc'
import { coachPrompt } from '../src/main/coach/prompts'
import { openCoach } from './helpers'
import { itemsFromEntries } from '../src/main/coach/replay'

const root = join(import.meta.dirname, 'fixtures', 'dotnet-calculator')
const project: ProjectInfo = {
  root,
  name: 'MathCalculator',
  stacks: ['C#'],
  manifests: ['MathCalculator.csproj'],
  languages: [{ name: 'C#', files: 1 }],
  fileCount: 2,
  git: null
}

type Req = { messages: Array<{ role: string; toolsAdded?: Array<{ name: string }> }> }
const offered = (ctx: unknown) => (ctx as Req).messages.flatMap((m) => (m.role === 'system' ? (m.toolsAdded ?? []).map((t) => t.name) : []))

test('a C# project is offered the whiteboard (it needs no runner), and the prompt names it', async () => {
  const { faux, session } = await openCoach(project)
  const seen: unknown[] = []
  faux.setResponses([(ctx) => (seen.push(ctx), fauxAssistantMessage('**Start with input**'))])
  await session.send('What should I do next?', 'next')
  await session.waitForIdle()
  assert.ok(offered(seen[0]).includes('draw_board'))
  assert.ok(!offered(seen[0]).some((t) => t.startsWith('animate_')))
  assert.match(coachPrompt(project), /draw_board/)
  assert.doesNotMatch(coachPrompt(project), /animate_/)
})

test('cards and a question in one reply wait for the learner', async () => {
  const { faux, session } = await openCoach(project)
  faux.setResponses([
    fauxAssistantMessage(
      [
        fauxText('**Replace Hello World with input**'),
        fauxToolCall('show_diagram', { title: 'Input flow', mermaid: 'flowchart LR\n  A[Prompt] --> B[Read the line]' }),
        fauxToolCall('point_to_code', { path: 'Program.cs', start_line: 1, end_line: 2, note: 'This line still runs' }),
        fauxToolCall('ask_question', { question: 'Ready to try step 1 yourself?', options: ["I'll write it now", 'Show a tiny hint'] })
      ],
      { stopReason: 'toolUse' }
    ),
    fauxAssistantMessage('**Hint: prompt then read** (the model answering its own question)')
  ])
  await session.send('Simple console calculator')
  await session.waitForIdle()
  assert.equal(faux.state.callCount, 1)
})

const q = (id: string, options = ['a', 'b']): ChatItem => ({ kind: 'card', id, card: { kind: 'question', question: id, options, allowOther: true } })
const user = (id: string, text: string): ChatItem => ({ kind: 'user', id, text })

test('only the latest question can be answered; earlier unanswered ones stay closed', () => {
  // As stored after the runaway: one answer, then many questions with none in between.
  const items: ChatItem[] = [user('u1', 'What next?'), q('q1', ['Simple console calculator', 'Class with methods (OOP)']), user('u2', 'Simple console calculator'), q('q2'), q('q3'), q('q4')]
  const s = questionStates(items)
  assert.deepEqual(s.get('q1'), { answer: 'Simple console calculator', answerIndex: 2, open: false })
  assert.deepEqual(s.get('q2'), { open: false })
  assert.deepEqual(s.get('q3'), { open: false })
  assert.deepEqual(s.get('q4'), { open: true })
  // Answering the latest must not also mark the skipped ones as answered.
  const after = questionStates([...items, user('u3', 'a')])
  assert.deepEqual(after.get('q2'), { open: false })
  assert.equal(after.get('q4')?.answer, 'a')
})

test('a question still ends the turn when the read budget is used up in the same round', async () => {
  const { faux, session } = await openCoach(project)
  const read = () => fauxAssistantMessage([fauxToolCall('read_file', { path: 'Program.cs' })], { stopReason: 'toolUse' })
  faux.setResponses([
    ...Array.from({ length: 8 }, read),
    fauxAssistantMessage(
      [fauxToolCall('read_file', { path: 'MathCalculator.csproj' }), fauxToolCall('ask_question', { question: 'Which file did you edit?', options: ['Program.cs', 'Another one'] })],
      { stopReason: 'toolUse' }
    ),
    fauxAssistantMessage('**Program.cs it is** (the model answering its own question)')
  ])
  await session.send('Check my code')
  await session.waitForIdle()
  assert.equal(faux.state.callCount, 9)
})

test('a typed message after a question stays in the chat; it is not taken as the answer', () => {
  const items: ChatItem[] = [q('q1'), user('u1', "I'm stuck. Help me work out what's going on, without giving me the answer.")]
  assert.deepEqual(questionStates(items).get('q1'), { open: false })
})

test('a reply that typed a tool name is never shown; the redo with the real card is', async () => {
  const { faux, session, events } = await openCoach(project)
  faux.setResponses([
    fauxAssistantMessage('**What should we brush up first?**\n\n monask_question'),
    fauxAssistantMessage([fauxToolCall('ask_question', { question: 'Which part first?', options: ['Input', 'Maths'] })], { stopReason: 'toolUse' })
  ])
  await session.send('What should I do next?', 'next')
  await session.waitForIdle()
  let n = 0
  const items = events.reduce<ChatItem[]>((xs, e) => applyEvent(xs, e, () => `l${++n}`), [])
  assert.deepEqual(items.map((x) => x.kind), ['user', 'card'])
})

// Real session ("how do I read a number from the console?"): the headline showed three times (with a card that
// failed validation, with the retried card, and in an extra round after it), and an idea-only step was refused.
test('a headline repeated over one turn shows once, live and after a reload; an idea-only step is accepted', async () => {
  const { faux, session, events } = await openCoach(project)
  const headline = '**Console gives text, not numbers**'
  faux.setResponses([
    fauxAssistantMessage([fauxText(headline), fauxToolCall('read_file', { path: 'Program.cs' })], { stopReason: 'toolUse' }),
    fauxAssistantMessage(
      [
        fauxText(headline),
        fauxToolCall('show_step', {
          title: 'Read one number',
          idea: { term: 'turning text into a number', explanation: 'The console always gives plain text.' }
        })
      ],
      { stopReason: 'toolUse' }
    ),
    fauxAssistantMessage(headline)
  ])
  await session.send('how do I read a number from the console?')
  await session.waitForIdle()
  assert.equal(faux.state.callCount, 2, 'the card ends the turn')
  let n = 0
  const live = events.reduce<ChatItem[]>((xs, e) => applyEvent(xs, e, () => `l${++n}`), [])
  assert.equal(live.filter((x) => x.kind === 'assistant').length, 1, 'the headline once')
  assert.ok(live.some((x) => x.kind === 'card' && x.card.kind === 'step' && x.card.lines.length === 0), 'an idea-only step')

})

test('after a reload, a headline repeated in one turn still shows once (but again in a later turn)', () => {
  const entry = (id: number, role: 'user' | 'assistant', text: string) =>
    ({ id, kind: role === 'user' ? 'pi.user' : 'pi.assistant', model: [role === 'user' ? { role, content: text } : { role, content: [{ type: 'text', text }] }] }) as never
  const items = itemsFromEntries([
    entry(1, 'user', 'how do I read a number?'),
    entry(2, 'assistant', '**Console gives text**'),
    entry(3, 'assistant', '**Console gives text**'),
    entry(4, 'user', 'and then?'),
    entry(5, 'assistant', '**Console gives text**')
  ])
  assert.deepEqual(items.map((x) => x.kind), ['user', 'assistant', 'user', 'assistant'])
})
