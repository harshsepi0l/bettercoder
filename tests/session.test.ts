import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from '@earendil-works/pi-ai'
import type { HarnessEvent } from '../src/shared/harness'
import type { ProjectInfo } from '../src/shared/ipc'
import { openCoach } from './helpers'
import { FALLBACK_REPLY } from '../src/main/coach/prompts'

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'wp-session-'))
  await mkdir(join(root, 'src'))
  await writeFile(join(root, 'src', 'Program.cs'), 'var builder = WebApplication.CreateBuilder(args);\n// password = "hunter22"\n')
  await writeFile(join(root, '.env'), 'SECRET=abc\n')
  const project: ProjectInfo = {
    root,
    name: 'OrderApi',
    stacks: ['C# / .NET'],
    manifests: [],
    languages: [{ name: 'C#', files: 1 }],
    fileCount: 2,
    git: null
  }
  return openCoach(project)
}

function shownText(events: HarnessEvent[]): Map<string, string> {
  const byId = new Map<string, string>()
  for (const e of events) if (e.type === 'text') byId.set(e.id, (byId.get(e.id) ?? '') + e.delta)
  return byId
}

test('strict: a reply with code is never shown at all; only the clean redo appears', async () => {
  const { faux, session, events } = await setup()
  faux.setResponses([
    fauxAssistantMessage('Sure, add this:\n```csharp\nbuilder.Services.AddScoped<IOrderRepository, OrderRepository>();\n```'),
    fauxAssistantMessage('Where do you think services get registered when the app starts?')
  ])
  await session.send('just write the fix for me')
  await session.waitForIdle()

  const shown = [...shownText(events).values()]
  assert.deepEqual(shown, ['Where do you think services get registered when the app starts?'])
  assert.ok(!shown.join('').includes('Sure, add this'), 'the code reply must not appear even partly')
  assert.ok(!events.some((e) => e.type === 'text' && e.delta.includes('code removed')), 'no removal notice either')
  assert.equal(faux.state.callCount, 2)
})

test('strict: if the model keeps writing code, the learner gets the fallback, never the code', async () => {
  const { faux, session, events } = await setup()
  const codey = () => fauxAssistantMessage('Here:\ndef complete(self, number):\n    self.items[number - 1]["done"] = True')
  faux.setResponses([codey(), codey(), codey()])
  await session.send('write complete() for me')
  await session.waitForIdle()
  const shown = [...shownText(events).values()]
  assert.deepEqual(shown, [FALLBACK_REPLY])
  assert.equal(faux.state.callCount, 3)
})

test('strict: every request carries the no-code reminder', async () => {
  const { faux, session } = await setup()
  let lastUser = ''
  faux.setResponses([
    (context) => {
      const users = context.messages.filter((m) => m.role === 'user')
      const last = users.at(-1)
      lastUser = typeof last?.content === 'string' ? last.content : JSON.stringify(last?.content)
      return fauxAssistantMessage('What have you tried so far?')
    }
  ])
  await session.send('give me the code for remove')
  await session.waitForIdle()
  assert.ok(lastUser.includes('no code of any kind'), lastUser)
})

test('tools read inside the project, refuse secrets, and redact credentials', async () => {
  const { faux, session, events } = await setup()
  const seen: string[] = []
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall('read_file', { path: 'src/Program.cs' }), fauxToolCall('read_file', { path: '.env' })], {
      stopReason: 'toolUse'
    }),
    (context) => {
      for (const m of context.messages) {
        if (m.role === 'toolResult') for (const c of m.content) if (c.type === 'text') seen.push(c.text)
      }
      return fauxAssistantMessage([fauxText('Have a look at line 1 of `src/Program.cs`.')])
    }
  ])
  await session.send('what does my Program.cs do?')
  await session.waitForIdle()

  const program = seen.find((t) => t.includes('Program.cs'))
  assert.ok(program?.includes('WebApplication.CreateBuilder'), 'file contents should reach the model')
  assert.ok(!program?.includes('hunter22'), 'credential should be redacted')
  assert.ok(seen.some((t) => /secrets/.test(t)), '.env should be refused')
  assert.ok(!seen.some((t) => t.includes('SECRET=abc')))
  const tools = events.filter((e) => e.type === 'tool')
  assert.ok(tools.some((e) => e.type === 'tool' && e.status === 'error'), '.env read should show as an error')
})

test('a write-style tool call is blocked', async () => {
  const { faux, session } = await setup()
  const seen: string[] = []
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall('write_file', { path: 'src/Program.cs', content: 'x' })], { stopReason: 'toolUse' }),
    (context) => {
      for (const m of context.messages) {
        if (m.role === 'toolResult') for (const c of m.content) if (c.type === 'text') seen.push(c.text)
      }
      return fauxAssistantMessage('I cannot change files.')
    }
  ])
  await session.send('fix it')
  await session.waitForIdle()
  assert.ok(seen.length > 0)
  assert.ok(!seen.join(' ').includes('wrote'), 'no write should happen')
})

test('old tool results are trimmed before each request, so context stays small', async () => {
  const { prepareMessages } = await import('../src/main/coach/request')
  const compactOldToolResults = (m: never[]) => prepareMessages(m)
  const big = 'x'.repeat(5000)
  const msgs = [
    { role: 'user', content: 'first', timestamp: 1 },
    { role: 'toolResult', toolCallId: 'a', toolName: 'read_file', content: [{ type: 'text', text: big }], isError: false, timestamp: 2 },
    { role: 'user', content: 'second', timestamp: 3 },
    { role: 'toolResult', toolCallId: 'b', toolName: 'read_file', content: [{ type: 'text', text: big }], isError: false, timestamp: 4 }
  ] as never[]
  const out = compactOldToolResults(msgs) as Array<{ role: string; content: unknown }>
  assert.match(JSON.stringify(out[1].content), /removed to save space/)
  assert.ok(JSON.stringify(out[3].content).includes(big), 'the current turn keeps its results')
})

// A hidden redo (Visualize nudge, no-code rewrite) is part of the same turn: its results must not be stubbed.
test('a hidden redo message does not stub the current turn\'s tool results', async () => {
  const { prepareMessages } = await import('../src/main/coach/request')
  const big = 'x'.repeat(5000)
  const msgs = [
    { role: 'user', content: 'show me the loop', timestamp: 1 },
    { role: 'toolResult', toolCallId: 'a', toolName: 'project_outline', content: [{ type: 'text', text: big }], isError: false, timestamp: 2 },
    { role: 'user', content: '[BetterCoder] The learner pressed Visualize. Do not describe it in words.', timestamp: 3 }
  ] as never[]
  const out = prepareMessages(msgs) as Array<{ role: string; content: unknown }>
  assert.ok(JSON.stringify(out[1].content).includes(big))
})

test('the coach gets at most 8 tool calls per message', async () => {
  const { faux, session } = await setup()
  const calls = Array.from({ length: 10 }, () => fauxToolCall('list_files', {}))
  let blocked = 0
  faux.setResponses([
    fauxAssistantMessage(calls, { stopReason: 'toolUse' }),
    (context) => {
      for (const m of context.messages) {
        if (m.role === 'toolResult' && JSON.stringify(m.content).includes('Tool limit')) blocked++
      }
      return fauxAssistantMessage('**Done looking**')
    }
  ])
  await session.send('look at everything')
  await session.waitForIdle()
  assert.equal(blocked, 2)
})
