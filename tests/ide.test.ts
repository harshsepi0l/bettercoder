// The editor link: BetterCoder sees what the learner has open, marks where a step goes and shows its pseudocode
// faded in their editor, and keeps two meters (progress from the coach, feeling from editor activity).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { createConnection, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from '@earendil-works/pi-ai'
import type { HarnessEvent } from '../src/shared/harness'
import type { ProjectInfo } from '../src/shared/ipc'
import type { IdeView, TaskProgress, ToIde } from '../src/shared/ide'
import { Coach } from '../src/main/coach/coach'
import { type AnchoredStep } from '../src/main/coach/replay'
import { IdeBridge, parseIdeMessage } from '../src/main/adapters/ide-socket'
import type { EditorSnapshot } from '../src/main/ports'
import { editorContext, visiblePath } from '../src/main/services/editor-context'
import { feeling, PAUSE_STUCK, SAME_ERROR_STUCK } from '../src/main/core/feeling'
import { IdeHub } from '../src/main/services/editor-link'
import { createVisualTools } from '../src/main/coach/tools/cards'
// The extension's own ghost logic (CommonJS, no vscode import).
import ghostModule from '../ide/vscode/ghost.js'
import { track } from './helpers'
import { realPorts } from '../src/main/ipc/ports'

const { ghostAt, typedCount } = ghostModule as {
  ghostAt: (lines: string[], anchor: number, cursor: number, ghost: string[]) => { ghost: { line: number; text: string } | null; done: boolean }
  typedCount: (lines: string[], anchor: number, cursor: number, ghostLength: number) => number
}

const ROOT = join(import.meta.dirname, 'fixtures', 'dotnet-calculator')
const PROJECT: ProjectInfo = { root: ROOT, name: 'MathCalculator', stacks: ['C#'], manifests: [], languages: [{ name: 'C#', files: 1 }], fileCount: 2, git: null }

function snap(over: Partial<EditorSnapshot> = {}): EditorSnapshot {
  return { ide: 'VS Code', folders: [ROOT], file: join(ROOT, 'Program.cs'), line: 2, col: 1, text: null, diagnostics: [], lastEditAt: null, errors: null, stepsDone: new Set(), stepTyped: null, ...over }
}

test('editor messages: well-formed ones parse, anything else is dropped', () => {
  assert.deepEqual(parseIdeMessage('{"type":"editor","file":"/a/b.cs","line":3,"col":1}'), { type: 'editor', file: '/a/b.cs', line: 3, col: 1 })
  assert.deepEqual(parseIdeMessage('{"type":"editor","file":null,"line":0,"col":0}'), { type: 'editor', file: null, line: 0, col: 0 })
  assert.equal(parseIdeMessage('not json'), null)
  assert.equal(parseIdeMessage('{"type":"editor","file":"/a","line":-1,"col":1}'), null)
  assert.equal(parseIdeMessage('{"type":"write_file","file":"/a"}'), null, 'unknown types are ignored')
  const many = Array.from({ length: 50 }, (_, i) => ({ line: i + 1, col: 1, severity: 'error', message: 'x' }))
  const d = parseIdeMessage(JSON.stringify({ type: 'diagnostics', file: '/a', items: many }))
  assert.equal(d?.type === 'diagnostics' && d.items.length, 20, 'problems are capped')
})

async function connect(path: string): Promise<{ socket: Socket; received: ToIde[] }> {
  const socket = createConnection(path)
  const received: ToIde[] = []
  let buf = ''
  socket.setEncoding('utf8')
  socket.on('data', (c: string) => {
    buf += c
    let nl
    while ((nl = buf.indexOf('\n')) >= 0) {
      received.push(JSON.parse(buf.slice(0, nl)))
      buf = buf.slice(nl + 1)
    }
  })
  await new Promise<void>((r) => socket.once('connect', () => r()))
  return { socket, received }
}

const tick = () => new Promise((r) => setTimeout(r, 40))

