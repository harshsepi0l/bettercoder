// ▶ Run pressed in VS Code: the app runs the file in its own terminal (so the coach sees the last run and errors get
// their plain-words line) and streams it back into the editor's "▶ Run" terminal.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { RunSummary } from '../src/shared/code'
import type { IdeCommand, ToIde } from '../src/shared/ide'
import { IdeBridge, parseIdeMessage } from '../src/main/adapters/ide-socket'
import { EditorRuns, type RunArea } from '../src/main/ipc/editor-runs'

const ROOT = '/work/todo-app'

function fakeArea() {
  const calls: unknown[][] = []
  let next = 1
  const area: RunArea = {
    async run(path, cols, rows) {
      calls.push(['run', path, cols, rows])
      if (path.endsWith('.txt')) throw new Error("SandboxError: Run works for Python for now. Use the terminal.")
      return { id: `t${next++}`, path, startedAt: 1, endedAt: null, exitCode: null, stopped: false, output: '', error: null, words: null } satisfies RunSummary
    },
    input: (id, data) => void calls.push(['input', id, data]),
    resize: (id, cols, rows) => void calls.push(['resize', id, cols, rows]),
    stop: (id) => void calls.push(['stop', id])
  }
  return { area, calls }
}

test('editor runs: a run from the editor starts in the app and only its own terminal is streamed back', async () => {
  const { area, calls } = fakeArea()
  const sent: ToIde[] = []
  const runs = new EditorRuns(area, () => ROOT, (m) => sent.push(m))

  await runs.command({ type: 'run', file: join(ROOT, 'src', 'main.py'), cols: 100, rows: 30 })
  assert.deepEqual(calls[0], ['run', 'src/main.py', 100, 30])
  const started = sent.at(-1)
  assert.ok(started?.type === 'term' && started.event.type === 'run' && started.event.run.id === 't1')

  runs.event({ type: 'data', id: 't1', data: 'Add a todo: ' })
  runs.event({ type: 'data', id: 'shell-9', data: 'secret shell output' }) // a terminal the editor didn't start
  assert.deepEqual(sent.at(-1), { type: 'term', event: { type: 'data', id: 't1', data: 'Add a todo: ' } })
  assert.equal(sent.filter((m) => m.type === 'term' && m.event.type === 'data').length, 1)

  // Keystrokes reach only the run it started.
  await runs.command({ type: 'term_input', id: 't1', data: 'milk\r' })
  await runs.command({ type: 'term_input', id: 'shell-9', data: 'rm -rf ~\r' })
  await runs.command({ type: 'term_resize', id: 't1', cols: 120, rows: 40 })
  await runs.command({ type: 'term_stop', id: 'shell-9' })
  await runs.command({ type: 'term_stop', id: 't1' })
  assert.deepEqual(calls.slice(1), [['input', 't1', 'milk\r'], ['resize', 't1', 120, 40], ['stop', 't1']])

  // After the session changes, its old runs are not the editor's any more.
  runs.reset()
  await runs.command({ type: 'term_input', id: 't1', data: 'x' })
  assert.equal(calls.length, 4)
})

test('editor runs: files outside the project are refused, and a refused run says why in words', async () => {
  const { area, calls } = fakeArea()
  const sent: ToIde[] = []
  const runs = new EditorRuns(area, () => ROOT, (m) => sent.push(m))

  await runs.command({ type: 'run', file: '/etc/hosts.py', cols: 80, rows: 24 })
  await runs.command({ type: 'run', file: join(ROOT, '..', 'other', 'x.py'), cols: 80, rows: 24 })
  assert.equal(calls.length, 0)
  assert.deepEqual(sent.map((m) => m.type), ['run_error', 'run_error'])

  await runs.command({ type: 'run', file: join(ROOT, 'notes.txt'), cols: 80, rows: 24 })
  assert.deepEqual(sent.at(-1), { type: 'run_error', file: join(ROOT, 'notes.txt'), message: 'Run works for Python for now. Use the terminal.' })

  // No project folder: nothing runs.
  const none = new EditorRuns(area, () => '', (m) => sent.push(m))
  await none.command({ type: 'run', file: join(ROOT, 'main.py'), cols: 80, rows: 24 })
  assert.equal(calls.length, 1)
})

