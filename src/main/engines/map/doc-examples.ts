import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { DocExample } from '../../../shared/map'

/**
 * Short, verbatim examples from official documentation, shown in concept cards and Sources so the learner
 * does not have to read a whole reference page. Fetched by the app from the doc page itself: the model never
 * writes or sees them, so the coach still never writes code.
 */

/** Only official documentation sites. Anything else is never fetched. */
const OFFICIAL_HOSTS = new Set([
  'learn.microsoft.com',
  'docs.python.org',
  'developer.mozilla.org',
  'docs.oracle.com',
  'en.cppreference.com',
  'go.dev',
  'pkg.go.dev',
  'doc.rust-lang.org',
  'nodejs.org',
  'react.dev',
  'www.typescriptlang.org',
  'kotlinlang.org',
  'docs.swift.org',
  'www.php.net',
  'ruby-doc.org',
  'numpy.org',
  'pandas.pydata.org',
  'matplotlib.org',
  'docs.scipy.org',
  'scikit-learn.org',
  'pytorch.org'
])

/** Bump when extraction changes, so cached examples are fetched and extracted again. */
const EXTRACTOR_VERSION = 2
const EXCERPT_LINES = 8
const FULL_LINES = 80
const MAX_PAGE_BYTES = 4_000_000
const TIMEOUT_MS = 8000

/** Which language's examples to prefer, from what the project is written in. */
export function exampleLanguage(stacks: string[], languages: string[]): string | undefined {
  const all = [...languages, ...stacks].join(' ')
  if (/C#/.test(all)) return 'csharp'
  if (/Python/.test(all)) return 'python'
  if (/TypeScript/.test(all)) return 'typescript'
  if (/JavaScript/.test(all)) return 'javascript'
  if (/Java\b/.test(all)) return 'java'
  return undefined
}

export function isOfficialDoc(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && OFFICIAL_HOSTS.has(u.hostname)
  } catch {
    return false
  }
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
function text(htmlFragment: string): string {
  return htmlFragment
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, e: string) => {
      if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
      return ENTITIES[e.toLowerCase()] ?? whole
    })
}

function dedent(lines: string[]): string[] {
  const indents = lines.filter((l) => l.trim()).map((l) => l.length - l.trimStart().length)
  const cut = indents.length ? Math.min(...indents) : 0
  return lines.map((l) => l.slice(cut))
}

const trimBlank = (lines: string[]) => {
  let a = 0
  let b = lines.length
  while (a < b && !lines[a].trim()) a++
  while (b > a && !lines[b - 1].trim()) b--
  return lines.slice(a, b)
}

/** Which language's blocks to prefer, from the class names the doc sites use. */
const LANG_CLASS: Record<string, RegExp> = {
  csharp: /lang-csharp|language-csharp/,
  python: /python|lang-py/,
  javascript: /lang-js|language-js|brush: js|javascript/,
  typescript: /lang-ts|language-ts|typescript/,
  java: /lang-java|language-java/
}

interface Block {
  code: string
  cls: string
  at: number
}

function blocks(html: string, from = 0, to = html.length): Block[] {
  const out: Block[] = []
  const re = /<pre([^>]*)>\s*(?:<code([^>]*)>)?([\s\S]*?)<\/(?:code|pre)>/g
  re.lastIndex = from
  for (let m = re.exec(html); m && m.index < to; m = re.exec(html)) {
    out.push({ code: text(m[3]), cls: `${m[1]} ${m[2] ?? ''}`, at: m.index })
  }
  return out
}

/** The method's signature from Microsoft Learn's declaration blocks (attributes dropped): the simplest overload. */
function signature(html: string, lang: string | undefined): string | undefined {
  const want = LANG_CLASS[lang ?? 'csharp'] ?? LANG_CLASS.csharp
  const all = blocks(html)
    .filter((b) => /class="wrap"/.test(b.cls) && want.test(b.cls))
    .map((b) => b.code.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('[')))
    .filter((lines) => lines.length > 0 && lines.length <= 3)
    .map((lines) => lines.join(' '))
  // Versions of one overload differ only by nullable marks; the page lists the newest first, and sort is stable.
  const size = (sig: string) => sig.replace(/\?/g, '').length
  return all.sort((x, y) => size(x) - size(y))[0]
}

