import { test } from 'node:test'
import assert from 'node:assert/strict'
import { boardOverlaps } from '../scripts/session-check/overlaps'
import type { Board, BoardStep } from '../src/shared/board'

const step = (s: Partial<BoardStep>): BoardStep => ({ say: 'x', add: [], change: [], remove: [], focus: [], ...s })

test('a note written over a box counts as an overlap', () => {
  const board: Board = {
    steps: [
      step({ add: [{ type: 'box', id: 'total', label: 'total', text: '5', col: 1, row: 1 }] }),
      step({ add: [{ type: 'note', id: 'why', text: 'this note runs right across the box next to it', col: 0, row: 1 }] })
    ]
  }
  assert.deepEqual(boardOverlaps(board), ['total × why'])
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
