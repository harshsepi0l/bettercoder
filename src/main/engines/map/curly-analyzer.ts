import type { MapMember, MapNodeKind } from '../../../shared/map'

/**
 * A light reader for brace languages (Java, C#, TypeScript/JavaScript, Kotlin,
 * Swift, C++). It finds types, what they extend/implement, and their members by
 * pattern and brace depth. Not a compiler: good enough for a class diagram.
 */

export interface CurlyType {
  name: string
  kind: MapNodeKind
  line: number
  extends: string[]
  implements: string[]
  fields: MapMember[]
  methods: MapMember[]
  /** Identifiers used inside the type's body, for "uses" arrows. */
  refs: string[]
}

export interface CurlyFile {
  types: CurlyType[]
  /** Top-level functions (JS/TS/Kotlin/Swift/C++). */
  functions: Array<MapMember & { refs: string[] }>
  imports: string[]
}

const TYPE_DECL =
  /^\s*(?:export\s+)?(?:default\s+)?(?:public\s+|private\s+|protected\s+|internal\s+|open\s+|sealed\s+|final\s+|static\s+|partial\s+|data\s+)*(abstract\s+)?(class|interface|enum|struct|record|object|protocol|trait)\s+([A-Za-z_]\w*)(?:<[^>{]*>)?([^{]*)\{?/
const METHOD =
  /^\s*(?:@\w+(?:\([^)]*\))?\s*)*(?:(public|private|protected|internal)\s+)?(?:(static)\s+)?(?:(?:abstract|override|virtual|async|final|open|suspend|inline|synchronized|default|readonly)\s+)*(?:fun\s+|func\s+|function\s+)?(?:[\w<>[\],.?]+\s+)?([A-Za-z_]\w*)\s*(\([^)]*\))\s*(?::\s*[\w<>[\],.?| ]+)?\s*(?:throws\s+[\w., ]+)?\s*(\{|=>|;|$)/
const FIELD =
  /^\s*(?:@\w+(?:\([^)]*\))?\s*)*(?:(public|private|protected|internal)\s+)?(?:(static)\s+)?(?:(?:final|readonly|const|let|var|val|lateinit)\s+)*(?:([\w<>[\],.?]+)\s+)?([A-Za-z_]\w*)\s*(?::\s*([\w<>[\],.?| ]+))?\s*(?:=[^;{]*)?;\s*$/
const TOP_FUNCTION = /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|fun|func)\s+([A-Za-z_]\w*)\s*(\([^)]*\))/
const ARROW_FUNCTION = /^\s*(?:export\s+)?const\s+([A-Za-z_]\w*)\s*=\s*(?:async\s*)?(\([^)]*\)|[A-Za-z_]\w*)\s*=>/
const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'new', 'else', 'do', 'try', 'throw', 'when', 'guard', 'super', 'this', 'constructor'])

