import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall, type Model } from '@earendil-works/pi-ai'
import { stream as responsesStream } from '@earendil-works/pi-ai/api/openai-responses'
import { XAI_MODELS } from '@earendil-works/pi-ai/providers/xai.models'
import { Coach } from '../src/main/coach/coach'
import { DEFAULT_PROFILE, type LearnerProfile } from '../src/shared/profile'
import type { ProjectInfo } from '../src/shared/ipc'
import { track } from './helpers'
import { realPorts } from '../src/main/ipc/ports'
import { runView } from '../src/main/core/run-view'
import type { RunSummary } from '../src/shared/code'

const ROOT = join(import.meta.dirname, 'fixtures', 'dotnet-calculator')
const PROJECT: ProjectInfo = { root: ROOT, name: 'calc', stacks: ['C#'], manifests: [], languages: [{ name: 'C#', files: 1 }], fileCount: 1, git: null }

type Body = { input: unknown[]; tools?: unknown[]; prompt_cache_key?: string }

/** The exact body pi-ai would send to xAI for this request (stopped before the network). */
async function xaiBody(context: unknown, sessionId?: string): Promise<Body> {
  const model = Object.values(XAI_MODELS).find((m) => m.id === 'grok-4.5') as Model<'openai-responses'>
  let body: Body | undefined
  const s = responsesStream(model, context as never, {
    apiKey: 'test',
    sessionId,
    onPayload: (p: unknown) => {
      body = p as Body
      throw new Error('stop before the network')
    }
  })
  for await (const _ of s) void _
  assert.ok(body, 'pi-ai built a payload')
  return body
}

/**
 * Regression (real Grok session, 2026-11-04): providers only reuse a request's start when it is byte-for-byte the same,
 * and pi-ai folds every section into the top system message. Noting a skill or using a card rewrote that message, so
 * nearly every new message was re-read at full price. A new learner message may only change what comes after the
 * previous learner message (the editor view, learner-now note and reminder move there).
 */
test('cache: the xAI request keeps its start byte-for-byte as skills, card use and the editor change', async () => {
  const faux = fauxProvider()
  const models = createModels()
  models.setProvider(faux.provider)
  const contexts: unknown[] = []
  const opts: Array<{ headers?: Record<string, string>; cacheRetention?: string; sessionId?: string } | undefined> = []
  let profile: LearnerProfile = DEFAULT_PROFILE
  let cardUse = ''
  let editorLine = 2
  const file = join(await mkdtemp(join(tmpdir(), 'bc-cache-')), 's.sqlite')
  const coach = track(
    await Coach.open(file, PROJECT, () => undefined, {
      ports: realPorts(),
      models,
      resolveModel: async () => faux.getModel(),
      profile: () => profile,
      noteSkill: (s) => (profile = { ...profile, skills: [...profile.skills, { ...s, at: profile.skills.length + 1 }] }),
      cardUse: () => cardUse,
      editorContext: () => `[BetterCoder editor: what the learner has open in VS Code right now.\nFile: Program.cs, cursor on line ${editorLine}\nEnd of editor view.]`
    })
  )
  const reply =
    (...parts: Array<ReturnType<typeof fauxText> | ReturnType<typeof fauxToolCall>>) =>
    (ctx: unknown, o: unknown) => (
      contexts.push(structuredClone(ctx)),
      opts.push(o as never),
      fauxAssistantMessage(parts, { stopReason: parts.some((p) => p.type === 'toolCall') ? 'toolUse' : 'stop' })
    )
  faux.setResponses([
    reply(
      fauxText('**Read the first number**'),
      fauxToolCall('note_skill', { topic: 'reading input', level: 'basics', evidence: 'wrote ReadLine' }),
      fauxToolCall('track_progress', { tasks: [{ title: 'Read numbers', percent: 20 }] }),
      fauxToolCall('show_step', { title: 'Read it', lines: [{ text: 'a ← read a line' }] })
    ),
    reply(fauxToolCall('point_to_code', { path: 'Program.cs', start_line: 1, end_line: 3 })),
    reply(fauxText('**Now the second**'), fauxToolCall('note_skill', { topic: 'parsing', level: 'new', evidence: 'used text as a number' })),
    reply(fauxToolCall('read_file', { path: 'Program.cs' })),
    reply(fauxText('**Then pick the operation**')),
    reply(fauxText('**Print it**'))
  ])
  await coach.send('What should I do next?')
  await coach.waitForIdle()
  cardUse = 'stepped through pseudocode line by line 1×'
  editorLine = 5
  await coach.send('I wrote that')
  await coach.waitForIdle()
  editorLine = 8
  await coach.send('and now?')
  await coach.waitForIdle()
  await coach.send('ok')
  await coach.waitForIdle()

  // Every call asks for the longer cache, and routes by one id only: pi-durable's session id as xAI's prompt_cache_key.
  // Regression: a second, different id (x-grok-conv-id) was also sent and could split the routing.
  assert.ok(opts.every((o) => o?.cacheRetention === 'long'))
  assert.ok(opts.every((o) => !o?.headers?.['x-grok-conv-id']), 'no second conversation id')
  const session = opts[0]?.sessionId
  assert.ok(session && opts.every((o) => o?.sessionId === session), 'one session id for the whole conversation')

  assert.ok(contexts.length >= 5, `expected 5+ requests, got ${contexts.length}`)
  assert.ok(profile.skills.length === 2, 'skills changed during the session')
  const bodies = await Promise.all(contexts.map((c, i) => xaiBody(c, opts[i]?.sessionId)))
  assert.ok(bodies.every((b) => b.prompt_cache_key && b.prompt_cache_key === bodies[0].prompt_cache_key), 'xAI gets the same prompt_cache_key every time')
  for (let i = 1; i < bodies.length; i++) {
    const prev = bodies[i - 1]
    const cur = bodies[i]
    assert.deepEqual(cur.tools, prev.tools, `request ${i + 1}: the tool list changed`)
    const lastUser = prev.input.findLastIndex((m) => (m as { role?: string }).role === 'user')
    for (let k = 0; k < lastUser; k++) {
      assert.deepEqual(cur.input[k], prev.input[k], `request ${i + 1}: input item ${k} changed (before the previous learner message, item ${lastUser})`)
    }
  }
  const input = bodies.at(-1)!.input
  const last = JSON.stringify(input.findLast((m) => (m as { role?: string }).role === 'user'))
  assert.match(last, /learner now/, 'levels and card use ride on the newest message')
  assert.match(last, /parsing/)
})

