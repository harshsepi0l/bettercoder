import { basename, posix } from 'node:path'
import type { RunLanguage } from './runners'
import { parseTraceback, projectPathOf } from './traceback'

/**
 * The error a ▶ Run ended with, read from its output without running anything, for every language Run handles:
 * Python tracebacks, Node stacks, .NET build errors and exceptions, Java and Kotlin, and the compilers that print
 * `file:line:col: error: …` (clang, Swift, kotlinc). Pure, so it is tested. The line to underline is always in the
 * learner's own project.
 */

export interface RunError {
  lang: RunLanguage
  /** `NameError`, `ReferenceError`, `CS0103`, `java.lang.ArithmeticException`, `error`, `crash`, … */
  type: string
  message: string
  at: { path: string; line: number } | null
  /** It died from a signal rather than an error message (C, C++, Swift). */
  crash?: 'memory' | 'abort' | 'maths'
}

const clean = (output: string) => output.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r\n?/g, '\n')

/** A file named in the output, as a project path (or null when it isn't the learner's). */
function inProject(file: string, root: string): string | null {
  return projectPathOf(file.replace(/^file:\/\//, ''), root)
}

/** The first `path:line` (in the learner's project) that a pattern finds. */
function firstAt(text: string, pattern: RegExp, root: string): RunError['at'] {
  for (const m of text.matchAll(pattern)) {
    const path = inProject(m[1], root)
    if (path) return { path, line: Number(m[2]) }
  }
  return null
}

/** `file:line:col: error: message` (clang, Swift, old kotlinc) and `e: file:///…:line:col message` (new kotlinc). */
function compilerError(lang: RunLanguage, text: string, root: string): RunError | null {
  for (const m of text.matchAll(/^(?:e: )?(?:file:\/\/)?(\S[^\n]*?\.\w+):(\d+):\d+:? (?:error: )?([^\n]+)$/gm)) {
    if (!/^e: /.test(m[0]) && !/: error: /.test(m[0])) continue
    const path = inProject(m[1], root)
    return { lang, type: 'error', message: m[3].trim(), at: path ? { path, line: Number(m[2]) } : null }
  }
  return null
}

function nodeError(text: string, root: string): RunError | null {
  const lines = text.split('\n')
  let i = lines.length - 1
  let m: RegExpExecArray | null = null
  for (; i >= 0; i--) {
    m = /^(?:Uncaught )?((?:[A-Z]\w*)?Error|[A-Z]\w*Exception)(?: \[[A-Z_]+\])?: (.*)$/.exec(lines[i])
    if (m) break
  }
  if (!m) return null
  // The stack below the error names their file; a syntax error instead names it at the top ("/path/app.js:3").
  const stack = lines.slice(i + 1).join('\n')
  const at =
    firstAt(stack, /^\s+at (?:[^\n(]*\()?((?:file:\/\/)?\/[^\n():]+):(\d+):\d+\)?$/gm, root) ??
    firstAt(lines.slice(0, i).join('\n'), /^((?:file:\/\/)?\/[^\n:]+):(\d+)$/gm, root)
  return { lang: 'node', type: m[1], message: m[2].trim(), at }
}

function dotnetError(text: string, root: string): RunError | null {
  const build = /^(\S[^\n]*?\.cs)\((\d+),\d+\): error (CS\d+): ([^\n]*?)(?: \[[^\n]*\])?$/m.exec(text)
  if (build) {
    const path = inProject(build[1], root)
    return { lang: 'dotnet', type: build[3], message: build[4].trim(), at: path ? { path, line: Number(build[2]) } : null }
  }
  const ex = /Unhandled exception\. ([\w.]+)(?:: ([^\n]*))?/.exec(text)
  if (!ex) return null
  return { lang: 'dotnet', type: ex[1], message: (ex[2] ?? '').trim(), at: firstAt(text.slice(ex.index), / in (\/[^\n]+?):line (\d+)/g, root) }
}

/** Java and Kotlin: compile errors (`Main.java:5: error: …`), then exceptions (`Exception in thread "main" …`). */
function jvmError(lang: RunLanguage, text: string, root: string, runPath: string): RunError | null {
  const compile = /^(\S[^\n]*?\.java):(\d+): error: ([^\n]+)$/m.exec(text)
  if (compile) {
    const path = inProject(compile[1], root)
    return { lang, type: 'error', message: compile[3].trim(), at: path ? { path, line: Number(compile[2]) } : null }
  }
  if (lang === 'kotlin') {
    const k = compilerError(lang, text, root)
    if (k) return k
  }
  const ex = /Exception in thread "[^"]*" ([\w.$]+)(?:: ([^\n]*))?/.exec(text)
  if (!ex) return null
  // Frames name only the file ("Main.java:4"): it is theirs when it is the file they ran.
  let at: RunError['at'] = null
  for (const f of text.slice(ex.index).matchAll(/^\s+at [^\n(]+\(([\w$]+\.(?:java|kt)):(\d+)\)/gm)) {
    if (f[1] === basename(runPath)) {
      at = { path: runPath, line: Number(f[2]) }
      break
    }
  }
  return { lang, type: ex[1], message: (ex[2] ?? '').trim(), at }
}

function swiftError(text: string, root: string): RunError | null {
  const compile = compilerError('swift', text, root)
  if (compile) return compile
  const fatal = /Fatal error: ([^\n]*)/.exec(text)
  if (!fatal) return null
  return { lang: 'swift', type: 'Fatal error', message: fatal[1].trim(), at: firstAt(text, /(\/[^\s:]+\.swift):(\d+)/g, root) }
}

/** A program killed by a signal: the shell reports 128 + its number. */
function crashOf(exitCode: number | null): RunError['crash'] | null {
  if (exitCode === 139 || exitCode === 138) return 'memory' // SIGSEGV, SIGBUS
  if (exitCode === 134) return 'abort' // SIGABRT
  if (exitCode === 136) return 'maths' // SIGFPE (integer division by zero)
  return null
}

/** The error a run ended with, or null when there is none to name (a clean exit, or output it can't read). */
export function parseRunError(lang: RunLanguage, output: string, root: string, exitCode: number | null, runPath: string): RunError | null {
  const text = clean(output)
  switch (lang) {
    case 'python': {
      const py = parseTraceback(output, root)
      return py ? { lang, type: py.type, message: py.message, at: py.at } : null
    }
    case 'node':
      return nodeError(text, root)
    case 'dotnet':
      return dotnetError(text, root)
    case 'java':
    case 'kotlin':
      return jvmError(lang, text, root, posix.normalize(runPath))
    case 'swift':
      return swiftError(text, root) ?? crash(lang, exitCode)
    case 'c':
    case 'cpp':
      return compilerError(lang, text, root) ?? crash(lang, exitCode)
  }
}

function crash(lang: RunLanguage, exitCode: number | null): RunError | null {
  const kind = crashOf(exitCode)
  return kind ? { lang, type: 'crash', message: '', at: null, crash: kind } : null
}
