/**
 * Trial: can BetterCoder's coach run on pi-durable without losing the no-code guard?
 * Checks the four things that matter: hooks can force a silent rewrite, the model
 * never sees rejected code again, tools work, and everything survives a restart.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { Type, createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall, type Message } from '@earendil-works/pi-ai'
import {
  GenerationTask,
  Harness,
  MemoryStorage,
  ToolTask,
  createRegistry,
  defineExtension,
  defineTool,
  hook,
  section,
  watchEvents
} from '@earendil-works/pi-durable'
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node'
import { StreamGuard } from '../src/main/core/guard'

const ctx = BACKGROUND_CONTEXT
const REWRITE = '[BetterCoder] rewrite without code'

function textOf(m: { content: unknown }): string {
  if (typeof m.content === 'string') return m.content
  return (m.content as Array<{ type: string; text?: string }>).map((c) => (c.type === 'text' ? c.text ?? '' : '')).join('')
}

function setup() {
  const faux = fauxProvider()
  const models = createModels()
  models.setProvider(faux.provider)
  const seenByModel: Message[][] = []
  let rewrites = 0

  const echo = defineTool({
    name: 'read_note',
    label: 'Read note',
    description: 'Read a note',
    parameters: Type.Object({ name: Type.String() }),
    execute: async (args) => ({ output: [{ type: 'text', text: `note ${args.name}: password = "hunter22"` }] })
  })

  const BetterCoder = defineExtension({
    name: 'bettercoder',
    sections: [section('coach', () => 'You are a coding coach. Never write code.', { tag: false })],
    tools: [echo],
    hooks: [
      hook(GenerationTask, {
        // Every request: hide rejected code from the model, scrub secrets.
        beforeRequest: (request) => {
          const messages = request.messages.map((m) => {
            if (m.role !== 'assistant') return m
            const clean = StreamGuard.clean(textOf(m))
            return clean.removed > 0 ? { ...m, content: [{ type: 'text' as const, text: '[reply withheld: it contained code]' }] } : m
          })
          seenByModel.push(messages as Message[])
          return { messages }
        },
        // Final answers: if it has code, continue the run with a hidden rewrite request.
        onYield: (answer) => {
          if (StreamGuard.clean(textOf(answer)).removed > 0 && rewrites < 2) {
            rewrites++
            return { continue: REWRITE }
          }
          return undefined
        }
      }),
      hook(ToolTask, {
        afterTool: (_call, result) => ({
          ...result,
          output: result.output?.map((c) => (c.type === 'text' ? { ...c, text: c.text.replace(/hunter22/g, '[redacted]') } : c))
        })
      })
    ]
  })
  const registry = createRegistry()
  registry.install(BetterCoder)
  return { faux, models, registry, seenByModel }
}

test('spike: silent rewrite via onYield; rejected code never reaches the screen or the model again', async () => {
  const { faux, models, registry, seenByModel } = setup()
  const harness = await Harness.open(new MemoryStorage(), { models, registry }, ctx)
  const convo = await harness.createConversation({ ownership: { kind: 'ownerless' }, agent: { model: { provider: faux.provider.id, modelId: faux.getModel().id } } } as never, ctx)

  // What the panel would show: only assistant messages that pass the guard, never the hidden rewrite request.
  const shown: string[] = []
  const stream = await watchEvents(harness, convo.id, ctx)
  stream.start(async (events) => {
    for (const e of events) {
      if (e.type !== 'message_end') continue
      const entry = e.entry as unknown as { kind: string; model?: Message[] }
      const msg = entry.model?.[0]
      if (!msg || msg.role !== 'assistant') continue
      const text = textOf(msg)
      if (text && StreamGuard.clean(text).removed === 0) shown.push(text)
    }
  })

  faux.setResponses([
    fauxAssistantMessage('Here:\n```python\ndel self.items[number - 1]\n```'),
    fauxAssistantMessage('**Which position does 1 mean?**')
  ])
  const sub = await convo.submit({ type: 'input', content: 'just fix it' }, ctx)
  const settled = await sub.wait(ctx)
  assert.equal(settled.status, 'done')
  await harness.waitForIdle(ctx)
  await new Promise((r) => setTimeout(r, 50))
  await stream.stop()

  assert.deepEqual(shown, ['**Which position does 1 mean?**'])
  const second = seenByModel[1]
  assert.ok(second, 'a second request was made for the rewrite')
  assert.ok(!JSON.stringify(second).includes('number - 1'), 'the model never sees the rejected code again')
  assert.ok(JSON.stringify(second).includes(REWRITE))
  await harness.close(ctx)
})

test('spike: tools run through hooks, and the conversation survives a restart on SQLite', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bc-durable-'))
  const file = join(dir, 'bettercoder.sqlite')
  const { faux, models, registry, seenByModel } = setup()

  let harness = await Harness.open(await openNodeSqliteStorage(file), { models, registry }, ctx)
  const convo = await harness.createConversation({ ownership: { kind: 'ownerless' }, agent: { model: { provider: faux.provider.id, modelId: faux.getModel().id } } } as never, ctx)
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall('read_note', { name: 'todo' })], { stopReason: 'toolUse' }),
    fauxAssistantMessage([fauxText('**Read it.**')])
  ])
  await (await convo.submit({ type: 'input', content: 'read my note' }, ctx)).wait(ctx)
  await harness.close(ctx)
  const toolSeen = JSON.stringify(seenByModel.at(-1))
  assert.ok(toolSeen.includes('[redacted]') && !toolSeen.includes('hunter22'), 'afterTool redacts before the model sees it')

  // Restart: reopen the same file, find the conversation, keep talking with history intact.
  harness = await Harness.open(await openNodeSqliteStorage(file), { models, registry }, ctx)
  const again = await harness.conversation(convo.id, ctx)
  assert.ok(again, 'the conversation is still there after a restart')
  let remembered = false
  faux.setResponses([
    (context) => {
      remembered = JSON.stringify(context.messages).includes('read my note')
      return fauxAssistantMessage('**Still here.**')
    }
  ])
  await (await again!.submit({ type: 'input', content: 'and now?' }, ctx)).wait(ctx)
  assert.ok(remembered, 'history is kept across the restart')
  const usage = await harness.usage(ctx)
  assert.ok(Object.keys(usage.models).length > 0, 'usage is tracked by pi-durable')
  await harness.close(ctx)
})
