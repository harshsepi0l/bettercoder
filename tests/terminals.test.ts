import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { RunSummary, TerminalEvent } from '../src/shared/code'
import type { Terminals, TerminalSpawn } from '../src/main/ports'
import { MAX_RUN_OUTPUT, TerminalHub, plainOutput } from '../src/main/services/terminals'
import { createTerminals } from '../src/main/adapters/pty'

/** Terminals that do nothing on their own: the test plays the program's output and exit. */
function fakeTerminals() {
  let next = 0
  const spawned: TerminalSpawn[] = []
  const written: Array<[string, string]> = []
  const killed: string[] = []
  const data = new Set<(id: string, d: string) => void>()
  const exit = new Set<(id: string, c: number | null, s: number | null) => void>()
  const t: Terminals = {
    spawn: (o) => {
      spawned.push(o)
      return `f${++next}`
    },
    write: (id, d) => void written.push([id, d]),
    resize: () => undefined,
    kill: (id) => void killed.push(id),
    onData: (l) => (data.add(l), () => data.delete(l)),
    onExit: (l) => (exit.add(l), () => exit.delete(l))
  }
  return {
    t,
    spawned,
    written,
    killed,
    print: (id: string, d: string) => data.forEach((l) => l(id, d)),
    end: (id: string, code: number | null) => exit.forEach((l) => l(id, code, null))
  }
}

const ROOT = '/Users/me/calc'
const spawn = (command = 'python', args: string[] = []): TerminalSpawn => ({ command, args, cwd: ROOT, env: {}, cols: 80, rows: 24 })

test('terminals belong to their session: other sessions cannot type into them or stop them', () => {
  const f = fakeTerminals()
  const hub = new TerminalHub(f.t)
  const shell = hub.startRun('s1', ROOT, 'main.py', spawn()).id
  hub.input('s1', shell, 'ls\r')
  hub.input('s2', shell, 'rm -rf .\r')
  hub.stop('s2', shell)
  assert.deepEqual(f.written, [[shell, 'ls\r']])
  assert.deepEqual(f.killed, [])
  hub.closeSession('s1')
  assert.deepEqual(f.killed, [shell], 'closing the session ends its terminals')
  assert.equal(hub.owns('s1', shell), false)
})

test('a crashed run keeps its real output, its error in plain words, and the line to underline', () => {
  const f = fakeTerminals()
  const events: TerminalEvent[] = []
  const ended: Array<{ run: RunSummary; problems: unknown }> = []
  let now = 1000
  const hub = new TerminalHub(f.t, () => now)
  hub.onEvent((e) => events.push(e))
  hub.onRunEnd((_s, run, problems) => ended.push({ run, problems }))
  const run = hub.startRun('s1', ROOT, 'main.py', spawn())
  f.print(run.id, 'First number: \x1b[32m7\x1b[0m\r\n')
  f.print(run.id, `Traceback (most recent call last):\r\n  File "${ROOT}/main.py", line 10, in <module>\r\n    print(op(a, b))\r\nNameError: name 'b' is not defined\r\n`)
  now = 1500
  f.end(run.id, 1)
  const done = hub.lastRun('s1')!
  assert.equal(done.exitCode, 1)
  assert.equal(done.endedAt, 1500)
  assert.match(done.output, /^First number: 7\nTraceback/, 'colour codes removed, the words kept as printed')
  assert.match(done.output, /NameError: name 'b' is not defined/)
  assert.deepEqual(done.error, { type: 'NameError', message: "name 'b' is not defined", path: 'main.py', line: 10 })
  assert.equal(done.words, 'Line 10 uses b before it exists.')
  assert.deepEqual(ended[0].problems, {
    path: 'main.py',
    items: [{ line: 10, col: 1, severity: 'error', code: 'NameError', message: "NameError: name 'b' is not defined" }]
  })
  assert.deepEqual(events.filter((e) => e.type !== 'data').map((e) => e.type), ['run', 'exit', 'run'])
})

test('a stopped run is marked stopped, with no error words; a clean run has no problems', () => {
  const f = fakeTerminals()
  const hub = new TerminalHub(f.t)
  const loop = hub.startRun('s1', ROOT, 'loop.py', spawn())
  hub.stop('s1', loop.id)
  assert.deepEqual(f.killed, [loop.id])
  f.print(loop.id, 'Traceback (most recent call last):\n  File "loop.py", line 3, in <module>\nKeyboardInterrupt\n')
  f.end(loop.id, null)
  assert.equal(hub.lastRun('s1')!.stopped, true)
  assert.equal(hub.lastRun('s1')!.words, null)

  const ok = hub.startRun('s1', ROOT, 'main.py', spawn())
  f.print(ok.id, 'Saved 1 todo.\n')
  f.end(ok.id, 0)
  assert.equal(hub.lastRun('s1')!.path, 'main.py')
  assert.equal(hub.lastRun('s1')!.error, null)
})

test('only the newest 1 MB of a run\'s output is kept', () => {
  const f = fakeTerminals()
  const hub = new TerminalHub(f.t)
  const run = hub.startRun('s1', ROOT, 'spam.py', spawn())
  const chunk = 'x'.repeat(64 * 1024) + '\n'
  for (let i = 0; i < 40; i++) f.print(run.id, chunk)
  f.print(run.id, 'THE END\n')
  f.end(run.id, 0)
  const out = hub.lastRun('s1')!.output
  assert.ok(out.length <= MAX_RUN_OUTPUT)
  assert.match(out, /THE END\n$/)
})

test('plain output: colours gone, progress bars keep their last state', () => {
  assert.equal(plainOutput('\x1b[1;31mred\x1b[0m\r\n10%\r50%\r100%\r\n'), 'red\n100%\n')
})

test('a real pseudo-terminal: input reaches the program, and kill ends what it started', async (t) => {
  let pty: typeof import('node-pty')
  try {
    pty = await import('node-pty')
  } catch {
    return t.skip('node-pty is not available here')
  }
  const terms = createTerminals(pty)
  let out = ''
  const exits: Array<number | null> = []
  terms.onData((_id, d) => (out += d))
  terms.onExit((_id, code) => exits.push(code))
  const id = terms.spawn({ command: '/bin/sh', args: ['-c', 'read x; echo "got:$x"; exit 4'], cwd: process.cwd(), env: { PATH: '/usr/bin:/bin' }, cols: 80, rows: 24 })
  terms.write(id, 'hello\r')
  for (let i = 0; i < 100 && exits.length === 0; i++) await new Promise((r) => setTimeout(r, 20))
  assert.match(out, /got:hello/)
  assert.deepEqual(exits, [4])

  const loop = terms.spawn({ command: '/bin/sh', args: ['-c', 'sleep 30 & wait'], cwd: process.cwd(), env: { PATH: '/usr/bin:/bin' }, cols: 80, rows: 24 })
  await new Promise((r) => setTimeout(r, 100))
  terms.kill(loop)
  for (let i = 0; i < 100 && exits.length < 2; i++) await new Promise((r) => setTimeout(r, 20))
  assert.equal(exits.length, 2, 'the killed terminal exited')
})
