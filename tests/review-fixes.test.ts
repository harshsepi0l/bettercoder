// Bugs found in the review of PR #4 (2026-11-14), one regression test each.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createModels, fauxAssistantMessage, fauxProvider } from '@earendil-works/pi-ai'
import type { Terminals } from '../src/main/ports'
import type { StoredTask } from '../src/main/ports'
import type { HarnessEvent } from '../src/shared/harness'
import { wholeUpdate, type TasksUpdate } from '../src/shared/tasks'
import { CodeArea } from '../src/main/ipc/code-area'
import { resolveInside } from '../src/main/adapters/fs-readonly'
import { TerminalHub } from '../src/main/services/terminals'
import { SessionTasks } from '../src/main/services/tasks'
import { WorkspaceController } from '../src/main/services/workspace'
import { WorkspaceStore } from '../src/main/adapters/store'
import { realPorts } from '../src/main/ipc/ports'
import { INTENTS } from '../src/main/coach/turn'
import { track } from './helpers'

const FIX = join(import.meta.dirname, 'fixtures')

/** Pretend terminals: spawn, type, print, exit, kill (a kill exits it). */
function terminals() {
  let next = 0
  const typed: string[] = []
  const data = new Set<(id: string, d: string) => void>()
  const exit = new Set<(id: string, c: number | null, s: number | null) => void>()
  const t: Terminals = {
    spawn: () => `f${++next}`,
    write: (_id, d) => void typed.push(d),
    resize: () => undefined,
    kill: (id) => exit.forEach((l) => l(id, null, 9)),
    onData: (l) => (data.add(l), () => data.delete(l)),
    onExit: (l) => (exit.add(l), () => exit.delete(l))
  }
  return { t, typed, print: (id: string, d: string) => data.forEach((l) => l(id, d)), end: (id: string, c: number) => exit.forEach((l) => l(id, c, null)) }
}

async function area() {
  const root = await mkdtemp(join(tmpdir(), 'bc-rev-'))
  await cp(join(FIX, 'session-check', 'sum-loop'), root, { recursive: true })
  const f = terminals()
  const hub = new TerminalHub(f.t)
  const lastRuns: unknown[] = []
  const a = new CodeArea({
    project: () => ({ sessionId: 's1', root }),
    ensureTheirs: async (r, rel, allowed) => void (await resolveInside(r, rel, allowed)),
    terminals: () => ({ hub }),
    plan: async () => ({ kind: 'run', command: '/usr/bin/python3', args: ['-u', 'sum.py'] }) as never,
    env: async () => ({}),
    problems: () => undefined,
    lastRun: (r) => lastRuns.push(r)
  })
  a.watchRuns(hub)
  return { a, hub, f, lastRuns }
}

test('the Tasks crash: tasks without steps (an older main process, or a file from before steps) are made whole', async () => {
  const old = JSON.parse(await readFile(join(FIX, 'tasks', 'before-steps.tasks'), 'utf8')) as StoredTask[]
  // Read by the service: every task has a plan, empty when it had none.
  assert.deepEqual(new SessionTasks(old, () => undefined, () => undefined).view().map((t) => t.steps), [[], []])
  // Received by the window from an older main process (no steps at all): made whole before any view reads it.
  const sent = { sessionId: 's', tasks: old.map(({ createdAt: _c, ...t }) => ({ ...t, answer: null })) } as unknown as TasksUpdate
  assert.deepEqual(wholeUpdate(sent).tasks.map((t) => t.steps), [[], []])
  assert.deepEqual(wholeUpdate({ sessionId: null } as unknown as TasksUpdate).tasks, [])
})

test('Check never hangs: closing the session mid-check ends the run, and whoever waits is told', async () => {
  const { a, hub } = await area()
  const done = a.runWith('sum.py', ['7'])
  await new Promise((r) => setTimeout(r, 5))
  hub.closeSession('s1')
  const { run } = await done
  assert.equal(run.stopped, true)
})

test('a Check run is not the learner’s run: it never becomes their last run', async () => {
  const { a, f, lastRuns } = await area()
  const done = a.runWith('sum.py', [])
  await new Promise((r) => setTimeout(r, 5))
  f.print('f1', '11\n')
  f.end('f1', 0)
  await done
  // (A first run of the session resets it to null; that is not a run.)
  assert.deepEqual(lastRuns.filter(Boolean), [], 'Check my answer and the coach still see their own last run')
  // Their own ▶ Run still does.
  const own = await a.run('sum.py', 80, 24)
  f.end(own.id, 0)
  assert.equal(lastRuns.filter(Boolean).length, 1)
})

