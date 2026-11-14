// Checked steps (2026-11-14): Check runs their file with each check's inputs and grades the run with fixed rules.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gradeCheck } from '../src/main/core/step-check'
import { expectWords, stepKey, type RunCheck } from '../src/shared/step-checks'
import type { RunSummary } from '../src/shared/code'

const out = (name: string) => readFileSync(join(import.meta.dirname, 'fixtures', 'run-output', name), 'utf8')
const run = (output: string, exitCode = 0, extra: Partial<RunSummary> = {}): RunSummary => ({
  id: 't1', path: 'Program.cs', startedAt: 0, endedAt: 1, exitCode, stopped: false, output, error: null, words: null, ...extra
})

test('the words come from the app: what to type, then what should happen', () => {
  const c: RunCheck = { inputs: ['7', '3', '+'], expect: [{ kind: 'prints_number', value: 10 }] }
  assert.equal(expectWords(c, c.expect[0]), 'Type 7, then 3, then +: it prints 10')
  assert.equal(expectWords({ inputs: [], expect: [] }, { kind: 'no_crash' }), "Run it: it doesn't crash")
  assert.equal(stepKey('T', [c]), stepKey('T', [{ ...c }]), 'the same card gets the same key')
})

test('a right answer passes; a typed number never counts as printed', () => {
  const c: RunCheck = { inputs: ['7', '5', '+'], expect: [{ kind: 'prints_number', value: 12 }, { kind: 'no_crash' }] }
  assert.deepEqual(gradeCheck(c, run(out('calculator-adds.txt')), false).map((r) => r.pass), [true, true])
  assert.equal(gradeCheck({ ...c, expect: [{ kind: 'prints_number', value: 35 }] }, run(out('calculator-adds.txt')), false)[0].why, 'It printed 12, not 35.')
  // They typed 3: an echoed 3 is not "it printed 3".
  const three: RunCheck = { inputs: ['3'], expect: [{ kind: 'prints_number', value: 3 }] }
  const r = gradeCheck(three, run('Number? 3\nDone\n'), false)[0]
  assert.equal(r.pass, false)
  assert.equal(r.why, 'It printed no number.')
  // The same for words: typing 1 never counts as showing 1 (a real check from the session check, 2026-11-14).
  const echoed: RunCheck = { inputs: ['nope', '1', '+'], expect: [{ kind: 'not_prints', text: '1' }, { kind: 'prints', text: 'not valid' }] }
  assert.deepEqual(gradeCheck(echoed, run('What is your first number?\nnope\n1\n+\nThat is not valid.\n'), false).map((x) => x.pass), [true, true])
})

test('bad input: a crash, a hang, and a prompt that should be skipped all fail with plain words', () => {
  const c: RunCheck = { inputs: ['abc'], expect: [{ kind: 'no_crash' }, { kind: 'not_prints', text: 'What is your second number?' }] }
  const crashed = gradeCheck(c, run(out('calculator-bad-input.txt'), 134, { error: { type: 'FormatException', message: 'x', path: 'Program.cs', line: 9 }, words: 'Line 9 tried to turn text that is not a number into one.' }), false)
  assert.deepEqual(crashed.map((r) => r.pass), [false, false])
  assert.equal(crashed[0].why, 'Line 9 tried to turn text that is not a number into one.')
  assert.equal(crashed[1].why, 'It still showed “What is your second number?”.')
  const hung = gradeCheck(c, run('What is your first number?\nabc\n', null as never), true)
  assert.match(hung[0].why, /waiting for more input/)
  const fixed = gradeCheck(c, run('What is your first number?\nabc\nNot a number\n'), false)
  assert.deepEqual(fixed.map((r) => r.pass), [true, true])
})

// ── The whole Check flow ────────────────────────────────────────────

