'use strict'

/**
 * A notebook as the coach sees it: one header line per cell, its source, and short text outputs. The same view as
 * the app's core/text-view.ts (notebookLines), so line numbers in the coach's tools, its step markers and what this
 * extension reports all agree. Pure (no vscode), so BetterCoder's tests check the two views stay identical.
 *
 * A cell here is { kind: 'code' | 'markdown' | string, source: string, outputs: Output[] }, where an output is
 * nbformat-like: { output_type: 'stream', text } | { output_type: 'error', ename, evalue } | { data: { 'text/plain' } }.
 */

const MAX_OUTPUT_LINES = 8

function outputLines(outputs) {
  const texts = []
  for (const o of outputs || []) {
    if (o.output_type === 'stream') texts.push(o.text || '')
    else if (o.output_type === 'error') texts.push(`${o.ename}: ${o.evalue}`)
    else if (o.data && typeof o.data['text/plain'] !== 'undefined') texts.push(o.data['text/plain'])
  }
  return texts
    .join('\n')
    .replace(/\n$/, '')
    .split('\n')
    .filter((l, k, a) => l || k < a.length - 1)
}

/**
 * @param {Array<{ kind: string, source: string, outputs?: any[] }>} cells
 * @returns {{ lines: string[], starts: number[], lengths: number[] }} the view, and for each cell the view line
 *   (1-based) of its first source line and how many source lines it has
 */
function notebookView(cells) {
  const lines = []
  const starts = []
  const lengths = []
  cells.forEach((cell, i) => {
    const kind = cell.kind === 'code' || cell.kind === 'markdown' ? cell.kind : cell.kind || 'cell'
    lines.push(`# ── Cell ${i + 1} · ${kind} ──`)
    const src = (cell.source || '').replace(/\n$/, '')
    const body = src ? src.split('\n') : ['(empty)']
    starts.push(lines.length + 1)
    lengths.push(src ? body.length : 0)
    lines.push(...body)
    if (kind !== 'code' || !cell.outputs || cell.outputs.length === 0) return
    const out = outputLines(cell.outputs)
    if (out.length === 0) return
    lines.push('# output:')
    lines.push(...out.slice(0, MAX_OUTPUT_LINES).map((l) => `#   ${l}`))
    if (out.length > MAX_OUTPUT_LINES) lines.push(`#   … ${out.length - MAX_OUTPUT_LINES} more output lines`)
  })
  return { lines, starts, lengths }
}

/**
 * The cell and line (both 0-based) a view line (1-based) falls on, or null for a header or output line. The line
 * just after a cell's last source line counts as that cell (a step often goes on a new line at the end of a cell).
 */
function cellAt(view, viewLine) {
  for (let i = 0; i < view.starts.length; i++) {
    const k = viewLine - view.starts[i]
    if (k >= 0 && k <= view.lengths[i]) return { cell: i, line: Math.min(k, Math.max(0, view.lengths[i])) }
  }
  return null
}

module.exports = { notebookView, cellAt }
