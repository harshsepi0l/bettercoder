
/**
 * The no-code guard. Every piece of assistant text passes through here before
 * the user sees it. Anything that looks like code the model wrote is removed:
 *
 *  - fenced blocks (``` or ~~~), whole block replaced by one notice
 *  - inline `code` that is more than a name, path or short command
 *  - bare lines that look like code (keywords at line start, statements
 *    ending in ; or {, assignments, symbol-heavy lines)
 *
 * It works on a stream: `push(delta)` returns the text that is safe to show
 * now, holding back only what it cannot judge yet. Pure, no Electron imports,
 * so it is unit-tested directly.
 */

export const BLOCK_NOTICE = '[code removed: BetterCoder never writes code for you]'
export const INLINE_NOTICE = '[code removed]'

/** How many characters of a line we wait for before deciding it is prose. */
const DECIDE_AFTER = 24

const FENCE = /^\s{0,3}(```|~~~)/
const LIST_MARKER = /^\s*(?:[-*+]|\d+[.)])\s+/

/** Lowercase keywords that start a line of code in common languages. Case-sensitive on purpose: prose starts with capitals. */
const CODE_START =
  /^(?:def|class|import|from\s+\S+\s+import|public|private|protected|internal|static|const|let|var|function|return|using|namespace|package|func|fn|impl|struct|enum|interface|async\s+\w|await|try\s*[:{]|catch\s*\(|except\b|elif\b|else\s*[:{]|if\s*\(|for\s*\(|while\s*\(|switch\s*\(|foreach\s*\(|print\(|console\.|System\.|std::|#include|#define|@\w+\(|SELECT\s|INSERT\s|UPDATE\s+\w+\s+SET|CREATE\s+TABLE|<\/?[a-z][\w-]*[\s>])/

const INDENTED = /^(?: {4}|\t)/

/** Inline code that only names something is fine: an identifier, a file path, a short command. */
const SAFE_INLINE = /^[A-Za-z0-9_.\/\\:@#+\- ]{1,60}$/

function stripListMarker(line: string): string {
  return line.replace(LIST_MARKER, '')
}

/** True when the start of a line suggests code, so we must see the whole line first. */
export function looksLikeCodeStart(prefix: string): boolean {
  if (FENCE.test(prefix)) return true
  if (INDENTED.test(prefix)) return true
  const t = stripListMarker(prefix).trimStart()
  if (CODE_START.test(t)) return true
  if (/^[{}()[\];]/.test(t)) return true
  if (/^[\w.[\]]+\s*(?:=|\+=|-=|:=|=>)/.test(t)) return true
  return false
}

/** Judge a complete line. */
export function isCodeLine(line: string): boolean {
  const t = stripListMarker(line).trim()
  if (t.length === 0) return false
  if (CODE_START.test(t)) return true
  if (/^[{}()[\];]+;?$/.test(t)) return true
  if (/[;{]\s*$/.test(t) && /[(=]/.test(t)) return true
  if (/\)\s*:\s*$/.test(t) && /\(/.test(t)) return true // def foo(x):
  if (/^[\w.[\]]+\s*(?:=|\+=|-=|:=)\s*\S/.test(t) && !/\s\w+\s\w+\s\w+/.test(t.split('=')[0] ?? '')) return true
  if (/^[\w.]+\(\)$/.test(t)) return false // a bare name like remove() or todos.add()
  if (/^[\w.]+\([^)]+\)\s*;?$/.test(t)) return true // doThing(a, b)
  // Bare names like spread() in a sentence are names, not code: leave their () out of the count.
  const counted = t.replace(/\b[\w.]+\(\)/g, (m) => m.slice(0, -2))
  const symbols = (counted.match(/[;{}()[\]=<>]/g) ?? []).length
  if (counted.length > 8 && symbols / counted.length > 0.15) return true
  return false
}

/** Replace inline code spans that contain more than a name, path or short command. */
export function scrubInline(line: string): { text: string; removed: number } {
  let removed = 0
  const text = line.replace(/`([^`\n]+)`/g, (whole, inner: string) => {
    const words = inner.trim().split(/\s+/).length
    if (SAFE_INLINE.test(inner) && words <= 5) return whole
    removed++
    return INLINE_NOTICE
  })
  return { text, removed }
}

export class StreamGuard {
  private line = ''
  /** Characters of the current line already shown to the user. */
  private shown = 0
  /** null = undecided, 'prose' = streaming, 'hold' = waiting for the line to end */
  private mode: null | 'prose' | 'hold' = null
  private inFence = false
  removed = 0

  /** Feed a chunk of model text; returns the text that is safe to show now. */
  push(delta: string): string {
    let out = ''
    for (const ch of delta) {
      if (ch === '\n') {
        out += this.finishLine() + '\n'
        continue
      }
      this.line += ch
      out += this.progress()
    }
    return out
  }

  /** Flush at the end of the message. */
  end(): string {
    const out = this.line.length > 0 ? this.finishLine() : ''
    if (this.inFence) {
      // Unclosed fence: its contents were already withheld.
      this.inFence = false
    }
    return out
  }

  /** The fully guarded version of a complete text, for transcripts and tests. */
  static clean(text: string): { text: string; removed: number } {
    const g = new StreamGuard()
    const out = g.push(text) + g.end()
    return { text: out, removed: g.removed }
  }

  private progress(): string {
    if (this.inFence) return ''
    if (this.mode === null) {
      if (looksLikeCodeStart(this.line)) this.mode = 'hold'
      else if (this.line.length >= DECIDE_AFTER) {
        // Judge by the first word: `builder.Services.AddScoped<...` is code, `Have a look` is prose.
        const t = stripListMarker(this.line).trimStart()
        const firstSpace = t.search(/\s/)
        if (firstSpace === -1) return '' // one long token so far: keep waiting
        const first = t.slice(0, firstSpace)
        this.mode = /[(<[=;{]|\.\w+\./.test(first) ? 'hold' : 'prose'
      } else return ''
    }
    if (this.mode === 'hold') return ''
    // Prose: stream up to an unclosed backtick, so inline code is judged whole.
    const ticks = (this.line.match(/`/g) ?? []).length
    const safeEnd = ticks % 2 === 1 ? this.line.lastIndexOf('`') : this.line.length
    if (safeEnd <= this.shown) return ''
    // Scrub closed inline spans in the newly visible part.
    const visible = this.line.slice(0, safeEnd)
    const { text } = scrubInline(visible)
    const prior = scrubInline(this.line.slice(0, this.shown)).text
    this.shown = safeEnd
    return text.slice(prior.length)
  }

  private finishLine(): string {
    const line = this.line
    const shown = this.shown
    const mode = this.mode
    this.line = ''
    this.shown = 0
    this.mode = null

    if (FENCE.test(line)) {
      if (this.inFence) {
        this.inFence = false
        return ''
      }
      this.inFence = true
      this.removed++
      return BLOCK_NOTICE
    }
    if (this.inFence) return ''

    if (mode === 'prose') {
      // Already streaming; emit the rest with inline spans scrubbed.
      const { text, removed } = scrubInline(line)
      this.removed += removed
      const prior = scrubInline(line.slice(0, shown)).text
      return text.slice(prior.length)
    }
    if (isCodeLine(line)) {
      this.removed++
      return BLOCK_NOTICE
    }
    const { text, removed } = scrubInline(line)
    this.removed += removed
    return text
  }
}

/** Collapse runs of identical notices (several code lines in a row) into one. */
export function collapseNotices(text: string): string {
  const notice = BLOCK_NOTICE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return text.replace(new RegExp(`(${notice})(\\n+${notice})+`, 'g'), '$1')
}

/**
 * Pseudocode is allowed in its card, real syntax is not. Null when the line is fine, otherwise why not.
 * Allowed: words, ← for setting, = < > ≤ ≥ + - * / for comparing and maths, quotes, colons.
 */
export function pseudocodeProblem(line: string): string | null {
  const t = line.trim()
  if (!t) return null
  if (/`/.test(t)) return 'no backticks'
  if (/[;{}]/.test(t)) return 'no ; { or }'
  if (/\w\s*\(/.test(t) && /\w\(/.test(t)) return 'no calls with brackets: say "read a number", not read()'
  if (/\w\[/.test(t)) return 'no indexing with [ ]: say "the first item"'
  if (/==|!=|&&|\|\||=>|::|\+\+|--|\+=|-=/.test(t)) return 'no ==, !=, &&, ||, =>, ++ or +=: use words or a single ='
  if (/^[\w.]+\s*=(?!=)/.test(t)) return 'set values with ←, not ='
  if (/^(?:int|double|float|decimal|string|str|bool|boolean|char|long|var|let|const|auto|void)\s+\w/.test(t)) return 'no type declarations'
  if (CODE_START.test(t) && !/^(?:return|await)\b/.test(t)) return 'that is real syntax'
  if (/\b\w+\.\w+\s*\(/.test(t) || /\b[A-Z]\w*\.[A-Z]\w*/.test(t)) return 'no library calls like Console.ReadLine: describe what it does'
  return null
}

/**
 * A printed or stored value, not code: a number, text, or a list / dict / set / tuple of them, as Python or JSON
 * prints it ("[1, 2, 3]", "{'a': 1}", "(3, 'x')", "True"). Used for values on the whiteboard (regression: a printed
 * "[1, 2, 3]" was refused as code).
 */
export function isDataLiteral(line: string): boolean {
  const t = line.trim()
  if (!t) return false
  // Quoted text becomes a placeholder; what is left may only be numbers, words for constants, and brackets.
  const rest = t.replace(/b?'(?:[^'\\]|\\.)*'|b?"(?:[^"\\]|\\.)*"/g, 'S').replace(/\b(True|False|None|true|false|null)\b/g, 'S')
  return /^[\s\d.eE+\-S[\]{}(),:]+$/.test(rest) && !/\d\s+\d/.test(rest.replace(/\s*[,:]\s*/g, ','))
}
