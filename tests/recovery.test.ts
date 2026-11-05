/**
 * Sessions must never brick. Reproduces the real failure (word-matching routing
 * answered "visualize ..." messages with the same card forever, never calling the
 * model, and wrote model-visible messages that never got an answer), plus a run
 * cut off mid-reply by a quit. Both must recover when the session is opened.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BACKGROUND_CONTEXT as ctx } from '@earendil-works/chord/context'
import { createModels, fauxAssistantMessage, fauxProvider } from '@earendil-works/pi-ai'
import { Harness, createRegistry } from '@earendil-works/pi-durable'
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node'
import type { ProjectInfo } from '../src/shared/ipc'
import { openCoachAt } from './helpers'

const NB_DIR = join(import.meta.dirname, 'fixtures', 'notebook')
const project: ProjectInfo = {
  root: NB_DIR,
  name: 'forest.ipynb',
  stacks: ['Python'],
  manifests: [],
  languages: [{ name: 'Python', files: 1 }],
  fileCount: 1,
  git: null,
  files: ['forest.ipynb']
}

/** Write the transcript the old routing left behind: answered once, then card loops with unanswered user writes. */
async function bricked(file: string): Promise<void> {
  const h = await Harness.open(await openNodeSqliteStorage(file), { models: createModels(), registry: createRegistry() }, ctx)
  const root = await h.root(ctx)
  const card = { kind: 'question', question: 'Which part should I animate?', options: ['Animate spread() in forest.ipynb'], allowOther: true }
  for (const text of ['Visualize what my code does: animate it running.', 'can u visualize 3?', 'visualize 3']) {
    await root.submit({ type: 'write', entry: { kind: 'bc.user', model: [{ role: 'user', content: text, timestamp: Date.now() }] } } as never, ctx)
    await root.submit({ type: 'write', entry: { kind: 'bc.card', data: card } }, ctx)
  }
  await h.close(ctx)
}

test('a session bricked by the old card loop opens, and typed "visualize 3" reaches the model', async () => {
  const file = join(await mkdtemp(join(tmpdir(), 'bc-brick-')), 'session.sqlite')
  await bricked(file)
  const faux = fauxProvider()
  const { session, events } = await openCoachAt(file, project, faux)
  // The old chat is still there to read.
  assert.ok(session.initialItems.some((i) => i.kind === 'card'))
  faux.setResponses([fauxAssistantMessage('**Cell 3 is the loop**\n- Want me to animate it?')])
  await session.send('visualize 3')
  await session.waitForIdle()
  assert.equal(faux.state.callCount, 1, 'the model was called: no more card loop')
  assert.ok(events.some((e) => e.type === 'text' && e.delta.includes('Cell 3 is the loop')))
  assert.ok(events.some((e) => e.type === 'busy' && e.busy === false), 'the run finished')
})

test('a reply cut off by quitting resumes when the session is opened, and the session keeps working', async () => {
  const file = join(await mkdtemp(join(tmpdir(), 'bc-cut-')), 'session.sqlite')
  // First "app run": a slow reply, quit in the middle of it.
  const slow = fauxProvider({ tokensPerSecond: 20 })
  slow.setResponses([fauxAssistantMessage('**Here is a long reply** '.repeat(40))])
  const first = await openCoachAt(file, project, slow)
  await first.session.send('explain spread')
  await new Promise((r) => setTimeout(r, 150))
  await first.session.close()

  // Second "app run": the unfinished work is picked up, then a new message works too.
  const faux = fauxProvider()
  faux.setResponses([fauxAssistantMessage('**Resumed**'), fauxAssistantMessage('**And again**')])
  const second = await openCoachAt(file, project, faux)
  await second.session.waitForIdle()
  await second.session.send('and now?')
  await second.session.waitForIdle()
  const shown = second.events.filter((e) => e.type === 'text').map((e) => (e as { delta: string }).delta).join(' ')
  assert.match(shown, /And again/, 'the session is not stuck')
})