test('the bridge follows the editor over a local socket and sends markers back, also to editors that connect later', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bc-ide-'))
  const path = join(dir, 'ide.sock')
  let now = 1000
  let changes = 0
  const bridge = new IdeBridge(() => changes++, () => now)
  await bridge.listen(path)
  try {
    const a = await connect(path)
    const file = join(ROOT, 'Program.cs')
    a.socket.write(`${JSON.stringify({ type: 'hello', ide: 'Cursor', folders: [ROOT] })}\n`)
    a.socket.write(`${JSON.stringify({ type: 'editor', file, line: 2, col: 5 })}\n`)
    a.socket.write(`${JSON.stringify({ type: 'doc', file, text: 'one' })}\n`)
    await tick()
    assert.equal(bridge.snapshot()?.ide, 'Cursor')
    assert.equal(bridge.snapshot()?.line, 2)
    assert.equal(bridge.snapshot()?.lastEditAt, null, 'the first text is not an edit')
    now = 5000
    a.socket.write(`${JSON.stringify({ type: 'doc', file, text: 'two' })}\n`)
    a.socket.write(`${JSON.stringify({ type: 'diagnostics', file, items: [{ line: 1, col: 1, severity: 'error', code: 'CS0029', message: 'nope' }] })}\n`)
    await tick()
    assert.equal(bridge.snapshot()?.lastEditAt, 5000)
    assert.deepEqual(bridge.snapshot()?.errors, { key: 'CS0029:nope', since: 5000 })
    now = 9000
    a.socket.write(`${JSON.stringify({ type: 'diagnostics', file, items: [{ line: 4, col: 1, severity: 'error', code: 'CS0029', message: 'nope' }] })}\n`)
    await tick()
    assert.equal(bridge.snapshot()?.errors?.since, 5000, 'the same error on a moved line is still the same error')
    assert.ok(changes > 0)

    bridge.send({ type: 'anchor', stepId: 's1', file, line: 2, ghost: ['a ← read a number'] })
    await tick()
    assert.deepEqual(a.received.at(-1), { type: 'anchor', stepId: 's1', file, line: 2, ghost: ['a ← read a number'] })
    const b = await connect(path)
    await tick()
    assert.equal(b.received[0]?.type, 'anchor', 'a new editor window gets the current marker')
    a.socket.destroy()
    b.socket.destroy()
  } finally {
    await bridge.close()
  }
})

test('feeling comes from editor activity: typing is flowing, a standing error or a long pause on a step is stuck', () => {
  assert.equal(feeling({ now: 10_000, lastEditAt: 5_000, errorsSince: null, stepOpen: true }).mood, 'flowing')
  assert.equal(feeling({ now: 100_000, lastEditAt: 50_000, errorsSince: null, stepOpen: true }).mood, 'ok')
  assert.deepEqual(feeling({ now: PAUSE_STUCK + 1000, lastEditAt: 0, errorsSince: null, stepOpen: true }), { mood: 'stuck', why: 'Paused 3 min' })
  assert.equal(feeling({ now: PAUSE_STUCK + 1000, lastEditAt: 0, errorsSince: null, stepOpen: false }).mood, 'ok', 'a pause with no step open is just thinking')
  assert.equal(feeling({ now: 20_000, lastEditAt: 19_000, errorsSince: 10_000, stepOpen: true }).mood, 'ok', 'a fresh error is normal')
  assert.equal(feeling({ now: SAME_ERROR_STUCK + 10_000, lastEditAt: SAME_ERROR_STUCK, errorsSince: 0, stepOpen: true }).mood, 'stuck')
  assert.equal(feeling({ now: 0, lastEditAt: null, errorsSince: null, stepOpen: false }).mood, 'ok')
})

