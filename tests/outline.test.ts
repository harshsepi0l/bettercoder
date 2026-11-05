/** project_outline: the coach's cheap map of where things are, from the same reader as the Map tab. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai'
import type { ProjectInfo } from '../src/shared/ipc'
import { createOutlineTool } from '../src/main/coach/tools/outline'
import { findPython } from '../src/main/engines/visualize/runner'
import { openCoach } from './helpers'
import { realPorts } from '../src/main/ipc/ports'

const FIX = join(import.meta.dirname, 'fixtures')
const hasPython = !!(await findPython())
const proj = (dir: string, files?: string[]): ProjectInfo => ({
  root: join(FIX, dir),
  name: dir,
  stacks: ['Python'],
  manifests: [],
  languages: [{ name: 'Python', files: 3 }],
  fileCount: 3,
  git: null,
  ...(files ? { files } : {})
})

async function outline(p: ProjectInfo): Promise<string> {
  const r = await createOutlineTool(p, realPorts().mapper).execute('t', {} as never)
  return r.content.map((c) => (c.type === 'text' ? c.text : '')).join('')
}

test('outlines classes, methods with line numbers, and marks unfinished ones', { skip: !hasPython }, async () => {
  const text = await outline(proj('todo-app'))
  assert.match(text, /todos\.py\n\s+class TodoList @\d+:/)
  assert.match(text, /complete\(self, number\) \[unfinished\] @\d+/)
  assert.match(text, /remove\(self, number\) @\d+/)
  assert.ok(!/remove\(self, number\) \[unfinished\]/.test(text), 'finished methods are not marked')
  assert.match(text, /app\.py\n\s+functions: show\(todos\) @\d+, main\(\) @\d+/)
})

test('notebooks: functions with cell-view line numbers; unreadable cells are reported, not fatal', { skip: !hasPython }, async () => {
  const text = await outline(proj('notebook', ['forest.ipynb', 'unfinished.ipynb']))
  assert.match(text, /forest\.ipynb \(line numbers refer to the notebook cell view\)\n\s+functions: spread\(grid\) @\d+/)
  assert.match(text, /unfinished\.ipynb: parts could not be read/)
})

test('brace languages: interfaces and abstract classes appear by kind', async () => {
  const text = await outline(proj('java-shapes'))
  assert.match(text, /interface Shape @1:/)
  assert.match(text, /abstract AbstractShape @1:/)
  assert.match(text, /area\(\) \[unfinished\]/)
})

test('the coach can call project_outline and it counts as reading, not a card', { skip: !hasPython }, async () => {
  const { faux, session, events } = await openCoach(proj('todo-app'))
  let seen = ''
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall('project_outline', {})], { stopReason: 'toolUse' }),
    (context) => {
      const r = context.messages.filter((m) => m.role === 'toolResult').at(-1)
      seen = JSON.stringify(r)
      return fauxAssistantMessage('**complete() is unfinished**')
    }
  ])
  await session.send('where should I start?')
  await session.waitForIdle()
  assert.match(seen, /TodoList/)
  assert.ok(events.some((e) => e.type === 'tool' && e.label === 'Outlined'))
})