import { cp, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from '@earendil-works/pi-ai'
import type { Terminals } from '../src/main/ports'
import type { HarnessEvent } from '../src/shared/harness'
import { CodeArea } from '../src/main/ipc/code-area'
import { resolveInside } from '../src/main/adapters/fs-readonly'
import { TerminalHub } from '../src/main/services/terminals'
import { SessionTasks } from '../src/main/services/tasks'
import { WorkspaceController } from '../src/main/services/workspace'
import { WorkspaceStore } from '../src/main/adapters/store'
import { realPorts } from '../src/main/ipc/ports'
import { track } from './helpers'

test('a task with steps: each step passes on its own Check; all steps passed is the task done; the coach sees which passed', () => {
  const tasks = new SessionTasks([], () => undefined, () => undefined)
  tasks.coachSet({ title: 'Handle a bad first number', doneWhen: '', answer: '', steps: ['Try to turn it into a number', 'Act on whether it worked'] })
  assert.match(tasks.forCoach(), /Steps: 1 not yet \(Try to turn it into a number\); 2 not yet/)
  const pass = { at: 1, results: [{ line: 'x', pass: true, why: '' }], passed: true }
  tasks.recordStep('k1', { ...pass, passed: false }, { taskId: 't1', step: 1 })
  assert.equal(tasks.view()[0].steps[0].passed, false, 'a failed Check passes nothing')
  tasks.recordStep('k1', pass, { taskId: 't1', step: 1 })
  assert.deepEqual(tasks.view()[0].steps.map((s) => s.passed), [true, false])
  assert.equal(tasks.view()[0].status, 'open')
  tasks.recordStep('k2', pass, { taskId: 't1', step: 2 })
  assert.equal(tasks.view()[0].status, 'done')
  assert.equal(tasks.runs().k2.passed, true)
  assert.throws(() => tasks.check('t1', null), /step by step/)
  // A copy for another session starts fresh.
  assert.deepEqual(tasks.copies(['t1'])[0].steps?.map((s) => s.passed), [false, false])
  // Neither steps nor an answer: not a task.
  assert.throws(() => tasks.coachSet({ title: 'Make it nicer', doneWhen: '', answer: '' }), /steps, or done_when/)
})

test('Check runs their file with the inputs typed in, line by line, and stops one that keeps waiting', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bc-check-'))
  await cp(join(import.meta.dirname, 'fixtures', 'session-check', 'sum-loop'), root, { recursive: true })
  let next = 0
  const typed: string[] = []
  const killed: string[] = []
  const data = new Set<(id: string, d: string) => void>()
  const exit = new Set<(id: string, c: number | null, s: number | null) => void>()
  const t: Terminals = {
    spawn: () => `f${++next}`,
    write: (_id, d) => void typed.push(d),
    resize: () => undefined,
    kill: (id) => {
      killed.push(id)
      exit.forEach((l) => l(id, null, 9))
    },
    onData: (l) => (data.add(l), () => data.delete(l)),
    onExit: (l) => (exit.add(l), () => exit.delete(l))
  }
  const hub = new TerminalHub(t)
  const area = new CodeArea({
    project: () => ({ sessionId: 's1', root }),
    ensureTheirs: async (r, rel, allowed) => void (await resolveInside(r, rel, allowed)),
    terminals: () => ({ hub }),
    plan: async () => ({ kind: 'run', command: '/usr/bin/python3', args: ['-u', 'sum.py'] }) as never,
    env: async () => ({}),
    problems: () => undefined
  })
  area.watchRuns(hub)
  const started: string[] = []
  const done = area.runWith('sum.py', ['7', 'abc'], (r) => started.push(r.id))
  await new Promise((r) => setTimeout(r, 5))
  data.forEach((l) => l('f1', '11\n'))
  exit.forEach((l) => l('f1', 0, null))
  const { run, timedOut } = await done
  assert.deepEqual(typed, ['7\r', 'abc\r'])
  assert.deepEqual(started, ['f1'], 'the editor is told so it can show the run')
  assert.equal(timedOut, false)
  assert.equal(run.output.trim(), '11')
  // Waiting for input that never comes: stopped after the time limit.
  const stuck = await area.runWith('sum.py', [], undefined, 30)
  assert.equal(stuck.timedOut, true)
  assert.deepEqual(killed, ['f2'])
})

