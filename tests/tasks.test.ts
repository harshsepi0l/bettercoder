import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from '@earendil-works/pi-ai'
import type { RunSummary } from '../src/shared/code'
import type { HarnessEvent } from '../src/shared/harness'
import type { TasksUpdate } from '../src/shared/tasks'
import { checkAnswer, outputHas } from '../src/main/core/task-check'
import { SessionTasks } from '../src/main/services/tasks'
import { WorkspaceController } from '../src/main/services/workspace'
import { WorkspaceStore } from '../src/main/adapters/store'
import type { StoredTask } from '../src/main/ports'
import { realPorts } from '../src/main/ipc/ports'
import { legacyTaskTitles } from '../src/main/coach/replay'
import type { EntryRecord } from '@earendil-works/pi-durable'
import { track } from './helpers'

const FIXTURES = join(import.meta.dirname, 'fixtures', 'run-output')

function run(output: string, more: Partial<RunSummary> = {}): RunSummary {
  return { id: 'r1', path: 'Program.cs', startedAt: 1, endedAt: 2, exitCode: 0, stopped: false, output, error: null, words: null, ...more }
}

test('check my answer: a number matches by value anywhere in the output; text ignores case and spacing', async () => {
  const adds = await readFile(join(FIXTURES, 'calculator-adds.txt'), 'utf8')
  const multiplies = await readFile(join(FIXTURES, 'calculator-multiplies.txt'), 'utf8')
  assert.equal(outputHas(multiplies, '35'), true, '35 = 35.0')
  assert.equal(outputHas(adds, '35'), false)
  assert.equal(outputHas('Result:   CANNOT divide by 0\n', 'cannot divide by 0'), true)
  assert.equal(outputHas('3.5\n', '3,5'), true)
  assert.equal(outputHas('', ''), false)

  assert.equal(checkAnswer('35', run(multiplies), 9).result, 'matched')
  const no = checkAnswer('35', run(adds), 9)
  assert.equal(no.result, 'not_yet')
  assert.match(no.words, /“12”/, 'says what their run ended with')
  assert.ok(!no.words.includes('35'), 'never the answer')
})

test('check my answer: no run, a run still going, a stopped run and a crash are not answers', () => {
  assert.equal(checkAnswer('35', null, 1).result, 'no_run')
  assert.equal(checkAnswer('35', run('35', { endedAt: null }), 1).result, 'no_run')
  assert.equal(checkAnswer('35', run('35', { stopped: true }), 1).result, 'no_run')
  const crash = checkAnswer('35', run('35\nTraceback…', { exitCode: 1, words: 'Line 8 uses count before it exists.' }), 1)
  assert.equal(crash.result, 'not_yet')
  assert.match(crash.words, /crashed.*Line 8/)
})

test('session tasks: the learner adds one, the coach writes its check, the answer stays sealed until it matches', async () => {
  const saved: StoredTask[][] = []
  const notices: unknown[] = []
  const tasks = new SessionTasks([], (t) => saved.push([...t]), (n) => notices.push(n), () => 100)

  const mine = tasks.addMine('  Say no to   ÷ 0 ')
  assert.equal(mine.status, 'waiting')
  assert.equal(mine.title, 'Say no to ÷ 0')
  assert.match(tasks.forCoach(), /t1 Say no to ÷ 0 \(added by the learner\): WAITING/)
  assert.throws(() => tasks.check('t1', null), /not written how to check/)

  tasks.coachSet({ id: 't1', title: 'Say no to ÷ 0', doneWhen: 'Run it with 7, 0 and /', answer: 'Cannot divide by 0' })
  const coach = tasks.coachSet({ title: 'Multiply too', doneWhen: 'Run it with 7, 5 and *: it prints the answer', answer: '35' })
  assert.equal(coach.id, 't2')
  assert.deepEqual(notices.at(-1), { kind: 'added', taskId: 't2', title: 'Multiply too', by: 'coach', words: 'Coach added a task' })
  assert.equal(tasks.coachSet({ title: 'multiply TOO', doneWhen: 'Run it with 6, 5 and *', answer: '30' }).id, 't2', 'same title: updated, not added twice')
  assert.throws(() => tasks.coachSet({ id: 't9', title: 'x y', doneWhen: 'run it', answer: '1' }), /no task t9/)

  for (const view of [JSON.stringify(tasks.view()), tasks.forCoach()]) assert.ok(!view.includes('30') && !view.includes('Cannot divide'), 'answers stay sealed')
  assert.equal(tasks.statusLine(), 'Say no to ÷ 0 · 0 of 2 done')

  const adds = await readFile(join(FIXTURES, 'calculator-adds.txt'), 'utf8')
  assert.equal(tasks.check('t2', run(adds)).result, 'not_yet')
  assert.equal(tasks.view()[1].status, 'open')
  assert.equal(tasks.check('t2', run('Operation: *\n30\n')).result, 'matched')
  const done = tasks.view()[1]
  assert.equal(done.status, 'done')
  assert.equal(done.answer, '30', 'shown once it matched')
  assert.equal((notices.at(-1) as { kind: string }).kind, 'matched')
  assert.equal(saved.at(-1)?.[1].status, 'done', 'every change is saved')

  const copies = tasks.copies(['t1', 't2'])
  assert.deepEqual(
    copies.map((t) => [t.title, t.status, t.check, t.answer]),
    [
      ['Say no to ÷ 0', 'open', null, 'Cannot divide by 0'],
      ['multiply TOO', 'open', null, '30']
    ],
    'sent tasks start fresh, answers kept'
  )
})

