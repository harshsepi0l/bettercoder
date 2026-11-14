import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BLOCK_NOTICE, INLINE_NOTICE, StreamGuard, isCodeLine } from '../src/main/core/guard'

function streamInChunks(text: string, size: number): { text: string; removed: number } {
  const g = new StreamGuard()
  let out = ''
  for (let i = 0; i < text.length; i += size) out += g.push(text.slice(i, i + size))
  out += g.end()
  return { text: out, removed: g.removed }
}

const PROSE = `That error comes from the container, not your controller.
If you think about where services get registered, which file runs first when the app starts?
Have a look at \`Program.cs\` and compare it with what the docs say about \`IServiceCollection\`.`

test('plain prose passes through unchanged', () => {
  const r = StreamGuard.clean(PROSE)
  assert.equal(r.text, PROSE)
  assert.equal(r.removed, 0)
})

test('fenced code blocks are removed whole', () => {
  const text = 'Here is the fix:\n```csharp\nbuilder.Services.AddScoped<IOrderRepository, OrderRepository>();\nvar app = builder.Build();\n```\nThat should work.'
  const r = StreamGuard.clean(text)
  assert.ok(!r.text.includes('AddScoped'))
  assert.ok(!r.text.includes('builder.Build'))
  assert.ok(r.text.includes(BLOCK_NOTICE))
  assert.ok(r.text.includes('That should work.'))
})

test('unfenced code lines are removed', () => {
  const lines = [
    'def add(a, b):',
    '    return a + b',
    'builder.Services.AddScoped<IOrderRepository, OrderRepository>();',
    'const total = items.reduce((a, b) => a + b, 0);',
    'for (int i = 0; i < n; i++) {',
    '}',
    'import os',
    'from flask import Flask',
    'x = 5',
    'print("hello")',
    'public class OrderRepository : IOrderRepository {',
    '#include <vector>',
    'SELECT * FROM orders WHERE id = 1'
  ]
  for (const line of lines) {
    const r = StreamGuard.clean(`Try this:\n${line}\nGood luck.`)
    assert.ok(!r.text.includes(line.trim()), `leaked: ${line}`)
    assert.ok(r.text.includes('Good luck.'))
  }
})

test('inline names and paths are allowed, inline code is not', () => {
  const ok = StreamGuard.clean('Open `src/Program.cs` and find `IOrderRepository`, then run `dotnet test`.')
  assert.equal(ok.removed, 0)
  const bad = StreamGuard.clean('Just add `services.AddScoped<IOrderRepository, OrderRepository>()` there.')
  assert.ok(!bad.text.includes('AddScoped'))
  assert.ok(bad.text.includes(INLINE_NOTICE))
  const bad2 = StreamGuard.clean('Change it to `if (x == null) return;` and it works.')
  assert.ok(!bad2.text.includes('x == null'))
})

test('sentences that start like keywords but are prose survive', () => {
  for (const line of [
    'If you register the interface, the container can build the controller.',
    'Return to the docs page on lifetimes once you have tried it.',
    'Import errors in Python usually mean the module is not on the path.',
    'For each request, a scoped service is created once.',
    'Class names in C# are usually PascalCase.'
  ]) {
    assert.ok(!isCodeLine(line), `false positive: ${line}`)
    assert.equal(StreamGuard.clean(line).text, line)
  }
})

test('streaming in any chunk size gives the same result as whole text', () => {
  const text = `${PROSE}\n\nWrong way:\n\`\`\`python\ndef f(x):\n    return x * 2\n\`\`\`\nAnd \`a = b + c\` inline.\nreturn value;\nDone.`
  const whole = StreamGuard.clean(text)
  for (const size of [1, 2, 3, 7, 16, 50]) {
    const s = streamInChunks(text, size)
    assert.equal(s.text, whole.text, `chunk size ${size}`)
    assert.ok(!s.text.includes('return x * 2'))
    assert.ok(!s.text.includes('a = b + c'))
  }
})

test('code never appears in any streamed prefix', () => {
  const text = 'Look here:\nconst secret = computeFix(order);\nThat is all.'
  const g = new StreamGuard()
  let shown = ''
  for (const ch of text) {
    shown += g.push(ch)
    assert.ok(!shown.includes('computeFix'), `leaked mid-stream: ${shown}`)
  }
})

test('a bare function name like remove() is a name, not code', () => {
  assert.ok(!isCodeLine('remove()'))
  assert.ok(!isCodeLine('todos.add()'))
  assert.ok(isCodeLine('remove(1)'))
  assert.ok(isCodeLine('todos.add("milk");'))
})

test('prose that mentions a bare name like spread() is not code', () => {
  assert.ok(!isCodeLine('read spread()'))
  assert.ok(!isCodeLine('Step through todos.add() once'))
  assert.ok(isCodeLine('x = spread(grid);'))
})

test('guard: printed values are data, not code (regression: a hidden example printing [1, 2, 3] was refused)', async () => {
  const { isDataLiteral } = await import('../src/main/core/guard')
  for (const ok of ['[1, 2, 3]', '[3, 2, 1]', "{'a': 1, 'b': [2, 3]}", '(3, "x")', 'True', '-4.5', '{"name": "Ada", "score": 42}', "b'abc'", '[]'])
    assert.equal(isDataLiteral(ok), true, ok)
  for (const code of ['x = [1, 2]', 'print(a)', 'nums[i]', 'f(1, 2)', 'a + b', 'def f():', '1 2'])
    assert.equal(isDataLiteral(code), false, code)
})

/**
 * Regression (real session check, 2026-11-14): a step card's idea "using the TryParse result" was taken for a C#
 * using line, and the card was refused 6 times with no hint of why (88k tokens for one reply). A keyword line that
 * reads as a sentence is prose; code after a keyword is still code; and a refusal names the words.
 */
test('a sentence that starts with a code keyword is prose; code that starts with one is still code', async () => {
  const { isCodeLine } = await import('../src/main/core/guard')
  for (const prose of ['using the TryParse result', 'return the total to the caller', 'import the data from a file', 'let the user type a number', "using TryParse's success flag", 'return leaves — second-number prompt never runs']) {
    assert.equal(isCodeLine(prose), false, prose)
  }
  for (const code of ['using System;', 'using System.Text', 'public class Foo', 'static void Main', 'return total;', 'import os', 'const x = 5', 'let the = 3', "using 'System'", 'return a + b']) {
    assert.equal(isCodeLine(code), true, code)
  }
  const { cardProblem } = await import('../src/main/coach/tools/cards')
  assert.equal(cardProblem({ kind: 'step', title: 'Act on it', idea: { term: 'using the TryParse result', explanation: 'It says whether it worked.' }, lines: [] }), null)
  assert.match(cardProblem({ kind: 'step', title: 'x = int(input())', lines: [] }) ?? '', /"x = int\(input\(\)\)"/)
})