test('workspace: the coach plans a task and shows a checked step; Check passes it and the coach sees it passed', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'bc-steps-ws-'))
  const projectDir = await mkdtemp(join(tmpdir(), 'bc-steps-proj-'))
  await writeFile(join(projectDir, 'Program.cs'), 'Console.WriteLine("What is your first number?");\n')
  const faux = fauxProvider()
  const models = createModels()
  models.setProvider(faux.provider)
  const events: HarnessEvent[] = []
  const controller = new WorkspaceController(new WorkspaceStore(dataDir), {
    ports: realPorts(),
    emit: (e) => events.push(e),
    changed: () => {},
    models,
    resolveModel: async () => faux.getModel()
  })
  track({ close: () => controller.shutdown() })
  await controller.openFolder(projectDir)
  const checks = [{ inputs: ['abc'], expect: [{ kind: 'no_crash' }, { kind: 'not_prints', text: 'What is your second number?' }] }]
  faux.setResponses([
    fauxAssistantMessage(
      [
        fauxText('**Handle a bad number**'),
        fauxToolCall('set_task', { title: 'Handle a bad first number', steps: ['Try to turn it into a number', 'Act on whether it worked'] }),
        fauxToolCall('show_step', { title: 'Act on whether it worked', lines: [{ text: 'if not ok ← say it is not a number, stop' }], checks, task_id: 't1', step_number: 2 })
      ],
      { stopReason: 'toolUse' }
    )
  ])
  await controller.send('help me handle bad input')
  for (let i = 0; i < 400 && !events.some((e) => e.type === 'card' && e.card.kind === 'step'); i++) await new Promise((r) => setTimeout(r, 5))
  const card = events.flatMap((e) => (e.type === 'card' && e.card.kind === 'step' ? [e.card] : []))[0]
  assert.deepEqual(card?.of, { taskId: 't1', step: 2 })
  assert.equal(card?.checks?.length, 1)

  const asked: Array<[string, readonly string[]]> = []
  const result = await controller.checkStep(card!.title, card!.checks!, 'Program.cs', card!.of!, async (path, inputs) => {
    asked.push([path, inputs])
    return { run: { id: 'r', path, startedAt: 0, endedAt: 1, exitCode: 0, stopped: false, output: 'What is your first number?\nabc\nNot a number\n', error: null, words: null }, timedOut: false }
  })
  assert.deepEqual(asked, [['Program.cs', ['abc']]])
  assert.equal(result.passed, true)
  assert.deepEqual(controller.tasks().tasks[0].steps.map((s) => s.passed), [false, true])
  assert.equal(Object.values(controller.tasks().steps ?? {})[0]?.passed, true)
})

test('a check that types code, or has nothing to expect, is sent back to the coach', async () => {
  const { openCoach } = await import('./helpers')
  const root = join(import.meta.dirname, 'fixtures', 'session-check', 'calculator')
  const { faux, session, events } = await openCoach({ root, name: 'calc', stacks: ['C#'], manifests: [], languages: [{ name: 'C#', files: 1 }], fileCount: 2, git: null })
  const errors: string[] = []
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall('show_step', { title: 'T', lines: [{ text: 'a ← read a line' }], checks: [{ inputs: ['Console.WriteLine("hi");'], expect: [{ kind: 'no_crash' }] }] })], { stopReason: 'toolUse' }),
    (ctx) => {
      errors.push(JSON.stringify((ctx as { messages: unknown[] }).messages.at(-1)))
      return fauxAssistantMessage([fauxToolCall('show_step', { title: 'T', lines: [{ text: 'a ← read a line' }], checks: [{ inputs: ['abc'], expect: [{ kind: 'prints' }] }] })], { stopReason: 'toolUse' })
    },
    (ctx) => {
      errors.push(JSON.stringify((ctx as { messages: unknown[] }).messages.at(-1)))
      return fauxAssistantMessage('**ok**')
    }
  ])
  await session.send('next')
  await session.waitForIdle()
  assert.match(errors[0], /A check looks like code/)
  assert.match(errors[1], /Each check needs at least one expect/)
  assert.ok(!events.some((e: HarnessEvent) => e.type === 'card'), 'no card with a bad check is shown')
})
