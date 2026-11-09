'use strict'

/**
 * Where the faded pseudocode goes, one line at a time. Pure (no vscode), so BetterCoder's tests cover it.
 *
 * Every non-blank line they have written from the marked line down to the cursor counts as one pseudocode line
 * done. On a blank cursor line the next pseudocode line shows. Before they start, the first one shows on the marked
 * line itself, if it is blank.
 *
 * @param {string[]} lines  the document's lines
 * @param {number} anchor   the marked line, 0-based
 * @param {number} cursor   the cursor line, 0-based
 * @param {string[]} ghost  the step's pseudocode lines
 * @returns {{ ghost: { line: number, text: string } | null, done: boolean }}
 */
/**
 * How many pseudocode lines they have typed so far (0..ghostLength): non-blank lines from the marked line to the cursor.
 * @returns {number}
 */
function typedCount(lines, anchor, cursor, ghostLength) {
  if (ghostLength === 0 || anchor < 0 || cursor < anchor) return 0
  let n = 0
  for (let i = anchor; i <= cursor && i < lines.length; i++) if (lines[i].trim() !== '') n++
  return Math.min(n, ghostLength)
}

function ghostAt(lines, anchor, cursor, ghost) {
  const blank = (i) => i < 0 || i >= lines.length || lines[i].trim() === ''
  if (ghost.length === 0 || anchor < 0) return { ghost: null, done: false }
  let before = 0
  for (let i = anchor; i < cursor && i < lines.length; i++) if (!blank(i)) before++
  const upToCursor = before + (cursor >= anchor && !blank(cursor) ? 1 : 0)
  const done = cursor >= anchor && upToCursor >= ghost.length
  // Near the step only: far below it, they are working on something else.
  const near = cursor >= anchor && cursor - anchor <= ghost.length + 4
  if (near && blank(cursor) && before < ghost.length) {
    return { ghost: { line: cursor, text: ghost[before].trim() }, done }
  }
  if (!near && blank(anchor) && cursor !== anchor) {
    return { ghost: { line: anchor, text: ghost[0].trim() }, done }
  }
  return { ghost: null, done }
}

module.exports = { ghostAt, typedCount }
