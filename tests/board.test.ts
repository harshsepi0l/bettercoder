import { test } from 'node:test'
import assert from 'node:assert/strict'
import { boardProblem, boardScene, type Board, type BoardStep } from '../src/shared/board'
import { boardSkeletons } from '../src/renderer/src/features/visualize/board-elements'

const step = (s: Partial<BoardStep> & { say: string }): BoardStep => ({ add: [], change: [], remove: [], focus: [], ...s })

/** A list being searched: a row of cells, an index box with an arrow at a cell, the arrow moving, the row shrinking. */
const search: Board = {
  steps: [
    step({ say: 'Three numbers in a row', add: [{ type: 'cells', id: 'nums', label: 'nums', items: ['4', '7', '9'], col: 0, row: 0 }] }),
    step({ say: 'i starts at 0', add: [{ type: 'box', id: 'i', label: 'i', text: '0', col: 0, row: 2 }, { type: 'arrow', id: 'at', from: 'i', to: 'nums.0' }] }),
    step({ say: 'i moves on', change: [{ id: 'i', text: '1' }], remove: ['at'], add: [{ type: 'arrow', id: 'at2', from: 'i', to: 'nums.1' }] }),
    step({ say: 'The last one goes', change: [{ id: 'nums', items: ['4', '7'] }], focus: ['nums.1'] })
  ]
}

test('board: a valid board passes; each step shows what it added or changed, lit', () => {
  assert.equal(boardProblem(search), null)
  const first = boardScene(search, 0)
  assert.deepEqual(
    first.filter((d) => d.kind === 'rect').map((d) => [d.id, d.kind === 'rect' && d.text, d.fresh]),
    [
      ['nums.0', '4', true],
      ['nums.1', '7', true],
      ['nums.2', '9', true]
    ]
  )
  const third = boardScene(search, 2)
  const i = third.find((d) => d.id === 'i')
  assert.ok(i && i.kind === 'rect' && i.text === '1' && i.lit && !i.fresh, 'a changed value is lit, not new')
  assert.ok(!third.some((d) => d.id === 'at'), 'a removed arrow is gone')
  assert.ok(third.some((d) => d.id === 'at2' && d.kind === 'arrow' && d.to === 'nums.1' && d.fresh))
  const last = boardScene(search, 3)
  assert.ok(!last.some((d) => d.id === 'nums.2'), 'the row shrank')
  assert.ok(last.find((d) => d.id === 'nums.1')?.lit, 'focus lights a cell')
})

test('board: problems come back as plain reasons the coach can fix', () => {
  const bad = (steps: BoardStep[]) => boardProblem({ steps })
  assert.match(bad([]) ?? '', /1 to 12 steps/)
  assert.match(bad([step({ say: 's', add: [{ type: 'arrow', id: 'a', from: 'x', to: 'y' }] })]) ?? '', /not on the board yet/)
  assert.match(bad([step({ say: 's', add: [{ type: 'box', id: 'a', text: '1', col: 0, row: 0 }, { type: 'box', id: 'a', text: '2', col: 1, row: 0 }] })]) ?? '', /already on the board/)
  assert.match(bad([step({ say: 's', add: [{ type: 'box', id: 'a', text: '1', col: 12, row: 0 }] })]) ?? '', /off the board/)
  assert.match(bad([step({ say: 's', change: [{ id: 'nope', text: '1' }] })]) ?? '', /cannot change "nope"/)
  assert.match(bad([step({ say: 's', add: [{ type: 'cells', id: 'r', items: ['1'], col: 0, row: 0 }] }), step({ say: 's', focus: ['r.4'] })]) ?? '', /cannot light up/)
  assert.match(bad([step({ say: 's', add: [{ type: 'box', id: '1x', text: '1', col: 0, row: 0 }] })]) ?? '', /usable id/)
})

test('board: removing a thing takes its arrows with it; an arrow at a whole row points at its first cell', () => {
  const board: Board = {
    steps: [
      step({ say: 's', add: [{ type: 'box', id: 'a', text: 'head', col: 0, row: 0 }, { type: 'cells', id: 'r', items: ['1', '2'], col: 2, row: 0 }, { type: 'arrow', id: 'x', from: 'a', to: 'r' }] }),
      step({ say: 's', remove: ['a'] })
    ]
  }
  assert.equal(boardProblem(board), null)
  assert.ok(boardScene(board, 0).some((d) => d.kind === 'arrow' && d.to === 'r.0'))
  assert.ok(!boardScene(board, 1).some((d) => d.kind === 'arrow'))
})

test('whiteboard look: new things fade in, arrows bind to shapes', () => {
  const drawn = boardScene(search, 1)
  const half = boardSkeletons(drawn, 0.5)
  assert.equal(half.find((e) => e.id === 'i')?.opacity, 50, 'added in this step: fading in')
  assert.equal(half.find((e) => e.id === 'nums.0')?.opacity, 100, 'from an earlier step: fully there')
  const arrow = half.find((e) => e.id === 'at')
  assert.deepEqual([arrow?.start, arrow?.end], [{ id: 'i' }, { id: 'nums.0' }])
})