test('the coach sees only project files, never secret ones, with secrets redacted and the cursor line marked', () => {
  assert.equal(visiblePath(ROOT, undefined, join(ROOT, 'Program.cs')), 'Program.cs')
  assert.equal(visiblePath(ROOT, undefined, join(ROOT, '..', 'todo-app', 'x.py')), null)
  assert.equal(visiblePath(ROOT, undefined, join(ROOT, '.env')), null)
  assert.equal(visiblePath(ROOT, ['Other.cs'], join(ROOT, 'Program.cs')), null, 'opened files only')
  assert.equal(visiblePath('', undefined, join(ROOT, 'Program.cs')), null, 'an idea has no folder')

  const text = ['using System;', 'var key = "x";', 'api_key = "abcd1234secret"', ''].join('\n')
  const view = editorContext(ROOT, undefined, snap({ text, line: 2, diagnostics: [{ line: 3, col: 1, severity: 'error', code: 'CS1002', message: '; expected' }] }), { mood: 'stuck', why: 'Same error for 2 min' })
  assert.match(view, /^\[BetterCoder editor:/)
  assert.match(view, /File: Program\.cs, cursor on line 2/)
  assert.match(view, /2> var key/)
  assert.match(view, /line 3: error CS1002 ; expected/)
  assert.match(view, /stuck \(Same error for 2 min\)/)
  assert.doesNotMatch(view, /abcd1234secret/)
  assert.match(editorContext(ROOT, undefined, snap({ file: '/elsewhere/a.cs' })), /outside this project/)
  assert.equal(editorContext(ROOT, undefined, snap({ file: join(ROOT, '.env'), text: 'SECRET=1' })).includes('SECRET'), false)
  assert.equal(editorContext(ROOT, undefined, null), '')
})

// The extension's ghost.js (the one place the rule lives now).
for (const [name, at] of [['extension ghost.js', ghostAt]] as const) {
  test(`ghost text (${name}): one pseudocode line at a time, on the blank line they are on, done when every line is typed`, () => {
    const ghost = ['first ← ask for a number', 'second ← ask for a number']
    const lines = ['class C', '{', '', '}']
    assert.deepEqual(at(lines, 2, 2, ghost), { ghost: { line: 2, text: ghost[0] }, done: false })
    assert.deepEqual(at(lines, 2, 0, ghost), { ghost: { line: 2, text: ghost[0] }, done: false }, 'before they get there, it waits on the marked line')
    const one = ['class C', '{', 'string first = Console.ReadLine();', '', '}']
    assert.deepEqual(at(one, 2, 3, ghost), { ghost: { line: 3, text: ghost[1] }, done: false })
    assert.deepEqual(at(one, 2, 2, ghost).ghost, null, 'never over their own text')
    const both = ['class C', '{', 'a', 'b', '}']
    assert.equal(at(both, 2, 3, ghost).done, true)
    assert.equal(at(both, 2, 3, ghost).ghost, null)
    assert.deepEqual(at(lines, 2, 2, []), { ghost: null, done: false })
    // Far below the step, the first line waits on the (still blank) marked line.
    const far = ['', '', '', '', '', '', '', '', '', 'x']
    assert.deepEqual(at(far, 0, 9, ghost), { ghost: { line: 0, text: ghost[0] }, done: false })
  })
}

test('typed lines count up as they write under the marked line, capped at the step length', () => {
  const lines = ['class C', '{', 'a', '', 'b', 'c', '}']
  assert.equal(typedCount(lines, 2, 1, 2), 0, 'not there yet')
  assert.equal(typedCount(lines, 2, 3, 2), 1)
  assert.equal(typedCount(lines, 2, 5, 2), 2)
  assert.equal(typedCount(lines, 2, 5, 0), 0)
})

test('a step card can mark a line in their file, inside the project only; an idea has no place to mark', async () => {
  const step = createVisualTools(realPorts(), ROOT, undefined).find((t) => t.name === 'show_step')!
  const r = await step.execute('1', { title: 'Read two numbers', lines: [{ text: 'first ← ask for a number' }], at: { path: 'Program.cs', line: 2 } } as never)
  assert.deepEqual((r.details as { anchor?: unknown }).anchor, { path: 'Program.cs', line: 2 })
  await assert.rejects(step.execute('2', { title: 'x', lines: [{ text: 'a ← b' }], at: { path: '../todo-app/app.py', line: 1 } } as never), /outside the project/)
  const idea = createVisualTools(realPorts(), '', undefined).find((t) => t.name === 'show_step')!
  const r2 = await idea.execute('3', { title: 'Plan', lines: [{ text: 'make a folder' }], at: { path: 'Program.cs', line: 1 } } as never)
  assert.equal((r2.details as { anchor?: unknown }).anchor, undefined)
})

test('with an editor linked: the coach gets its view on the request, marks the step, keeps progress hidden, and both come back after a restart', async () => {
  const faux = fauxProvider()
  const models = createModels()
  models.setProvider(faux.provider)
  const file = join(await mkdtemp(join(tmpdir(), 'bc-ide-coach-')), 's.sqlite')
  const steps: Array<AnchoredStep | null> = []
  const progress: TaskProgress[][] = []
  const events: HarnessEvent[] = []
  const seen: Array<{ messages: unknown[] }> = []
  const deps = {
    ports: realPorts(),
    models,
    resolveModel: async () => faux.getModel(),
    editorContext: () => '[BetterCoder editor: what the learner has open in VS Code right now.\nFile: Program.cs, cursor on line 2\nEnd of editor view.]',
    onStep: (s: AnchoredStep | null) => steps.push(s),
    onProgress: (t: TaskProgress[]) => progress.push(t)
  }
  const coach = track(await Coach.open(file, PROJECT, (e) => events.push(e), deps))
  const tasks = [
    { title: 'Read two numbers', percent: 0 },
    { title: 'Print the result', percent: 0 }
  ]
  faux.setResponses([
    (ctx) => (
      seen.push(ctx as never),
      fauxAssistantMessage(
        [
          fauxText('**Read two numbers first**'),
          fauxToolCall('track_progress', { tasks }),
          fauxToolCall('show_step', { title: 'Read two numbers', lines: [{ text: 'first ← ask for a number' }, { text: 'second ← ask for a number' }], at: { path: 'Program.cs', line: 2 } })
        ],
        { stopReason: 'toolUse' }
      )
    ),
    fauxAssistantMessage('this should never be requested')
  ])
  await coach.send('I have to make a calculator with ReadLine and WriteLine')
  await coach.waitForIdle()

  const request = JSON.stringify(seen[0].messages)
  assert.match(request, /\[BetterCoder editor: what the learner has open/, 'the editor view rides on the request')
  assert.deepEqual(progress, [tasks])
  const step = steps.at(-1)
  assert.equal(step?.path, 'Program.cs')
  assert.equal(step?.line, 2)
  assert.deepEqual(step?.ghost, ['first ← ask for a number', 'second ← ask for a number'])
  assert.ok(!events.some((e) => JSON.stringify(e).includes('Print the result')), 'progress is a meter, never a chat item')

  await coach.close()
  const again = track(await Coach.open(file, PROJECT, () => undefined, deps))
  assert.deepEqual(again.initialProgress, tasks, 'the meter is rebuilt from the transcript')
  assert.equal(again.initialStep?.id, step?.id, 'and the marker comes back')
  assert.ok(!again.initialItems.some((i) => JSON.stringify(i).includes('Print the result')))
  assert.ok(!JSON.stringify(again.initialItems).includes('[BetterCoder editor'), 'the editor view is never stored')
})

test('the hub sends the editor an absolute marker and a status line, and tells the panel when a step is typed out', () => {
  const sent: ToIde[] = []
  const views: IdeView[] = []
  let s = snap({ lastEditAt: 1000 })
  const hub = new IdeHub({ snapshot: () => s, send: (m) => sent.push(m) }, (v) => views.push(v), () => 2000)
  hub.setSession({ root: ROOT }, [{ title: 'Read two numbers', percent: 50 }], { id: 'card-1', path: 'Program.cs', line: 2, ghost: ['a ← read'] })
  assert.deepEqual(sent.find((m) => m.type === 'anchor'), { type: 'anchor', stepId: 'card-1', file: join(ROOT, 'Program.cs'), line: 2, ghost: ['a ← read'] })
  assert.deepEqual(sent.find((m) => m.type === 'status'), { type: 'status', text: 'Read two numbers 50% · flowing', tooltip: 'Typing steadily' })
  const v = views.at(-1)!
  assert.equal(v.file, 'Program.cs')
  assert.equal(v.mood, 'flowing')
  assert.equal(v.stepDone, false)
  s = snap({ lastEditAt: 1000, stepsDone: new Set(['card-1']) })
  hub.changed()
  assert.equal(views.at(-1)!.stepDone, true)
  hub.setSession(null)
  assert.equal(sent.at(-1)?.type === 'clear' || sent.some((m) => m.type === 'clear'), true, 'closing the session clears the marker')
  assert.ok(hub.view().otherFolder, 'with no project open, the panel can offer the editor folder')
})

test('open in editor: the request waits for VS Code to connect, then opens the file at the line', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bc-open-'))
  const path = join(dir, 'ide.sock')
  let now = 1000
  const bridge = new IdeBridge(() => undefined, () => now)
  await bridge.listen(path)
  try {
    const file = join(ROOT, 'Program.cs')
    bridge.send({ type: 'open', file, line: 12 }) // the Code tab is only now opening VS Code
    const a = await connect(path)
    await tick()
    assert.deepEqual(a.received.at(-1), { type: 'open', file, line: 12 })
    // Once delivered, it is not sent again to the next window.
    const b = await connect(path)
    await tick()
    assert.ok(!b.received.some((m) => m.type === 'open'))
    // Connected: sent at once. A request older than a minute is dropped.
    bridge.send({ type: 'open', file, line: 3 })
    await tick()
    assert.deepEqual(a.received.at(-1), { type: 'open', file, line: 3 })
    a.socket.destroy()
    b.socket.destroy()
    await tick()
    bridge.send({ type: 'open', file, line: 4 })
    now += 61_000
    const c = await connect(path)
    await tick()
    assert.ok(!c.received.some((m) => m.type === 'open'))
    c.socket.destroy()
  } finally {
    await bridge.close()
  }
})

test('lines typed: VS Code reports them for the marked step, and the panel shows them for that step only', () => {
  let view: IdeView | null = null
  const s = snap({ stepTyped: { stepId: 'card-7', n: 2 } })
  const feed = { snapshot: () => s, send: () => undefined }
  const hub = new IdeHub(feed, (v) => (view = v))
  hub.setSession({ root: ROOT }, [], { id: 'card-7', path: 'Program.cs', line: 2, ghost: ['a', 'b', 'c'] } as AnchoredStep)
  assert.equal(hub.view().typed, 2)
  hub.setStep({ id: 'card-8', path: 'Program.cs', line: 2, ghost: ['a'] } as AnchoredStep)
  assert.equal(hub.view().typed, 0, 'counts for another step do not carry over')
  assert.ok(view)
  assert.deepEqual(parseIdeMessage(JSON.stringify({ type: 'step_typed', stepId: 'card-8', n: 1 })), { type: 'step_typed', stepId: 'card-8', n: 1 })
  assert.equal(parseIdeMessage(JSON.stringify({ type: 'step_typed', stepId: 'card-8' })), null)
})
