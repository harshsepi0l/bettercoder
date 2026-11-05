import { extname } from 'node:path'

/**
 * How the coach sees a file's text. Most files are shown as they are; Jupyter
 * notebooks (.ipynb) are JSON on disk, so they are shown as their cells instead:
 * a header per cell, its source, and short text outputs (images and HTML dropped).
 * Line numbers in read_file, search and point_to_code all refer to this view.
 */

const MAX_OUTPUT_LINES = 8

type NbCell = {
  cell_type?: string
  source?: string | string[]
  outputs?: Array<{ output_type?: string; text?: string | string[]; ename?: string; evalue?: string; data?: Record<string, unknown> }>
}

const join = (s: string | string[] | undefined) => (Array.isArray(s) ? s.join('') : (s ?? ''))

export function notebookLines(raw: string): string[] | null {
  let nb: { cells?: NbCell[] }
  try {
    nb = JSON.parse(raw)
  } catch {
    return null
  }
  if (!Array.isArray(nb.cells)) return null
  const out: string[] = []
  nb.cells.forEach((cell, i) => {
    const kind = cell.cell_type === 'code' ? 'code' : cell.cell_type === 'markdown' ? 'markdown' : (cell.cell_type ?? 'cell')
    out.push(`# ── Cell ${i + 1} · ${kind} ──`)
    const src = join(cell.source).replace(/\n$/, '')
    out.push(...(src ? src.split('\n') : ['(empty)']))
    if (kind !== 'code' || !cell.outputs?.length) return
    const texts: string[] = []
    for (const o of cell.outputs) {
      if (o.output_type === 'stream') texts.push(join(o.text))
      else if (o.output_type === 'error') texts.push(`${o.ename}: ${o.evalue}`)
      else if (o.data && typeof o.data['text/plain'] !== 'undefined') texts.push(join(o.data['text/plain'] as string | string[]))
    }
    const lines = texts.join('\n').replace(/\n$/, '').split('\n').filter((l, k, a) => l || k < a.length - 1)
    if (lines.length === 0) return
    out.push('# output:')
    out.push(...lines.slice(0, MAX_OUTPUT_LINES).map((l) => `#   ${l}`))
    if (lines.length > MAX_OUTPUT_LINES) out.push(`#   … ${lines.length - MAX_OUTPUT_LINES} more output lines`)
  })
  return out
}

/** The lines the coach works with for this file. */
export function viewLines(path: string, raw: string): string[] {
  if (extname(path).toLowerCase() === '.ipynb') {
    const nb = notebookLines(raw)
    if (nb) return nb
  }
  return raw.split('\n')
}

/** Search terms: "a|b|c" means any of them (models write that out of habit). Case-insensitive. */
export function searchTerms(query: string): string[] {
  return query
    .split('|')
    .map((t) => t.replace(/\\(.)/g, '$1').trim().toLowerCase())
    .filter((t) => t.length >= 2)
}

/**
 * A notebook's code cells as one Python module, for running it. `viewLineOf[i]` is
 * the line (1-based, in notebookLines' view) that module line i+1 came from, so a
 * recorded run can be shown on the cells the learner sees. IPython magics and shell
 * lines (%, !) become `pass`, keeping line numbers aligned.
 */
export function notebookToPython(
  raw: string
): { code: string; viewLineOf: number[]; cells: Array<{ start: number; end: number }> } | null {
  let nb: { cells?: NbCell[] }
  try {
    nb = JSON.parse(raw)
  } catch {
    return null
  }
  if (!Array.isArray(nb.cells)) return null
  const code: string[] = []
  const viewLineOf: number[] = []
  /** Each code cell's line range in the module (1-based, inclusive), so cells can run one by one. */
  const cells: Array<{ start: number; end: number }> = []
  let view = 0 // lines emitted so far, mirroring notebookLines
  for (const cell of nb.cells) {
    const kind = cell.cell_type === 'code' ? 'code' : cell.cell_type === 'markdown' ? 'markdown' : 'cell'
    view++ // the "# ── Cell N" header
    const src = join(cell.source).replace(/\n$/, '')
    const lines = src ? src.split('\n') : ['(empty)']
    if (kind === 'code' && src) cells.push({ start: code.length + 1, end: code.length + lines.length })
    lines.forEach((line, k) => {
      if (kind === 'code' && src) {
        const magic = /^\s*[%!]/.test(line)
        code.push(magic ? `${line.match(/^\s*/)?.[0] ?? ''}pass` : line)
        viewLineOf.push(view + k + 1)
      }
    })
    view += lines.length
    // Outputs are shown after code cells in the view; count them the same way notebookLines does.
    if (kind === 'code' && cell.outputs?.length) {
      const texts: string[] = []
      for (const o of cell.outputs) {
        if (o.output_type === 'stream') texts.push(join(o.text))
        else if (o.output_type === 'error') texts.push(`${o.ename}: ${o.evalue}`)
        else if (o.data && typeof o.data['text/plain'] !== 'undefined') texts.push(join(o.data['text/plain'] as string | string[]))
      }
      const out = texts.join('\n').replace(/\n$/, '').split('\n').filter((l, k, a) => l || k < a.length - 1)
      if (out.length > 0) view += 1 + Math.min(out.length, MAX_OUTPUT_LINES) + (out.length > MAX_OUTPUT_LINES ? 1 : 0)
    }
  }
  return { code: code.join('\n') + '\n', viewLineOf, cells }
}
