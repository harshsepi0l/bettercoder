/**
 * Regression tests for a real session that went wrong: on a Jupyter notebook the
 * coach read raw JSON, its "a|b" searches matched nothing, and the read budget
 * blocked its question card. Uses tests/fixtures (read-only).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai'
import type { ProjectInfo } from '../src/shared/ipc'
import { createTools } from '../src/main/coach/tools/read'
import { createVisualTools } from '../src/main/coach/tools/cards'
import { notebookLines, searchTerms } from '../src/main/core/text-view'
import { openCoach } from './helpers'
import { realPorts } from '../src/main/ipc/ports'

const NB_DIR = join(import.meta.dirname, 'fixtures', 'notebook')
const TODO_DIR = join(import.meta.dirname, 'fixtures', 'todo-app')

async function run(tools: ReturnType<typeof createTools>, name: string, args: unknown): Promise<string> {
  const tool = tools.find((t) => t.name === name)!
  const r = await tool.execute('t', args as never)
  return r.content.map((c) => (c.type === 'text' ? c.text : '')).join('')
}

test('a notebook is read as cells, not JSON: sources, short outputs, errors; no images or metadata', async () => {
  const lines = notebookLines(await readFile(join(NB_DIR, 'day17.ipynb'), 'utf8'))!
  const text = lines.join('\n')
  assert.match(text, /# ── Cell 3 · markdown ──\n### Question 1/)
  assert.match(text, /# ── Cell 4 · code ──\nimport numpy as np/)
  assert.match(text, /# output:\n#   \(3, 3\)/)
  assert.match(text, /IndexError: index 3 is out of bounds/)
  assert.ok(!text.includes('iVBORw0KGgo'), 'embedded images are dropped')
  assert.ok(!text.includes('"cell_type"'), 'no raw JSON')
  assert.ok(lines.length < 40, 'compact')
})

test('read_file on a notebook shows cells with line numbers', async () => {
  const tools = createTools(realPorts().files, NB_DIR)
  const out = await run(tools, 'read_file', { path: 'day17.ipynb' })
  assert.match(out, /Cell 6 · code/)
  assert.match(out, /middle = grid\[1, 1\]/)
  assert.ok(!out.includes('"source"'))
})

test('search: "a|b|c" matches any term, and finds notebook cell content', async () => {
  assert.deepEqual(searchTerms('Question|np\\.zeros|x'), ['question', 'np.zeros'])
  const tools = createTools(realPorts().files, NB_DIR)
  const out = await run(tools, 'search', { query: 'Question|grid[1' })
  assert.match(out, /day17\.ipynb:\d+: ### Question 1/)
  assert.match(out, /day17\.ipynb:\d+: ### Question 2/)
  assert.match(out, /middle = grid\[1, 1\]/)
})

test('point_to_code on a notebook quotes the cell lines the coach sees', async () => {
  const project: ProjectInfo = { root: NB_DIR, name: 'nb', stacks: ['Python'], manifests: [], languages: [], fileCount: 1, git: null }
  const visual = createVisualTools(realPorts(), project.root, undefined)
  const lines = notebookLines(await readFile(join(NB_DIR, 'day17.ipynb'), 'utf8'))!
  const at = lines.indexOf('middle = grid[1, 1]') + 1
  const r = await visual.find((t) => t.name === 'point_to_code')!.execute('t', { path: 'day17.ipynb', start_line: at - 1, end_line: at + 1, focus_line: at, note: 'Which row is this?' } as never)
  const card = r.details as { lines: string[]; focusLine: number }
  assert.equal(card.lines[card.focusLine - (at - 1)], 'middle = grid[1, 1]')
})

test('the read budget never blocks a question card', async () => {
  const project: ProjectInfo = { root: TODO_DIR, name: 'todo', stacks: ['Python'], manifests: [], languages: [{ name: 'Python', files: 3 }], fileCount: 3, git: null }
  const { faux, session, events } = await openCoach(project)
  faux.setResponses([
    fauxAssistantMessage(Array.from({ length: 9 }, () => fauxToolCall('list_files', {})), { stopReason: 'toolUse' }),
    fauxAssistantMessage([fauxToolCall('ask_question', { question: 'Which part?', options: ['remove()', 'complete()'] })], { stopReason: 'toolUse' })
  ])
  await session.send("I'm stuck")
  await session.waitForIdle()
  assert.ok(events.some((e) => e.type === 'card' && e.card.kind === 'question'), 'the question card is shown')
})

test('fixtures are never changed by the coach', async () => {
  const before = await readFile(join(TODO_DIR, 'todos.py'), 'utf8')
  assert.match(before, /del self\.items\[number\]/, 'the planted bug is still there')
})
