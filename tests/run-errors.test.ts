// ▶ Run's errors for every language, read from real output (tests/fixtures/run-output, captured from Node 24, .NET 9,
// Java 11, Swift 6 and clang; Kotlin's two compiler formats written by hand), and the plain-words line for each.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseRunError, type RunError } from '../src/main/core/run-errors'
import { runErrorInWords } from '../src/main/core/error-words'
import { isCodeLine } from '../src/main/core/guard'
import type { RunLanguage } from '../src/main/core/runners'

const ROOT = '/work/proj'
const OUT = resolve(import.meta.dirname, 'fixtures', 'run-output')
const read = (name: string) => readFileSync(join(OUT, name), 'utf8')

const CASES: Array<{ file: string; lang: RunLanguage; path: string; exit: number; type: string; at: RunError['at']; words: string }> = [
  { file: 'node-undef.js.txt', lang: 'node', path: 'undef.js', exit: 1, type: 'ReferenceError', at: { path: 'undef.js', line: 2 }, words: 'Line 2 uses total before it exists.' },
  { file: 'node-undef.ts.txt', lang: 'node', path: 'undef.ts', exit: 1, type: 'ReferenceError', at: { path: 'undef.ts', line: 2 }, words: 'Line 2 uses missing before it exists.' },
  { file: 'node-nullish.js.txt', lang: 'node', path: 'nullish.js', exit: 1, type: 'TypeError', at: { path: 'nullish.js', line: 2 }, words: 'Line 2 uses a value that is empty (null).' },
  { file: 'node-syntax.js.txt', lang: 'node', path: 'syntax.js', exit: 1, type: 'SyntaxError', at: { path: 'syntax.js', line: 3 }, words: 'Line 3 opens a bracket or quote that never closes.' },
  { file: 'dotnet-build.txt', lang: 'dotnet', path: 'Program.cs', exit: 1, type: 'CS1003', at: { path: 'Program.cs', line: 2 }, words: "Line 2 isn't valid C# yet." },
  { file: 'dotnet-runtime.txt', lang: 'dotnet', path: 'Program.cs', exit: 134, type: 'System.NullReferenceException', at: { path: 'Program.cs', line: 2 }, words: 'Line 2 uses a value that is empty (null).' },
  { file: 'java-runtime.txt', lang: 'java', path: 'Main.java', exit: 1, type: 'java.lang.ArithmeticException', at: { path: 'Main.java', line: 3 }, words: 'Line 3 divides by zero.' },
  { file: 'java-compile.txt', lang: 'java', path: 'Bad.java', exit: 1, type: 'error', at: { path: 'Bad.java', line: 3 }, words: 'Line 3 needs a ; at the end.' },
  { file: 'swift-compile.txt', lang: 'swift', path: 'undef.swift', exit: 1, type: 'error', at: { path: 'undef.swift', line: 2 }, words: 'Line 2 uses total before it exists.' },
  { file: 'swift-fatal.txt', lang: 'swift', path: 'index.swift', exit: 132, type: 'Fatal error', at: null, words: 'The program asks for a position past the end of the list.' },
  { file: 'c-compile.txt', lang: 'c', path: 'undef.c', exit: 1, type: 'error', at: { path: 'undef.c', line: 3 }, words: 'Line 3 uses total before it exists.' },
  { file: 'c-segv.txt', lang: 'c', path: 'segv.c', exit: 139, type: 'crash', at: null, words: 'The program crashed: it used memory it doesn’t own (often a list position or pointer past the end).' }
]

test('run errors: each language’s real output gives its error, the line in their code, and plain words', () => {
  for (const c of CASES) {
    const e = parseRunError(c.lang, read(c.file), ROOT, c.exit, c.path)
    assert.ok(e, c.file)
    assert.equal(e.type, c.type, c.file)
    assert.deepEqual(e.at, c.at, c.file)
    assert.equal(runErrorInWords(e), c.words, c.file)
  }
})

