import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai'
import type { HarnessEvent } from '../src/shared/harness'
import type { ProjectInfo } from '../src/shared/ipc'
import { pseudocodeProblem } from '../src/main/core/guard'
import { PART_PATTERN, splitLine } from '../src/shared/line-parts'
import { openCoach } from './helpers'
import { questionStates, type ChatItem } from '../src/shared/chat'
import { cleanProfile } from '../src/shared/profile'
import { linksFromChat } from '../src/renderer/src/features/sources/sources-tab'

const project: ProjectInfo = {
  root: join(import.meta.dirname, 'fixtures', 'dotnet-calculator'),
  name: 'MathCalculator',
  stacks: ['C#'],
  manifests: ['MathCalculator.csproj'],
  languages: [{ name: 'C#', files: 1 }],
  fileCount: 2,
  git: null
}
const cards = (events: HarnessEvent[]) => events.flatMap((e) => (e.type === 'card' ? [e.card] : []))

test('pseudocode mixed with plain English passes; real syntax does not', () => {
  for (const line of ['a ← read a number', '  if op = "+": result ← a + b', 'otherwise if b is 0', 'repeat for each item', 'turn the text into a number (a double)', 'while count < 10:', 'return the total'])
    assert.equal(pseudocodeProblem(line), null, line)
  for (const line of ['double a = double.Parse(input);', 'a = 5', 'Console.WriteLine(result)', 'if (op == "+") {', 'items[0]', 'var a ← read', 'print(result)', 'count++', 'result ← Math.Max(a, b)', 'def calc(a, b):'])
    assert.notEqual(pseudocodeProblem(line), null, line)
})

test('a step card holds the idea, the pseudocode and a question; a line of real code is sent back to the model', async () => {
  const { faux, session, events } = await openCoach(project)
  let error = ''
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall('show_step', { title: 'Read the input', lines: [{ text: 'a ← read a number' }, { text: 'b ← double.Parse(text)' }] })], { stopReason: 'toolUse' }),
    (ctx) => {
      const last = ctx.messages.at(-1) as { role: string; content: Array<{ text?: string }> }
      error = last.role === 'toolResult' ? (last.content[0]?.text ?? '') : ''
      return fauxAssistantMessage(
        [
          fauxToolCall('show_step', {
            title: 'Read the input',
            idea: { term: 'Reading input', explanation: 'What they type arrives as text.' },
            lines: [
              { text: 'a ← read a number', method: 'Console.ReadLine', doc_url: 'https://learn.microsoft.com/en-us/dotnet/api/system.console.readline', note: 'It waits for Enter.' },
              { text: '  if it is not a number: ask again' },
              { text: 'b ← turn the text into a number', method: 'double.Parse', doc_url: 'http://insecure.example/parse' }
            ],
            question: { question: 'Ready to write it?', options: ['Yes', 'Not yet'] }
          })
        ],
        { stopReason: 'toolUse' }
      )
    },
    fauxAssistantMessage('this should never be requested: the question ends the turn')
  ])
  await session.send('How do I read the numbers?')
  await session.waitForIdle()
  assert.match(error, /real code/)
  assert.equal(faux.state.callCount, 2)
  const step = cards(events).find((c) => c.kind === 'step')
  assert.ok(step && step.kind === 'step')
  assert.equal(step.lines[0].method, 'Console.ReadLine')
  assert.equal(step.lines[1].text, '  if it is not a number: ask again', 'indentation kept')
  assert.equal(step.lines[2].docUrl, undefined, 'only https doc links')
  assert.equal(step.question?.options.length, 2)

  // The step's question is answered like a question card's.
  const items: ChatItem[] = [{ kind: 'card', id: 's', card: step }]
  assert.equal(questionStates(items).get('s')?.open, true)
  assert.equal(questionStates([...items, { kind: 'user', id: 'u', text: 'Yes' }]).get('s')?.answer, 'Yes')
  // Sources collects the method's doc page.
  assert.deepEqual(linksFromChat(items).map((l) => l.title), ['Console.ReadLine'])
})