test("editor runs: the run's problems go to the editor as underlines (syntax checks stay with the old editor)", () => {
  const sent: ToIde[] = []
  const runs = new EditorRuns(fakeArea().area, () => ROOT, (m) => sent.push(m))
  runs.problems({
    path: 'main.py',
    items: [
      { line: 10, col: 1, severity: 'error', code: 'NameError', message: "NameError: name 'b' is not defined", source: 'run' },
      { line: 3, col: 5, severity: 'error', message: 'invalid syntax', source: 'syntax' }
    ]
  })
  assert.deepEqual(sent, [
    { type: 'problems', file: join(ROOT, 'main.py'), items: [{ line: 10, col: 1, severity: 'error', code: 'NameError', message: "NameError: name 'b' is not defined" }] }
  ])
  runs.problems({ path: 'main.py', items: [] }) // the next run was clean: clear them
  assert.deepEqual(sent.at(-1), { type: 'problems', file: join(ROOT, 'main.py'), items: [] })
})

test('editor link: run and terminal messages are parsed strictly and handed to the Code area, not the snapshot', async () => {
  assert.deepEqual(parseIdeMessage(JSON.stringify({ type: 'run', file: '/a/b.py', cols: 90, rows: 20 })), { type: 'run', file: '/a/b.py', cols: 90, rows: 20 })
  assert.equal(parseIdeMessage(JSON.stringify({ type: 'run', file: '/a/b.py' })), null)
  const url = 'https://learn.microsoft.com/en-us/dotnet/api/system.console.readline'
  assert.deepEqual(parseIdeMessage(JSON.stringify({ type: 'official', url, term: 'Console.ReadLine' })), { type: 'official', url, term: 'Console.ReadLine' })
  assert.equal(parseIdeMessage(JSON.stringify({ type: 'official', url: 'file:///etc/passwd', term: 'x' })), null, 'only https links')
  assert.equal(parseIdeMessage(JSON.stringify({ type: 'term_input', id: 'x'.repeat(65), data: 'a' })), null)
  assert.equal(parseIdeMessage(JSON.stringify({ type: 'term_input', id: 't1', data: 'a'.repeat(70_000) })), null)
  assert.deepEqual(parseIdeMessage(JSON.stringify({ type: 'term_resize', id: 't1', cols: 5000, rows: 30 })), { type: 'term_resize', id: 't1', cols: 1000, rows: 30 })

  const dir = await mkdtemp(join(tmpdir(), 'bc-runs-'))
  const path = join(dir, 'ide.sock')
  const bridge = new IdeBridge(() => undefined)
  const got: IdeCommand[] = []
  bridge.onCommand((m) => got.push(m))
  await bridge.listen(path)
  try {
    const socket = createConnection(path)
    await new Promise<void>((r) => socket.once('connect', () => r()))
    socket.write(`${JSON.stringify({ type: 'hello', ide: 'code-server', folders: [ROOT] })}\n`)
    socket.write(`${JSON.stringify({ type: 'run', file: join(ROOT, 'main.py'), cols: 80, rows: 24 })}\n`)
    socket.write(`${JSON.stringify({ type: 'term_input', id: 't1', data: '7\r' })}\n`)
    await new Promise((r) => setTimeout(r, 40))
    assert.deepEqual(got, [
      { type: 'run', file: join(ROOT, 'main.py'), cols: 80, rows: 24 },
      { type: 'term_input', id: 't1', data: '7\r' }
    ])
    assert.equal(bridge.snapshot()?.ide, 'code-server')
    assert.equal(bridge.snapshot()?.file, null, 'a run is not where the cursor is')
    socket.destroy()
  } finally {
    await bridge.close()
  }
})
