import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { boardOverlaps } from '../scripts/session-check/overlaps'
import type { Board, BoardStep } from '../src/shared/board'

const step = (s: Partial<BoardStep>): BoardStep => ({ say: 'x', add: [], change: [], remove: [], focus: [], ...s })

/**
 * Regression (real sessions, 2026-11-13): the coach placed everything on a 10×10 grid itself, and notes ran across
 * boxes. The app now lays every board out (old boards too: their grid positions are ignored), so nothing overlaps.
 */
test('a board the coach placed badly on the old grid is laid out clean', () => {
  const board: Board = {
    steps: [
      step({ add: [{ type: 'box', id: 'total', label: 'total', text: '5', col: 1, row: 1 }] }),
      step({ add: [{ type: 'note', id: 'why', text: 'this note runs right across the box next to it', col: 0, row: 1 }] })
    ]
  }
  assert.deepEqual(boardOverlaps(board), [])
})

test('the real MathCalculator board (7 steps, a diamond, arrows, long values) has no overlaps', () => {
  const board = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', 'boards', 'math-calculator.json'), 'utf8')) as Board
  assert.equal(board.steps.length, 7)
  assert.deepEqual(boardOverlaps(board), [])
})

test('a diamond gets room for its words, so they never wrap into a taller shape', async () => {
  const { layoutBoard } = await import('../src/shared/board')
  const board: Board = { steps: [step({ add: [{ type: 'box', id: 'b', label: 'which op?', text: 'times branch', shape: 'diamond' }, { type: 'box', id: 'v', text: '"23"' }] })] }
  const at = layoutBoard(board)
  assert.equal(at.get('b')?.units, 2)
  assert.equal(at.get('v')?.units, 1)
})

test('a box with its own label, and a row with its indexes, never count', () => {
  const board: Board = {
    steps: [
      step({
        add: [
          { type: 'cells', id: 'nums', label: 'nums', items: ['2', '9', '9'], col: 1, row: 1 },
          { type: 'box', id: 's', label: 's', text: '11', col: 1, row: 3 },
          { type: 'arrow', id: 'a', from: 'nums', to: 's' }
        ]
      })
    ]
  }
  assert.deepEqual(boardOverlaps(board), [])
})