test('a method tag must be a name, not code', async () => {
  const { faux, session, events } = await openCoach(project)
  let error = ''
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall('show_step', { title: 'Read', lines: [{ text: 'a ← read a number', method: 'Console.ReadLine()' }] })], { stopReason: 'toolUse' }),
    (ctx) => {
      const last = ctx.messages.at(-1) as { role: string; content: Array<{ text?: string }> }
      error = last.role === 'toolResult' ? (last.content[0]?.text ?? '') : ''
      return fauxAssistantMessage('**Try it**')
    }
  ])
  await session.send('next?')
  await session.waitForIdle()
  assert.match(error, /method must be a name/)
  assert.equal(cards(events).length, 0)
})

test('the code view choice is kept in the profile; anything else is dropped', () => {
  assert.equal(cleanProfile({ codeView: 'stepper' }).codeView, 'stepper')
  assert.equal(cleanProfile({ codeView: 'checklist' }).codeView, undefined)
})

test('part labels: only parts really in the official line are labelled, and the line is never changed', () => {
  const line = 's = Console.ReadLine();'
  const segs = splitLine(line, [
    { part: 's', says: 'the box for the text' },
    { part: '=', says: 'put the right side into the box' },
    { part: 'Console.ReadLine()', says: 'waits for typing, gives back text' },
    { part: ';', says: 'end of this instruction' },
    { part: 'string?', says: 'text that may be empty' } // not in this line: dropped
  ])
  assert.equal(segs.map((s) => s.text).join(''), line, 'the line is untouched')
  assert.deepEqual(
    segs.filter((s) => s.says).map((s) => s.text),
    ['s', '=', 'Console.ReadLine()', ';']
  )
  // "s" is a whole name: never the s inside "Console"; a named call also matches the call with arguments.
  const call = splitLine('Console.WriteLine(Double.Parse(value));', [
    { part: 'Double.Parse()', says: 'turns text into a number' },
    { part: 'Parse', says: 'already covered' },
    { part: 's', says: 'nothing' }
  ])
  assert.deepEqual(call.filter((s) => s.says).map((s) => s.text), ['Double.Parse'])
  for (const ok of ['Console.ReadLine()', '=', ';', 'string?', '+=']) assert.match(ok, PART_PATTERN, ok)
  for (const bad of ['s = 5', 'Console.ReadLine(x)', 'a;b;c;d']) assert.doesNotMatch(bad, PART_PATTERN, bad)
})

test('part labels on a step line: a part that is not one name or symbol is dropped (no failed round); a label that is code goes back', async () => {
  const { faux, session, events } = await openCoach(project)
  const errors: string[] = []
  const lastError = (ctx: { messages: unknown[] }) => {
    const last = ctx.messages.at(-1) as { role: string; content: Array<{ text?: string }> }
    errors.push(last.role === 'toolResult' ? (last.content[0]?.text ?? '') : '')
  }
  const url = 'https://learn.microsoft.com/en-us/dotnet/api/system.console.readline'
  const stepWith = (parts: Array<{ part: string; says: string }>) =>
    fauxAssistantMessage([fauxToolCall('show_step', { title: 'Read', lines: [{ text: 'a ← read a number', method: 'Console.ReadLine', doc_url: url, parts }] })], {
      stopReason: 'toolUse'
    })
  faux.setResponses([
    stepWith([{ part: ';', says: 'a = Console.ReadLine();' }]),
    // Regression (real session, 2026-11-04): "(value)" failed the whole card and cost a round.
    (ctx) => (lastError(ctx), stepWith([{ part: '(value)', says: 'the data you hand it' }, { part: 'Console.ReadLine()', says: 'waits for typing, gives back text' }])),
    fauxAssistantMessage('**Try it**')
  ])
  await session.send('next?')
  await session.waitForIdle()
  assert.match(errors[0], /code/)
  assert.equal(faux.state.callCount, 2, "the dropped part cost no extra round")
  const step = cards(events).find((c) => c.kind === 'step')
  assert.ok(step && step.kind === 'step')
  assert.deepEqual(step.lines[0].parts, [{ part: 'Console.ReadLine()', says: 'waits for typing, gives back text' }])
})
