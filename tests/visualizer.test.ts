import { test } from 'node:test'
import assert from 'node:assert/strict'
import { access, mkdtemp, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findPython, runTrace } from '../src/main/engines/visualize/runner'
import { ScenarioError, describeScenario, validateScenario } from '../src/main/engines/visualize/scenario'

const TODOS = `class TodoList:
    def __init__(self):
        self.items = []

    def add(self, title):
        self.items.append({"title": title, "done": False})

    def remove(self, number):
        del self.items[number]
`

async function project(extra: Record<string, string> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'bc-viz-'))
  await writeFile(join(root, 'todos.py'), TODOS)
  for (const [name, body] of Object.entries(extra)) await writeFile(join(root, name), body)
  return root
}

const hasPython = await findPython()

test('scenarios are data: only names from the file, plain values, no private names', () => {
  const ok = validateScenario(
    [
      { call: 'TodoList', args: [], assign: 'todos' },
      { call: 'todos.add', args: ['buy milk'] }
    ],
    TODOS
  )
  assert.equal(ok.length, 2)
  assert.deepEqual(describeScenario(ok), ['Create a TodoList, and call it todos', 'Call todos.add with "buy milk"'])
  for (const bad of [
    [{ call: 'os.system', args: ['rm -rf /'] }],
    [{ call: 'TodoList.__init__', args: [] }],
    [{ call: '__import__', args: ['os'] }],
    [{ call: 'todos.add', args: [] }], // todos was never created
    [{ call: 'TodoList', args: [{ toString: () => 'x' }] as unknown[] }]
  ]) {
    assert.throws(() => validateScenario(bad as never, TODOS), ScenarioError, JSON.stringify(bad))
  }
})

test('a real run records lines and variables, and shows the off-by-one bug', { skip: !hasPython }, async () => {
  const root = await project()
  const trace = await runTrace({
    root,
    file: 'todos.py',
    scenario: [
      { call: 'TodoList', args: [], assign: 'todos' },
      { call: 'todos.add', args: ['buy milk'] },
      { call: 'todos.add', args: ['walk dog'] },
      { call: 'todos.remove', args: [1] }
    ]
  })
  const inRemove = trace.steps.find((s) => s.func === 'remove' && s.event === 'line')
  assert.ok(inRemove, 'should step into remove()')
  const locals = Object.fromEntries(inRemove.frames.at(-1)!.locals)
  assert.deepEqual(locals.number, { t: 'num', v: 1 })
  const last = trace.steps.at(-1)!
  const todos = last.frames[0].locals.find(([k]) => k === 'todos')?.[1]
  assert.ok(todos && todos.t === 'obj')
  const items = todos.fields.find(([k]) => k === 'items')?.[1]
  assert.ok(items && items.t === 'list')
  assert.equal(items.items.length, 1)
  assert.match(JSON.stringify(items), /buy milk/, '"walk dog" was removed: the bug, made visible')
  // The real project folder is untouched: no __pycache__ or anything else added.
  assert.deepEqual((await readdir(root)).sort(), ['todos.py'])
})

test('sandbox: the code cannot write outside its temporary copy', { skip: !hasPython || process.platform !== 'darwin' }, async () => {
  const target = join(await mkdtemp(join(tmpdir(), 'bc-target-')), 'escaped.txt')
  const root = await project({
    'sneaky.py': `def escape():\n    with open(${JSON.stringify(target)}, "w") as f:\n        f.write("pwned")\n`
  })
  const trace = await runTrace({ root, file: 'sneaky.py', scenario: [{ call: 'escape', args: [] }] })
  assert.match(trace.stopped ?? JSON.stringify(trace.steps.at(-1)), /PermissionError|Operation not permitted/)
  await assert.rejects(access(target), 'the file must not exist')
})

test('a loop that never ends is stopped', { skip: !hasPython }, async () => {
  const root = await project({ 'loop.py': 'def spin():\n    n = 0\n    while True:\n        n += 1\n' })
  const trace = await runTrace({ root, file: 'loop.py', scenario: [{ call: 'spin', args: [] }] })
  assert.match(trace.stopped ?? '', /Stopped after/)
})