test('run errors: Kotlin, old and new compiler formats, and a JVM exception in their file', () => {
  const k1 = parseRunError('kotlin', 'Main.kt:3:13: error: unresolved reference: total\n    println(total)\n', ROOT, 1, 'Main.kt')
  assert.deepEqual(k1 && [k1.at, runErrorInWords(k1)], [{ path: 'Main.kt', line: 3 }, 'Line 3 uses total before it exists.'])
  const k2 = parseRunError('kotlin', "e: file:///work/proj/src/Main.kt:4:5 Unresolved reference 'count'.\n", ROOT, 1, 'src/Main.kt')
  assert.deepEqual(k2 && [k2.at, runErrorInWords(k2)], [{ path: 'src/Main.kt', line: 4 }, 'Line 4 uses count before it exists.'])
  const ex = parseRunError('kotlin', 'Exception in thread "main" java.lang.IndexOutOfBoundsException: Index 5 out of bounds for length 2\n\tat java.base/jdk.internal.util.Preconditions.outOfBounds(Preconditions.java:100)\n\tat MainKt.main(Main.kt:6)\n', ROOT, 1, 'Main.kt')
  assert.deepEqual(ex && [ex.at, runErrorInWords(ex)], [{ path: 'Main.kt', line: 6 }, 'Line 6 asks for a position past the end of the list.'])
})

test('run errors: a clean run, a warning, or a frame outside their project names nothing of theirs', () => {
  assert.equal(parseRunError('c', 'main.c:3:5: warning: unused variable x\nhello\n', ROOT, 0, 'main.c'), null)
  assert.equal(parseRunError('node', 'hello\n', ROOT, 0, 'app.js'), null)
  const lib = parseRunError('node', 'TypeError: boom\n    at f (/elsewhere/lib.js:9:1)\n', ROOT, 1, 'app.js')
  assert.equal(lib?.at, null)
  // Python keeps its own reader and words.
  const py = parseRunError('python', 'Traceback (most recent call last):\n  File "/work/proj/main.py", line 3, in <module>\n    print(total)\nNameError: name \'total\' is not defined\n', ROOT, 1, 'main.py')
  assert.deepEqual(py && [py.at, runErrorInWords(py)], [{ path: 'main.py', line: 3 }, 'Line 3 uses total before it exists.'])
})

/** Every template, through the no-code guard: the plain-words line must never read as code. */
test('run errors: no plain-words line ever reads as code', () => {
  const samples: Array<[RunLanguage, string, string, RunError['crash']?]> = [
    ['node', 'ReferenceError', 'x is not defined'],
    ['node', 'TypeError', 'f is not a function'],
    ['node', 'Error', "Cannot find module 'left-pad'"],
    ['node', 'RangeError', 'Maximum call stack size exceeded'],
    ['dotnet', 'CS0103', "The name 'x' does not exist in the current context"],
    ['dotnet', 'CS0029', "Cannot implicitly convert type 'string' to 'int'"],
    ['dotnet', 'System.FormatException', 'The input string was not in a correct format.'],
    ['dotnet', 'System.IndexOutOfRangeException', 'Index was outside the bounds of the array.'],
    ['java', 'error', 'cannot find symbol'],
    ['java', 'error', 'incompatible types: String cannot be converted to int'],
    ['java', 'java.lang.NullPointerException', ''],
    ['java', 'java.io.FileNotFoundException', 'data.txt (No such file or directory)'],
    ['swift', 'error', "cannot convert value of type 'String' to specified type 'Int'"],
    ['cpp', 'error', "expected ';' after expression"],
    ['cpp', 'error', "expected '}'"],
    ['c', 'crash', '', 'maths'],
    ['c', 'crash', '', 'abort'],
    ['kotlin', 'Weird$Thing', '']
  ]
  for (const [lang, type, message, crash] of samples) {
    for (const at of [null, { path: 'x', line: 4 }]) {
      const line = runErrorInWords({ lang, type, message, at, ...(crash ? { crash } : {}) })
      assert.ok(line.length > 10 && !isCodeLine(line), `${lang} ${type}: "${line}" reads as code`)
    }
  }
})