/** Where the examples for this link start: its #anchor, an "Examples" heading, or the whole page. */
function region(html: string, url: string): { from: number; to: number } {
  const hash = (() => {
    try {
      return decodeURIComponent(new URL(url).hash.slice(1))
    } catch {
      return ''
    }
  })()
  if (hash) {
    const at = html.search(new RegExp(`id=["']${hash.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`))
    if (at >= 0) {
      // Until the next definition or section with its own id (Python docs: <dt id=…>).
      const rest = html.slice(at + 1)
      const next = rest.search(/<dt[^>]+id=|<section[^>]+id=/)
      return { from: at, to: next >= 0 ? at + 1 + next : html.length }
    }
  }
  const examples = html.search(/<h2[^>]*>\s*Examples?\s*<\/h2>|<h2[^>]+id=["']examples["']/i)
  return examples >= 0 ? { from: examples, to: html.length } : { from: 0, to: html.length }
}

/**
 * The example for one concept, pulled from a doc page. `term` is what the coach explained ("double.Parse",
 * "Console.ReadLine"): the excerpt centres on the line that uses it, preferring the full name over the bare one.
 */
export function extractExample(html: string, url: string, term: string, lang?: string): DocExample | null {
  const { from, to } = region(html, url)
  const all = blocks(html, from, to).filter((b) => !/class="wrap"/.test(b.cls) && b.code.trim().length > 0)
  if (all.length === 0) return null
  const want = lang ? LANG_CLASS[lang] : undefined
  const tagged = all.some((b) => /lang-|language-|brush:/.test(b.cls))
  const pool = want && tagged ? all.filter((b) => want.test(b.cls)) : all
  if (pool.length === 0) return null

  const name = term.trim().replace(/\(\)$/, '')
  const member = name.split('.').pop() ?? name
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const full = new RegExp(`${esc(name)}\\s*\\(`, 'i')
  const bare = new RegExp(`(?:^|[^\\w])${esc(member)}\\s*\\(`)
  const declaration = /^\s*(?:public|private|protected|internal|static|def|function|fn|func)\b/

  // The clearest line that uses it, across all examples: one that keeps the result (x = …), then the shortest.
  let pick = null as { block: Block; hit: number; score: number } | null
  for (const re of [full, bare]) {
    for (const block of pool) {
      block.code.split('\n').forEach((l, hit) => {
        if (!re.test(l) || declaration.test(l)) return
        const call = l.search(re)
        const keeps = /[^=!<>]=[^=]/.test(l.slice(0, call + 1))
        const score = (keeps ? 0 : 1000) + l.trim().length
        if (!pick || score < pick.score) pick = { block, hit, score }
      })
    }
    if (pick) break
  }
  // No line uses it (the term is an idea like "turning text into a number", not a method): show nothing rather
  // than the top of some unrelated example.
  if (!pick) return null
  const block = pick.block
  const raw = block.code.replace(/\r/g, '').split('\n')
  const lines = trimBlank(raw)
  const hit = pick.hit - leadingBlank(raw)
  let start = 0
  let end = Math.min(lines.length, EXCERPT_LINES)
  if (lines.length > EXCERPT_LINES && hit >= 0) {
    start = Math.max(0, hit - 3)
    end = Math.min(lines.length, start + EXCERPT_LINES)
  }
  const window = lines.slice(start, end)
  const excerpt = trimBlank(dedent(window))
  const focus = hit >= 0 ? hit - start - leadingBlank(window) : -1
  return {
    url,
    signature: signature(html, lang),
    excerpt,
    ...(focus >= 0 ? { focus } : {}),
    full: lines.length > excerpt.length ? lines.slice(0, FULL_LINES) : undefined
  }
}

function leadingBlank(lines: string[]): number {
  let n = 0
  for (const l of lines) {
    if (l.trim()) break
    n++
  }
  return n
}

/**
 * The example as the editor shows it under the step (word for word): the whole example when there is one, with the
 * line that uses the method lit; otherwise the few lines around it. No example: no lines, focus -1.
 */
export function editorExample(example: DocExample | null): { lines: string[]; focus: number } {
  if (!example || example.excerpt.length === 0) return { lines: [], focus: -1 }
  const focusLine = example.focus !== undefined ? example.excerpt[example.focus] : undefined
  if (example.full && focusLine !== undefined) {
    const at = example.full.findIndex((l) => l.trim() === focusLine.trim())
    if (at >= 0) return { lines: example.full.slice(0, FULL_LINES), focus: at < FULL_LINES ? at : -1 }
  }
  return { lines: example.excerpt, focus: example.focus ?? -1 }
}

/** Fetch (or reuse) the example for a doc link. Null for unofficial sites, failures, or pages with no example. */
export function createDocExamples(cacheDir: string, fetcher: typeof fetch = fetch) {
  const memory = new Map<string, Promise<DocExample | null>>()

  async function load(url: string, term: string, lang?: string): Promise<DocExample | null> {
    // The version is in the key: a better extractor must not keep serving what an older one cached.
    const key = createHash('sha1').update(`${EXTRACTOR_VERSION}\n${url}\n${term}\n${lang ?? ''}`).digest('hex')
    const file = join(cacheDir, `${key}.json`)
    try {
      return JSON.parse(await readFile(file, 'utf8')) as DocExample | null
    } catch {
      // not cached yet
    }
    const res = await fetcher(url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'follow' })
    if (!res.ok || !isOfficialDoc(res.url || url)) return null
    const html = await res.text()
    if (html.length > MAX_PAGE_BYTES) return null
    const example = extractExample(html, url, term, lang)
    await mkdir(cacheDir, { recursive: true })
    await writeFile(file, JSON.stringify(example))
    return example
  }

  return (url: string, term: string, lang?: string): Promise<DocExample | null> => {
    if (!isOfficialDoc(url)) return Promise.resolve(null)
    const key = `${url}\n${term}\n${lang ?? ''}`
    let p = memory.get(key)
    if (!p) {
      p = load(url, term, lang).catch(() => null)
      memory.set(key, p)
      // A failure (offline) may succeed later.
      void p.then((r) => r === null && memory.delete(key))
    }
    return p
  }
}