test('tasks are kept beside the session, never read as a session, and deleted with it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bc-tasks-store-'))
  const store = new WorkspaceStore(dir)
  const project = await store.upsertProject('/tmp/x', 'x')
  const session = await store.createSession(project.id)
  assert.equal(await store.loadTasks(session), null, 'never saved: null (a session from before Tasks)')
  const task: StoredTask = { id: 't1', title: 'Add two numbers', by: 'coach', doneWhen: 'Run it with 7 and 5', answer: '12', status: 'open', check: null, createdAt: 1 }
  await store.saveTasks(session, [task])
  assert.deepEqual(await store.loadTasks(session), [task])
  assert.equal((await store.list())[0].sessions.length, 1, 'the tasks file is not listed as a session')
  await writeFile(join(dir, 'projects', project.id, 'sessions', `${session.id}.tasks`), 'not json')
  assert.equal(await store.loadTasks(session), null, 'a broken file is no tasks, not a crash')
  await store.saveTasks(session, [])
  assert.deepEqual(await store.loadTasks(session), [], 'all removed is not the same as never saved')
  await store.deleteSession(session.id)
  assert.deepEqual(await readdir(join(dir, 'projects', project.id, 'sessions')), [])
})

test('workspace: the coach adds a task, Check my answer finishes it, and Send starts a new session with it, fresh', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'bc-tasks-ws-'))
  const projectDir = await mkdtemp(join(tmpdir(), 'bc-tasks-proj-'))
  await writeFile(join(projectDir, 'calc.py'), 'a = input()\n')
  const faux = fauxProvider()
  const models = createModels()
  models.setProvider(faux.provider)
  const events: HarnessEvent[] = []
  const updates: TasksUpdate[] = []
  const make = () => {
    const controller = new WorkspaceController(new WorkspaceStore(dataDir), {
      ports: realPorts(),
      emit: (e) => events.push(e),
      changed: () => {},
      models,
      resolveModel: async () => faux.getModel(),
      tasksChanged: (u) => updates.push(u)
    })
    track({ close: () => controller.shutdown() })
    return controller
  }
  const controller = make()
  const first = await controller.openFolder(projectDir)
  faux.setResponses([
    fauxAssistantMessage([fauxText('**Start with adding**'), fauxToolCall('set_task', { title: 'Add two numbers', done_when: 'Run it with 7 and 5: it prints the sum', answer: '12' })], {
      stopReason: 'toolUse'
    })
  ])
  await controller.send('I need a calculator')
  for (let i = 0; i < 400 && controller.tasks().tasks.length === 0; i++) await new Promise((r) => setTimeout(r, 5))
  assert.deepEqual(
    controller.tasks().tasks.map((t) => [t.id, t.title, t.status, t.answer]),
    [['t1', 'Add two numbers', 'open', null]]
  )
  assert.equal(updates.at(-1)?.notice?.kind, 'added')

  controller.addTask('Say no to ÷ 0')
  assert.equal(controller.checkTask('t1', run('7\n5\n12\n')).result, 'matched')
  assert.equal(controller.tasks().tasks[0].status, 'done')

  const second = await controller.sendTasks(['t1', 't2'], { kind: 'new' })
  assert.notEqual(second.session.id, first.session.id)
  assert.equal(second.project.id, first.project.id, 'same project')
  assert.deepEqual(
    controller.tasks().tasks.map((t) => [t.title, t.status]),
    [
      ['Add two numbers', 'open'],
      ['Say no to ÷ 0', 'waiting']
    ]
  )
  await assert.rejects(controller.sendTasks(['t1'], { kind: 'session', sessionId: second.session.id }), /already in this session/)
  await controller.shutdown()

  // After a restart, both sessions still have their tasks.
  const again = make()
  await again.openSession(first.session.id)
  assert.equal(again.tasks().tasks[0].status, 'done')
  assert.equal(again.tasks().tasks.length, 2)
})

test('regression: a session from before Tasks brings its old progress tasks over, waiting for the coach to write their checks', async () => {
  // The newest track_progress list of a real session (the coach never called set_task: it had already set them).
  const entries = JSON.parse(await readFile(join(import.meta.dirname, 'fixtures', 'legacy-progress', 'entries.json'), 'utf8')) as EntryRecord[]
  const titles = legacyTaskTitles(entries)
  assert.deepEqual(titles, ['Read two numbers', 'Pick and run operation', 'Print the result', 'Handle bad input', 'Guard divide by zero'])

  const saved: StoredTask[][] = []
  const tasks = new SessionTasks([], (t) => saved.push([...t]), () => undefined)
  assert.match(tasks.forCoach(), /none yet.*set_task/, 'with no tasks, the coach is reminded to add them')
  tasks.importLegacy([...titles, 'read two NUMBERS'])
  assert.deepEqual(
    tasks.view().map((t) => [t.id, t.title, t.by, t.status]),
    titles.map((title, i) => [`t${i + 1}`, title, 'coach', 'waiting']),
    'once each, by the coach, waiting'
  )
  assert.equal(saved.length, 1, 'saved, so it happens only once')
  assert.match(tasks.forCoach(), /t4 Handle bad input: WAITING for you\. Call set_task with id t4/)
  tasks.coachSet({ id: 't4', title: 'Handle bad input', doneWhen: 'Run it with abc: it asks again', answer: 'Please type a number' })
  assert.equal(tasks.view()[3].status, 'open')
})
