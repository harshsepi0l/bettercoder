import type { FromIde, IdeCommand, IdeDiagnostic } from '../../shared/ide'
import type { EditorSnapshot } from '../ports'

/**
 * Editor messages from the built-in VS Code (over ide-socket.ts) and the snapshot they build: parsed strictly, with
 * the rules for "last edit" and "the same errors since" that the meters and the coach's view use.
 */

/** A longer line is dropped: no editor message needs more (doc text is capped by the extension too). */
export const MAX_LINE = 600_000
const MAX_TEXT = 400_000
const MAX_DIAGNOSTICS = 20

/** Parse one line from the editor. Anything malformed is ignored, never thrown. */
export function parseIdeMessage(line: string): FromIde | null {
  if (line.length > MAX_LINE) return null
  let m: unknown
  try {
    m = JSON.parse(line)
  } catch {
    return null
  }
  if (!m || typeof m !== 'object') return null
  const o = m as Record<string, unknown>
  const str = (v: unknown, max = 4096) => (typeof v === 'string' && v.length <= max ? v : null)
  const int = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 10_000_000 ? v : null)
  switch (o.type) {
    case 'hello': {
      const ide = str(o.ide, 40)
      const folders = Array.isArray(o.folders) ? o.folders.map((f) => str(f)).filter((f): f is string => !!f).slice(0, 20) : []
      return ide ? { type: 'hello', ide, folders } : null
    }
    case 'editor': {
      const line = int(o.line)
      const col = int(o.col)
      const file = o.file === null ? null : str(o.file)
      if (line === null || col === null || file === undefined) return null
      if (o.file !== null && file === null) return null
      return { type: 'editor', file, line, col }
    }
    case 'doc': {
      const file = str(o.file)
      const text = str(o.text, MAX_TEXT)
      return file && text !== null ? { type: 'doc', file, text } : null
    }
    case 'diagnostics': {
      const file = str(o.file)
      if (!file || !Array.isArray(o.items)) return null
      const items: IdeDiagnostic[] = []
      for (const d of o.items.slice(0, MAX_DIAGNOSTICS)) {
        if (!d || typeof d !== 'object') continue
        const x = d as Record<string, unknown>
        const line = int(x.line)
        const col = int(x.col)
        const message = str(x.message, 400)
        if (line === null || col === null || !message) continue
        const code = str(x.code, 40)
        items.push({ line, col, severity: x.severity === 'error' ? 'error' : 'warning', ...(code ? { code } : {}), message })
      }
      return { type: 'diagnostics', file, items }
    }
    case 'step_done': {
      const stepId = str(o.stepId, 200)
      return stepId ? { type: 'step_done', stepId } : null
    }
    case 'step_typed': {
      const stepId = str(o.stepId, 200)
      const n = int(o.n)
      return stepId && n !== null ? { type: 'step_typed', stepId, n: Math.min(n, 100) } : null
    }
    case 'run': {
      const file = str(o.file)
      const cols = int(o.cols)
      const rows = int(o.rows)
      return file && cols !== null && rows !== null ? { type: 'run', file, cols: Math.min(cols || 80, 1000), rows: Math.min(rows || 24, 1000) } : null
    }
    case 'term_input': {
      const id = str(o.id, 64)
      const data = str(o.data, 65_536)
      return id && data !== null ? { type: 'term_input', id, data } : null
    }
    case 'term_resize': {
      const id = str(o.id, 64)
      const cols = int(o.cols)
      const rows = int(o.rows)
      return id && cols && rows ? { type: 'term_resize', id, cols: Math.min(cols, 1000), rows: Math.min(rows, 1000) } : null
    }
    case 'term_stop': {
      const id = str(o.id, 64)
      return id ? { type: 'term_stop', id } : null
    }
    case 'official': {
      const url = str(o.url, 500)
      const term = str(o.term, 100)
      return url && term && /^https:\/\//.test(url) ? { type: 'official', url, term } : null
    }
    default:
      return null
  }
}

/** Is this message a run or terminal command (not part of the editor's snapshot)? */
export function isIdeCommand(m: FromIde): m is IdeCommand {
  return m.type === 'run' || m.type === 'term_input' || m.type === 'term_resize' || m.type === 'term_stop' || m.type === 'official'
}

/** The same errors (by code and message, not line: lines move as they type) count as one unchanged problem. */
export function errorKey(items: readonly IdeDiagnostic[]): string {
  return items
    .filter((d) => d.severity === 'error')
    .map((d) => `${d.code ?? ''}:${d.message}`)
    .sort()
    .join('\n')
}

/** A snapshot before an editor has said anything. */
export function emptySnapshot(ide = 'Editor'): EditorSnapshot {
  return { ide, folders: [], file: null, line: 0, col: 0, text: null, diagnostics: [], lastEditAt: null, errors: null, stepsDone: new Set(), stepTyped: null }
}

/**
 * Apply one editor message to its snapshot. Returns false when the message was ignored (text or problems for a file
 * that is not the open one).
 */
export function applyFromIde(s: EditorSnapshot, m: FromIde, now: number): boolean {
  switch (m.type) {
    case 'hello':
      s.ide = m.ide
      s.folders = m.folders
      return true
    case 'editor':
      if (m.file !== s.file) {
        s.text = null
        s.diagnostics = []
        s.errors = null
      }
      s.file = m.file
      s.line = m.line
      s.col = m.col
      return true
    case 'doc':
      if (m.file !== s.file) return false
      if (s.text !== null && s.text !== m.text) s.lastEditAt = now
      s.text = m.text
      return true
    case 'diagnostics': {
      if (m.file !== s.file) return false
      s.diagnostics = m.items
      const key = errorKey(m.items)
      s.errors = !key ? null : s.errors?.key === key ? s.errors : { key, since: now }
      return true
    }
    case 'step_done':
      s.stepsDone.add(m.stepId)
      return true
    case 'step_typed':
      s.stepTyped = { stepId: m.stepId, n: m.n }
      return true
    default:
      // Run and terminal commands are not about the editor's state.
      return false
  }
}