/**
 * The learner's last ▶ Run reaches the coach the same way as the editor view: on the newest message only. A new run
 * between messages must not change anything before the previous learner message, and no run view is ever stored.
 */
test('cache: a new run changes only the newest message, and no run view is stored', async () => {
  const faux = fauxProvider()
  const models = createModels()
  models.setProvider(faux.provider)
  const contexts: unknown[] = []
  const opts: Array<{ sessionId?: string } | undefined> = []
  let run: RunSummary | null = null
  const dir = await mkdtemp(join(tmpdir(), 'bc-cache-run-'))
  const file = join(dir, 's.sqlite')
  const coach = track(
    await Coach.open(file, PROJECT, () => undefined, {
      ports: realPorts(),
      models,
      resolveModel: async () => faux.getModel(),
      editorContext: () => runView(run, 10_000)
    })
  )
  const reply = (text: string) => (ctx: unknown, o: unknown) => (
    contexts.push(structuredClone(ctx)), opts.push(o as never), fauxAssistantMessage([fauxText(text)], { stopReason: 'stop' })
  )
  faux.setResponses([reply('**Run it**'), reply('**Line 10 uses b too early**'), reply('**Works now**')])
  const crash = (at: number): RunSummary => ({
    id: 't1', path: 'main.py', startedAt: at, endedAt: at + 100, exitCode: 1, stopped: false,
    output: "First number: 7\nTraceback (most recent call last):\n  File \"main.py\", line 10, in <module>\nNameError: name 'b' is not defined\n",
    error: { type: 'NameError', message: "name 'b' is not defined", path: 'main.py', line: 10 }, words: 'Line 10 uses b before it exists.'
  })
  await coach.send('how do I run it?')
  await coach.waitForIdle()
  run = crash(1000)
  await coach.send('why did it crash?')
  await coach.waitForIdle()
  run = { ...crash(5000), exitCode: 0, output: 'First number: 7\nSecond number: 5\n12\n', error: null, words: null }
  await coach.send('fixed it')
  await coach.waitForIdle()

  const bodies = await Promise.all(contexts.map((c, i) => xaiBody(c, opts[i]?.sessionId)))
  assert.equal(bodies.length, 3)
  const userText = (b: Body) => JSON.stringify(b.input.findLast((m) => (m as { role?: string }).role === 'user'))
  assert.doesNotMatch(userText(bodies[0]), /last run/, 'no run yet, no run view')
  assert.match(userText(bodies[1]), /BetterCoder last run[\s\S]*NameError on line 10 of main\.py/, 'the crash rides on the newest message')
  assert.match(userText(bodies[2]), /exit status 0/)
  for (let i = 1; i < bodies.length; i++) {
    const prev = bodies[i - 1]
    const lastUser = prev.input.findLastIndex((m) => (m as { role?: string }).role === 'user')
    for (let k = 0; k < lastUser; k++) assert.deepEqual(bodies[i].input[k], prev.input[k], `request ${i + 1}: item ${k} changed`)
    // The older crash is not carried along in earlier messages.
    assert.doesNotMatch(JSON.stringify(bodies[i].input.slice(0, lastUser + 1)), /NameError on line 10/, `request ${i + 1}: an old run view stayed in the history`)
  }
  await coach.close()
  const { readFile, readdir } = await import('node:fs/promises')
  for (const name of await readdir(dir)) {
    const bytes = await readFile(join(dir, name))
    // (The prompt itself names the "[BetterCoder last run: …]" view, so look for what only a real view holds.)
    for (const marker of ['End of last run.]', 'NameError on line 10 of main.py', 'Second number: 5']) {
      assert.ok(!bytes.includes(marker), `${name} stores a run view (${marker})`)
    }
  }
})
