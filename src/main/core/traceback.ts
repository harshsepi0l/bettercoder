import { isAbsolute, join, normalize, relative, sep } from 'node:path'

/**
 * Python tracebacks, read without running anything: the error's type and message, the frames, and the line in the
 * learner's own code to underline. Pure (no files, no processes), so it is tested.
 */

export interface PyFrame {
  /** As Python printed it. */
  file: string
  line: number
  fn?: string
}

export interface PyError {
  /** `NameError`, `requests.exceptions.HTTPError`, … */
  type: string
  message: string
  frames: PyFrame[]
  /** The innermost frame in the learner's project (outside any venv or installed package), project-relative. */
  at: { path: string; line: number } | null
}

const FRAME = /^\s*File "(.+)", line (\d+)(?:, in (.+))?\s*$/
const HEADER = /^Traceback \(most recent call last\):\s*$/
/**
 * The final line: an exception class at the start of a line (dotted, its last part capitalised), then optionally
 * ": message". It only counts as a crash when frames come before it.
 */
const ERROR_LINE = /^((?:[A-Za-z_]\w*\.)*[A-Z]\w*)(?::\s?(.*))?$/
const NOT_THEIRS = /(^|[/\\])(\.venv|venv|env|\.tox|site-packages|dist-packages|lib[/\\]python\d)([/\\]|$)/

/** Is this frame's file part of the learner's project (not Python's, not an installed package's)? */
export function projectPathOf(file: string, root: string): string | null {
  if (!root || file.startsWith('<')) return null
  const abs = normalize(isAbsolute(file) ? file : join(root, file))
  const rel = relative(normalize(root), abs)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null
  if (NOT_THEIRS.test(rel)) return null
  return rel.split(sep).join('/')
}

/** The last Python error in a program's output, or null when there is none. */
export function parseTraceback(output: string, root: string): PyError | null {
  // Terminals end lines with \r\n, and may colour them.
  const lines = output.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r\n?/g, '\n').split('\n')
  let err = -1
  let m: RegExpExecArray | null = null
  for (let i = lines.length - 1; i >= 0; i--) {
    const hit = ERROR_LINE.exec(lines[i].trimEnd())
    if (hit) {
      err = i
      m = hit
      break
    }
  }
  if (err < 0 || !m) return null
  // The frames of this error: from its "Traceback" header, or (a syntax error has none) the few lines above it.
  let start = Math.max(0, err - 8)
  for (let i = err - 1; i >= 0; i--) {
    if (HEADER.test(lines[i])) {
      start = i
      break
    }
  }
  const frames: PyFrame[] = []
  for (let i = start; i < err; i++) {
    const f = FRAME.exec(lines[i])
    if (f) frames.push({ file: f[1], line: Number(f[2]), ...(f[3] ? { fn: f[3].trim() } : {}) })
  }
  // A program that merely printed "ValueError: ..." itself, with no frame, is not a crash.
  if (frames.length === 0) return null
  let at: PyError['at'] = null
  for (let i = frames.length - 1; i >= 0; i--) {
    const path = projectPathOf(frames[i].file, root)
    if (path) {
      at = { path, line: frames[i].line }
      break
    }
  }
  return { type: m[1], message: (m[2] ?? '').trim(), frames, at }
}
