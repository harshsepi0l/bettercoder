import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { notebookLines } from '../src/main/core/text-view'
// The extension's own notebook view (CommonJS, no vscode import).
import viewModule from '../ide/vscode/notebook-view.js'

type Cell = { kind: string; source: string; outputs?: unknown[] }
type View = { lines: string[]; starts: number[]; lengths: number[] }
const { notebookView, cellAt } = viewModule as {
  notebookView: (cells: Cell[]) => View
  cellAt: (view: View, viewLine: number) => { cell: number; line: number } | null
}

const join_ = (s: string | string[] | undefined) => (Array.isArray(s) ? s.join('') : (s ?? ''))

/** A .ipynb as the extension sees it (VS Code gives cells and outputs, not the JSON). */
function cellsOf(raw: string): Cell[] {
  const nb = JSON.parse(raw) as { cells: Array<{ cell_type: string; source: string | string[]; outputs?: Array<Record<string, unknown>> }> }
  return nb.cells.map((c) => ({
    kind: c.cell_type,
    source: join_(c.source),
    outputs: (c.outputs ?? []).map((o) =>
      o.output_type === 'stream'
        ? { output_type: 'stream', text: join_(o.text as string[]) }
        : o.output_type === 'error'
          ? { output_type: 'error', ename: o.ename, evalue: o.evalue }
          : { output_type: o.output_type, data: o.data }
    )
  }))
}

const NOTEBOOKS = resolve(import.meta.dirname, 'fixtures', 'notebook')
const MADE = JSON.stringify({
  cells: [
    { cell_type: 'markdown', source: ['# Word counts\n', 'Which words?'] },
    { cell_type: 'code', source: ['import os\n', 'words = "a b a".split()\n', 'len(words)'], outputs: [{ output_type: 'execute_result', data: { 'text/plain': ['3'] } }] },
    { cell_type: 'code', source: [], outputs: [] },
    { cell_type: 'code', source: ['for i in range(12):\n', '    print(i)'], outputs: [{ output_type: 'stream', name: 'stdout', text: Array.from({ length: 12 }, (_, i) => `${i}\n`) }] },
    { cell_type: 'code', source: ['1/0'], outputs: [{ output_type: 'error', ename: 'ZeroDivisionError', evalue: 'division by zero', traceback: [] }] },
    { cell_type: 'raw', source: ['plain text'] }
  ]
})

test('notebook view: the extension sees a notebook exactly as the coach does', () => {
  const cases: Array<[string, string]> = [['made', MADE]]
  for (const f of readdirSync(NOTEBOOKS).filter((n) => n.endsWith('.ipynb'))) cases.push([f, readFileSync(join(NOTEBOOKS, f), 'utf8')])
  for (const [name, raw] of cases) {
    assert.deepEqual(notebookView(cellsOf(raw)).lines, notebookLines(raw), name)
  }
})

test('notebook view: every source line maps to its cell and back', () => {
  const view = notebookView(cellsOf(MADE))
  view.starts.forEach((start, cell) => {
    for (let k = 0; k < Math.max(1, view.lengths[cell]); k++) assert.deepEqual(cellAt(view, start + k), { cell, line: k })
  })
  // The cell headers and output lines are no cell's source.
  assert.equal(cellAt(view, 1), null) // "# ── Cell 1 · markdown ──"
  assert.equal(view.lines[view.starts[1] + 3 - 1], '# output:')
  // The line just after a cell's code counts as that cell (where a new step line goes).
  assert.deepEqual(cellAt(view, view.starts[1] + 3), { cell: 1, line: 3 })
  // An empty cell shows "(empty)" and takes a step on its first line.
  assert.equal(view.lines[view.starts[2] - 1], '(empty)')
  assert.deepEqual(cellAt(view, view.starts[2]), { cell: 2, line: 0 })
})