test('Check waits through a silent build: the echo of what it typed does not start the quiet clock', async () => {
  const { a, f } = await area()
  const done = a.runWith('sum.py', ['7'], undefined, { quietMs: 40, limitMs: 2000, tickMs: 5 })
  await new Promise((r) => setTimeout(r, 5))
  f.print('f1', '7\r\n') // the terminal echoing what was typed
  await new Promise((r) => setTimeout(r, 120)) // building, nothing printed: longer than quietMs
  f.print('f1', 'Total: 7\n')
  f.end('f1', 0)
  const { timedOut } = await done
  assert.equal(timedOut, false)
  // After real output, silence does stop it (waiting for input that never comes).
  const stuck = a.runWith('sum.py', [], undefined, { quietMs: 40, limitMs: 2000, tickMs: 5 })
  await new Promise((r) => setTimeout(r, 5))
  f.print('f2', 'Number? ')
  assert.equal((await stuck).timedOut, true)
})

test('a done task given a new step opens again', () => {
  const tasks = new SessionTasks([], () => undefined, () => undefined)
  tasks.coachSet({ title: 'Safe input', doneWhen: '', answer: '', steps: ['Try it', 'Act on it'] })
  const pass = { at: 1, results: [], passed: true }
  tasks.recordStep('a', pass, { taskId: 't1', step: 1 })
  tasks.recordStep('b', pass, { taskId: 't1', step: 2 })
  assert.equal(tasks.view()[0].status, 'done')
  tasks.coachSet({ id: 't1', title: 'Safe input', doneWhen: '', answer: '', steps: ['Try it', 'Act on it', 'Ask again'] })
  assert.equal(tasks.view()[0].status, 'open')
  assert.deepEqual(tasks.view()[0].steps.map((s) => s.passed), [true, true, false])
})

test('the "task" button intent reaches the coach (the IPC uses the coach’s own list)', async () => {
  assert.ok(INTENTS.has('task'))
  const ipc = await readFile(join(import.meta.dirname, '..', 'src', 'main', 'ipc', 'coach.ts'), 'utf8')
  assert.match(ipc, /import \{ INTENTS \} from '..\/coach\/turn'/)
  assert.doesNotMatch(ipc, /const INTENTS = \[/)
})

test('Clear chat keeps ▶ Run programs, waits for task saves, and always opens the session again, even when clearing fails', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'bc-rev-ws-'))
  const projectDir = await mkdtemp(join(tmpdir(), 'bc-rev-proj-'))
  await writeFile(join(projectDir, 'calc.py'), 'a = input()\n')
  const faux = fauxProvider()
  const models = createModels()
  models.setProvider(faux.provider)
  const events: HarnessEvent[] = []
  const closed: string[] = []
  const store = new WorkspaceStore(dataDir)
  const controller = new WorkspaceController(store, {
    ports: realPorts(),
    emit: (e) => events.push(e),
    changed: () => {},
    models,
    resolveModel: async () => faux.getModel(),
    closed: (id) => closed.push(id)
  })
  track({ close: () => controller.shutdown() })
  const s = await controller.openFolder(projectDir)
  faux.setResponses([fauxAssistantMessage('**hi**')])
  await controller.send('hello')
  controller.addTask('Say no to dividing by 0')

  // A save still on its way when Clear chat reopens the session: the reopen reads it, not the older file.
  await controller.clearChat(s.session.id)
  assert.deepEqual(controller.tasks().tasks.map((t) => t.title), ['Say no to dividing by 0'])
  assert.deepEqual(closed, [], 'the session’s terminals (▶ Run) were not closed')

  // Clearing fails: the session still opens again, and the error says so.
  const real = store.clearConversation.bind(store)
  store.clearConversation = async () => {
    throw new Error('disk is full')
  }
  await assert.rejects(controller.clearChat(s.session.id), /could not be cleared: disk is full/)
  assert.equal(controller.activeSessionId(), s.session.id, 'not bricked: the session is open')
  store.clearConversation = real
})