function splitNames(s: string): string[] {
  return s
    .split(',')
    .map((x) => x.replace(/<.*$/, '').replace(/\(.*$/, '').trim())
    .filter((x) => /^[A-Za-z_][\w.]*$/.test(x))
}

/** extends/implements from the text after the type name. */
function heritage(rest: string, kind: MapNodeKind): { ext: string[]; impl: string[] } {
  const ext: string[] = []
  const impl: string[] = []
  const e = /\bextends\s+([^{]*?)(?:\bimplements\b|$)/.exec(rest)
  const i = /\bimplements\s+([^{]*)/.exec(rest)
  if (e) (kind === 'interface' ? impl : ext).push(...splitNames(e[1]))
  if (i) impl.push(...splitNames(i[1]))
  // C#, Kotlin, Swift, C++: "class A : B, IC" (C# interfaces conventionally start with I).
  const colon = /^\s*:\s*([^{]*)/.exec(rest)
  if (!e && !i && colon) {
    const names = splitNames(colon[1].replace(/\b(public|private|protected|virtual)\b/g, ''))
    names.forEach((n, k) => {
      if (kind === 'interface' || (/^I[A-Z]/.test(n) && k >= 0) || (k > 0 && kind !== 'class')) impl.push(n)
      else if (k === 0) ext.push(n)
      else impl.push(n)
    })
  }
  return { ext, impl }
}

export function analyzeCurly(source: string): CurlyFile {
  const lines = source.split('\n')
  const types: CurlyType[] = []
  const functions: CurlyFile['functions'] = []
  const imports = new Set<string>()
  const stack: Array<{ type: CurlyType | null; depth: number }> = []
  let depth = 0
  let inBlockComment = false
  let currentFn: { refs: Set<string>; depth: number } | null = null
  /** The method whose body we are in, to spot unfinished ones. */
  let currentMethod: { member: MapMember; depth: number } | null = null

  lines.forEach((raw, idx) => {
    if (currentMethod && /\b(TODO|FIXME)\b|NotImplemented|UnsupportedOperationException/.test(raw)) currentMethod.member.stub = true
    let line = raw
    if (inBlockComment) {
      const end = line.indexOf('*/')
      if (end === -1) return
      line = line.slice(end + 2)
      inBlockComment = false
    }
    line = line.replace(/\/\*.*?\*\//g, '').replace(/\/\/.*$/, '')
    if (line.includes('/*')) {
      inBlockComment = true
      line = line.slice(0, line.indexOf('/*'))
    }
    const n = idx + 1
    // JS/TS name the package in from '...' or require('...'); Java/C#/C++ right after the keyword.
    const imp =
      /\bfrom\s+['"]([^'"]+)['"]/.exec(line) ??
      /\brequire\(\s*['"]([^'"]+)['"]\s*\)/.exec(line) ??
      /^\s*import\s+['"]([^'"]+)['"]/.exec(line) ??
      /^\s*(?:import|using|#include)\s+(?:static\s+)?[<"]?([\w@./-]+)/.exec(line)
    if (imp) imports.add(imp[1].replace(/^@/, '').split(/[./]/)[0])

    const top = stack.at(-1)
    const inType = top?.type ?? null
    const typeDepth = top?.depth ?? -1
    const decl = TYPE_DECL.exec(line)
    if (decl) {
      const word = decl[2]
      const kind: MapNodeKind =
        word === 'interface' || word === 'protocol' || word === 'trait'
          ? 'interface'
          : word === 'enum'
            ? 'enum'
            : word === 'struct' || word === 'record'
              ? 'struct'
              : decl[1]
                ? 'abstract'
                : 'class'
      const { ext, impl } = heritage(decl[4] ?? '', kind)
      const t: CurlyType = { name: decl[3], kind, line: n, extends: ext, implements: impl, fields: [], methods: [], refs: [] }
      types.push(t)
      stack.push({ type: t, depth })
    } else if (inType && depth === typeDepth + 1) {
      const m = METHOD.exec(line)
      if (m && !KEYWORDS.has(m[3])) {
        const member: MapMember = {
          name: m[3],
          detail: m[4].replace(/\s+/g, ' '),
          line: n,
          visibility: (m[1] as MapMember['visibility']) ?? undefined,
          isStatic: !!m[2]
        }
        inType.methods.push(member)
        if (m[5] === '{' || m[5] === '' || m[5] === undefined) currentMethod = { member, depth }
        // A one-line body is on this same line.
        if (/\b(TODO|FIXME)\b|NotImplemented|UnsupportedOperationException/.test(raw)) member.stub = true
      } else {
        const f = FIELD.exec(line)
        if (f && !KEYWORDS.has(f[4])) {
          inType.fields.push({ name: f[4], detail: f[5] ?? f[3] ?? '', line: n, visibility: (f[1] as MapMember['visibility']) ?? undefined, isStatic: !!f[2] })
        }
      }
    } else if (!inType && depth === 0) {
      const fn = TOP_FUNCTION.exec(line) ?? ARROW_FUNCTION.exec(line)
      if (fn) {
        const entry = { name: fn[1], detail: fn[2].startsWith('(') ? fn[2] : `(${fn[2]})`, line: n, refs: [] as string[] }
        functions.push(entry)
        currentFn = { refs: new Set(), depth }
        ;(entry as { refs: string[] }).refs = [] // filled below as the body is read
        ;(currentFn as unknown as { entry: typeof entry }).entry = entry
      }
    }

    for (const id of line.match(/\b[A-Z][A-Za-z0-9_]*\b/g) ?? []) {
      if (inType && id !== inType.name) inType.refs.push(id)
    }
    if (currentFn) for (const id of line.match(/\b[A-Za-z_]\w*\b/g) ?? []) currentFn.refs.add(id)

    for (const ch of line) {
      if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        while (stack.length && depth <= stack.at(-1)!.depth) stack.pop()
        if (currentMethod && depth <= currentMethod.depth) currentMethod = null
        if (currentFn && depth <= currentFn.depth) {
          const entry = (currentFn as unknown as { entry: { refs: string[] } }).entry
          entry.refs = [...currentFn.refs]
          currentFn = null
        }
      }
    }
  })
  for (const t of types) t.refs = [...new Set(t.refs)]
  return { types, functions, imports: [...imports] }
}
