import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseTraceback } from '../src/main/core/traceback'
import { errorInWords } from '../src/main/core/error-words'
import { isCodeLine } from '../src/main/core/guard'

const ROOT = '/Users/me/code/calc'

test('a NameError in main.py points at their line, with the type and message', () => {
  const out = [
    'First number: 7',
    'Second number: 5',
    'Traceback (most recent call last):',
    `  File "${ROOT}/main.py", line 10, in <module>`,
    '    print(op(a, b))',
    '                ^',
    "NameError: name 'b' is not defined"
  ].join('\r\n')
  const e = parseTraceback(out, ROOT)!
  assert.equal(e.type, 'NameError')
  assert.equal(e.message, "name 'b' is not defined")
  assert.deepEqual(e.at, { path: 'main.py', line: 10 })
  assert.equal(errorInWords(e), 'Line 10 uses b before it exists.')
})

test('frames inside a venv or an installed package are never theirs; the innermost project frame is', () => {
  const out = [
    'Traceback (most recent call last):',
    `  File "${ROOT}/app.py", line 4, in <module>`,
    '    main()',
    `  File "${ROOT}/app.py", line 2, in main`,
    '    requests.get("x")',
    `  File "${ROOT}/.venv/lib/python3.12/site-packages/requests/api.py", line 73, in get`,
    '    return request("get", url, params=params, **kwargs)',
    'requests.exceptions.MissingSchema: Invalid URL'
  ].join('\n')
  const e = parseTraceback(out, ROOT)!
  assert.equal(e.type, 'requests.exceptions.MissingSchema')
  assert.equal(e.frames.length, 3)
  assert.deepEqual(e.at, { path: 'app.py', line: 2 })
  assert.equal(errorInWords(e), 'Line 2 raised MissingSchema.')
})

test('a syntax error has no Traceback header; relative paths resolve against the project', () => {
  const out = ['  File "main.py", line 7', '    second = input("Second number: "', '                  ^', "SyntaxError: '(' was never closed"].join('\n')
  const e = parseTraceback(out, ROOT)!
  assert.deepEqual(e.at, { path: 'main.py', line: 7 })
  assert.equal(errorInWords(e), 'Line 7 opens a bracket that never closes.')
})

test('output with no crash, or a printed error-looking line with no frames, is not an error', () => {
  assert.equal(parseTraceback('Saved 1 todo.\n', ROOT), null)
  assert.equal(parseTraceback('ValueError: this is just a message I printed\n', ROOT), null)
  assert.equal(parseTraceback('', ROOT), null)
})

test('frames outside the project (stdlib, <frozen>) leave nothing to underline, but the error is still read', () => {
  const out = ['Traceback (most recent call last):', '  File "<frozen runpy>", line 198, in _run_module_as_main', '  File "/usr/lib/python3.12/json/__init__.py", line 2, in x', 'KeyError: \'title\''].join('\n')
  const e = parseTraceback(out, ROOT)!
  assert.equal(e.at, null)
  assert.equal(errorInWords(e), "The program looks up title, which isn't in the dictionary.")
})

/** Every template, through the no-code guard: the plain-words line must never read as code. */
test('every plain-words line is words, never code', () => {
  const at = { path: 'main.py', line: 3 }
  const cases: Array<[string, string]> = [
    ['NameError', "name 'b' is not defined"],
    ['NameError', 'something odd'],
    ['UnboundLocalError', "cannot access local variable 'total' where it is not associated with a value"],
    ['TypeError', "unsupported operand type(s) for +: 'int' and 'str'"],
    ['TypeError', 'can only concatenate str (not "int") to str'],
    ['TypeError', "'<' not supported between instances of 'list' and 'dict'"],
    ['TypeError', 'add() takes 2 positional arguments but 3 were given'],
    ['TypeError', "'int' object is not callable"],
    ['TypeError', "'int' object is not subscriptable"],
    ['TypeError', 'weird'],
    ['ValueError', "invalid literal for int() with base 10: 'abc'"],
    ['ValueError', 'math domain error'],
    ['IndexError', 'list index out of range'],
    ['KeyError', "'title'"],
    ['KeyError', '0'],
    ['ZeroDivisionError', 'division by zero'],
    ['AttributeError', "'list' object has no attribute 'push'"],
    ['AttributeError', "'NoneType' object has no attribute 'strip'"],
    ['ModuleNotFoundError', "No module named 'requests.adapters'"],
    ['ImportError', "cannot import name 'x' from 'y'"],
    ['FileNotFoundError', "[Errno 2] No such file or directory: 'todos.json'"],
    ['FileNotFoundError', "[Errno 2] No such file or directory: 'a(b);c'"],
    ['IndentationError', 'expected an indented block'],
    ['TabError', 'inconsistent use of tabs'],
    ['SyntaxError', "'(' was never closed"],
    ['SyntaxError', 'unterminated string literal (detected at line 3)'],
    ['SyntaxError', "expected ':'"],
    ['SyntaxError', 'invalid syntax'],
    ['RecursionError', 'maximum recursion depth exceeded'],
    ['KeyboardInterrupt', ''],
    ['EOFError', 'EOF when reading a line'],
    ['json.decoder.JSONDecodeError', 'Expecting value: line 1 column 1 (char 0)'],
    ['os.weird-name()', 'x']
  ]
  for (const [type, message] of cases) {
    for (const where of [at, null]) {
      const line = errorInWords({ type, message, frames: [], at: where })
      assert.ok(line.length > 0 && line.length <= 90, `${type}: "${line}" should be short`)
      assert.ok(!isCodeLine(line), `${type}: "${line}" reads as code`)
    }
  }
})
