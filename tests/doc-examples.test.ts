// Official examples in concept cards and Sources, so the learner need not read whole reference pages.
// Fixtures are trimmed copies of the real pages (Microsoft Learn, Python docs, MDN).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDocExamples, exampleLanguage, extractExample, isOfficialDoc } from '../src/main/engines/map/doc-examples'

const page = (name: string) => readFile(join(import.meta.dirname, 'fixtures', 'docs', name), 'utf8')
const focused = (e: ReturnType<typeof extractExample>) => (e && e.focus !== undefined ? e.excerpt[e.focus] : '')

test('Console.ReadLine: the signature and a few lines that keep what was read', async () => {
  const e = extractExample(await page('console-readline.html'), 'https://learn.microsoft.com/en-us/dotnet/api/system.console.readline', 'Console.ReadLine', 'csharp')
  assert.equal(e?.signature, 'public static string? ReadLine();')
  assert.match(focused(e), /=\s*Console\.ReadLine\(\)/)
  assert.ok(e!.excerpt.length <= 8)
  assert.ok(e!.full && e!.full.length > e!.excerpt.length, 'the full example is there on request')
  assert.ok(!e!.excerpt.some((l) => /^\s*(let|Dim)\b/.test(l)), 'C# only, not F# or VB')
})

test('double.Parse: the library call, not a custom class with its own Parse method', async () => {
  const e = extractExample(await page('double-parse.html'), 'https://learn.microsoft.com/en-us/dotnet/api/system.double.parse', 'double.Parse', 'csharp')
  assert.equal(e?.signature, 'public static double Parse(string s);')
  assert.match(focused(e), /Double\.Parse\(/i)
  assert.doesNotMatch(focused(e), /public static/)
})

test('Python docs: the example right under the #input anchor', async () => {
  const e = extractExample(await page('python-functions.html'), 'https://docs.python.org/3/library/functions.html#input', 'input', 'python')
  assert.match(focused(e), /input\(/)
  assert.equal(e?.signature, undefined)
})

test('MDN: a short parseInt example', async () => {
  const e = extractExample(await page('mdn-parseint.html'), 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/parseInt', 'parseInt', 'javascript')
  assert.match(focused(e), /parseInt\(/)
})

test('only official doc sites are fetched; results are cached; failures are retried later', async () => {
  assert.equal(isOfficialDoc('https://learn.microsoft.com/en-us/dotnet/api/system.console.readline'), true)
  assert.equal(isOfficialDoc('https://stackoverflow.com/questions/1'), false)
  assert.equal(isOfficialDoc('http://learn.microsoft.com/x'), false)

  const html = await page('console-readline.html')
  let calls = 0
  let fail = true
  const fetcher = (async (url: string) => {
    calls++
    if (fail) throw new Error('offline')
    return { ok: true, url, text: async () => html } as Response
  }) as typeof fetch
  const get = createDocExamples(await mkdtemp(join(tmpdir(), 'bc-docs-')), fetcher)
  const url = 'https://learn.microsoft.com/en-us/dotnet/api/system.console.readline'

  assert.equal(await get('https://stackoverflow.com/q/1', 'ReadLine'), null)
  assert.equal(calls, 0, 'never fetched')
  assert.equal(await get(url, 'Console.ReadLine', 'csharp'), null, 'offline')
  await new Promise((r) => setTimeout(r, 0))
  fail = false
  assert.ok((await get(url, 'Console.ReadLine', 'csharp'))?.signature)
  assert.ok((await get(url, 'Console.ReadLine', 'csharp'))?.signature)
  assert.equal(calls, 2, 'one failed try, then one fetch; the rest from cache')

  const redirected = createDocExamples(await mkdtemp(join(tmpdir(), 'bc-docs-')), (async () =>
    ({ ok: true, url: 'https://evil.example/page', text: async () => html }) as Response) as typeof fetch)
  assert.equal(await redirected(url, 'Console.ReadLine'), null, 'a redirect off the official site is refused')
})

test('examples follow the project language', () => {
  assert.equal(exampleLanguage(['C#'], ['C#']), 'csharp')
  assert.equal(exampleLanguage([], ['Python']), 'python')
  assert.equal(exampleLanguage([], []), undefined)
})

// Real session: an idea ("turning text into a number") linked to a page showed the top of an unrelated example.
test('a term no example line uses gives no example, not the top of the page', async () => {
  const html = await page('console-readline.html')
  assert.equal(extractExample(html, 'https://learn.microsoft.com/en-us/dotnet/api/system.console.readline', 'turning text into a number', 'csharp'), null)
})
