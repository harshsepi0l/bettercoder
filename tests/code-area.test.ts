import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FileProblems, RunSummary } from '../src/shared/code'
import type { Terminals, TerminalSpawn } from '../src/main/ports'
import { ToolMissingError, planRun } from '../src/main/core/runners'
import { CodeArea } from '../src/main/ipc/code-area'
import { resolveInside } from '../src/main/adapters/fs-readonly'
import { TerminalHub } from '../src/main/services/terminals'

const FIXTURE = join(import.meta.dirname, 'fixtures', 'todo-app')

function fakeTerminals() {
  let next = 0
  const spawned: TerminalSpawn[] = []
  const data = new Set<(id: string, d: string) => void>()
  const exit = new Set<(id: string, c: number | null, s: number | null) => void>()
  const t: Terminals = {
    spawn: (o) => (spawned.push(o), `f${++next}`),
    write: () => undefined,
    resize: () => undefined,
    kill: () => undefined,
    onData: (l) => (data.add(l), () => data.delete(l)),
    onExit: (l) => (exit.add(l), () => exit.delete(l))
  }
  return { t, spawned, print: (id: string, d: string) => data.forEach((l) => l(id, d)), end: (id: string, c: number) => exit.forEach((l) => l(id, c, null)) }
}

async function setup(opts: { files?: string[] } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'bc-area-'))
  await cp(FIXTURE, root, { recursive: true })
  const problems: FileProblems[] = []
  const runs: Array<RunSummary | null> = []
  const f = fakeTerminals()
  const hub = new TerminalHub(f.t)
  const area = new CodeArea({
    project: () => ({ sessionId: 's1', root, files: opts.files }),
    ensureTheirs: async (r, rel, allowed) => void (await resolveInside(r, rel, allowed)),
    terminals: () => ({ hub }),
    // The real run rules, with a pretend computer that has Python and clang but no Kotlin.
    plan: async (_root, rel) =>
      planRun(
        { path: rel, python: '/usr/bin/python3', csproj: null, swiftPackage: null, buildDir: '/tmp/bc-run/t' },
        { command: (t) => ({ clang: '/usr/bin/clang', java: '/usr/bin/java' } as Record<string, string>)[t] ?? null, major: () => null }
      ),
    env: async () => ({ PATH: '/usr/bin' }),
    problems: (p) => problems.push(p),
    lastRun: (r) => runs.push(r)
  })
  area.watchRuns(hub)
  return { root, area, problems, runs, f }
}

test('▶ Run starts their Python on the file in the project folder; its traceback becomes an underline and the last run', async () => {
  const { root, area, problems, runs, f } = await setup()
  const run = await area.run('app.py', 100, 30)
  assert.deepEqual(f.spawned.at(-1), { command: '/usr/bin/python3', args: ['-u', 'app.py'], cwd: root, env: { PATH: '/usr/bin' }, cols: 100, rows: 30 })
  f.print(run.id, `Traceback (most recent call last):\n  File "${root}/app.py", line 3, in <module>\nNameError: name 'b' is not defined\n`)
  f.end(run.id, 1)
  assert.deepEqual(problems.at(-1), {
    path: 'app.py',
    items: [{ line: 3, col: 1, severity: 'error', code: 'NameError', message: "NameError: name 'b' is not defined", source: 'run' }]
  })
  assert.equal(runs.at(-1)?.words, 'Line 3 uses b before it exists.')
  assert.equal(area.lastRun()?.exitCode, 1)

  // A clean run clears the old run's underline.
  const ok = await area.run('app.py', 80, 24)
  f.end(ok.id, 0)
  assert.deepEqual(problems.at(-1), { path: 'app.py', items: [] })
})

test('Run says why a file can’t run, and runs only files of this project', async () => {
  const { root, area } = await setup({ files: ['todos.py', 'notes.md'] })
  await writeFile(join(root, 'notes.md'), '# notes\n')
  await assert.rejects(area.run('notes.md', 80, 24), /doesn't know \.md yet/)
  await assert.rejects(area.run('app.py', 80, 24), /only see the files you opened|not one of the files/)
})

test('Run runs other languages too, and a missing tool comes with its official install page', async () => {
  const { root, area, f } = await setup()
  await writeFile(join(root, 'hello.c'), 'int main(void) { return 0; }\n')
  await area.run('hello.c', 80, 24)
  assert.deepEqual(f.spawned.at(-1)?.args, ['-c', '/usr/bin/clang -g hello.c -o /tmp/bc-run/t/program && /tmp/bc-run/t/program'])
  await writeFile(join(root, 'Main.kt'), 'fun main() {}\n')
  await assert.rejects(area.run('Main.kt', 80, 24), (err: unknown) => {
    assert.ok(err instanceof ToolMissingError)
    assert.equal(err.install.url, 'https://kotlinlang.org/docs/command-line.html')
    return true
  })
})
