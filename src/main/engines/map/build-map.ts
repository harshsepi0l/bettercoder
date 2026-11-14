import { spawn } from 'node:child_process'
import { readFile, readdir, stat } from 'node:fs/promises'
import { basename, dirname, extname, join, normalize, relative } from 'node:path'
import type { CodeMap, EdgeEvidence, MapEdge, MapMember, MapNode } from '../../../shared/map'
import type { ProjectInfo } from '../../../shared/ipc'
import { SKIP_DIRS } from '../../core/paths'
import type { CodeMapper } from '../../ports'
import { isSecretPath } from '../../core/paths'
import { notebookToPython } from '../../core/text-view'
import { findPython } from '../python'
import { analyzeCurly } from './curly-analyzer'
import { PYTHON_ANALYZER } from './python-analyzer'
import { analyzeTs, type Ref } from './ts-analyzer'

/**
 * Builds the project's class map by reading code (nothing runs):
 *   Python + notebooks: Python's own parser (ast)
 *   TypeScript / JavaScript: the TypeScript compiler's parser
 *   Java, C#, Kotlin, Swift, C++: a pattern reader
 *
 * Every arrow is resolved through a real definition: a name defined in the same
 * file, or imported from a file in the project. Names never match across
 * languages, and each arrow carries the line(s) that justify it.
 */

const MAX_FILES = 400
const MAX_FILE_BYTES = 400 * 1024
const MAX_NOTEBOOK_BYTES = 20 * 1024 * 1024
const MAX_EVIDENCE = 5

type Lang = 'python' | 'ts' | 'java' | 'csharp' | 'kotlin' | 'swift' | 'cpp'
const LANG_OF: Record<string, Lang> = {
  '.py': 'python', '.ipynb': 'python',
  '.ts': 'ts', '.tsx': 'ts', '.js': 'ts', '.jsx': 'ts', '.mjs': 'ts', '.cjs': 'ts',
  '.java': 'java', '.cs': 'csharp', '.kt': 'kotlin', '.swift': 'swift',
  '.cpp': 'cpp', '.cc': 'cpp', '.hpp': 'cpp', '.h': 'cpp'
}
const LANG_NAME: Record<Lang, string> = {
  python: 'Python', ts: 'TypeScript/JavaScript', java: 'Java', csharp: 'C#', kotlin: 'Kotlin', swift: 'Swift', cpp: 'C++'
}
const TS_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']

/** One file's symbols: what it defines and what its imported names point to. */
interface FileSymbols {
  path: string
  lang: Lang
  /** Name defined here → node id (classes etc. by name; functions → this file's module box). */
  defines: Map<string, string>
  /** Local name → where it comes from. */
  imports: Map<string, { file?: string; imported: string; module: string; line: number }>
  /** Boxes in this file with what they reference. */
  owners: Array<{ id: string; refs: Ref[]; bases: Ref[]; implementsRefs: Ref[] }>
}

async function listCodeFiles(project: ProjectInfo): Promise<{ files: string[]; truncated: boolean }> {
  const wanted = (rel: string) => !!LANG_OF[extname(rel).toLowerCase()] && !isSecretPath(rel) && !/\.d\.ts$|\.min\.js$/.test(rel)
  if (project.files) return { files: project.files.filter(wanted), truncated: false }
  const out: string[] = []
  let truncated = false
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 10) return
    for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (out.length >= MAX_FILES) {
        truncated = true
        return
      }
      if (e.name.startsWith('.')) continue
      const full = join(dir, e.name)
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) await walk(full, depth + 1)
      } else if (e.isFile()) {
        const rel = relative(project.root, full)
        if (wanted(rel)) out.push(rel)
      }
    }
  }
  await walk(project.root, 0)
  return { files: out.sort(), truncated }
}

interface PyImport {
  local: string
  module: string
  imported: string
  level: number
  line: number
}
interface PyFileResult {
  path: string
  classes: Array<{
    name: string
    line: number
    bases: string[]
    baseRefs: Ref[]
    kind: MapNode['kind']
    methods: Array<{ name: string; args: string; line: number; stub: boolean; static: boolean; visibility: MapMember['visibility'] }>
    fields: Array<{ name: string; line: number; visibility: MapMember['visibility']; static?: boolean }>
    refs: Ref[]
  }>
  functions: Array<{ name: string; args: string; line: number; stub: boolean; refs: Ref[] }>
  imports: PyImport[]
  errors: string[]
}

function runPythonAnalyzer(python: string, input: unknown): Promise<PyFileResult[]> {
  return new Promise((done, fail) => {
    // Only parses (ast): the code arrives on stdin and is never imported or run.
    const child = spawn(python, ['-E', '-c', PYTHON_ANALYZER], { stdio: ['pipe', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      fail(new Error('Reading the Python code took too long.'))
    }, 30000)
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    child.on('error', fail)
    child.on('close', () => {
      clearTimeout(timer)
      try {
        done(JSON.parse(out) as PyFileResult[])
      } catch {
        fail(new Error(`Could not read the Python code. ${err.trim().split('\n').at(-1) ?? ''}`))
      }
    })
    child.stdin.end(JSON.stringify(input))
  })
}

/** Python module → project file, trying the importing file's package and every folder above it as a source root. */
function resolvePythonModule(fromFile: string, imp: PyImport, fileSet: Set<string>): string | undefined {
  const parts = imp.module ? imp.module.split('.') : []
  const tryBase = (base: string): string | undefined => {
    const stem = join(base, ...parts)
    // "from pkg import module": when the imported name is itself a module file, that is what it means.
    if (imp.imported !== '*') {
      const sub = join(stem, imp.imported)
      for (const cand of [`${sub}.py`, join(sub, '__init__.py')]) if (fileSet.has(normalize(cand))) return normalize(cand)
    }
    for (const cand of [`${stem}.py`, join(stem, '__init__.py'), `${stem}.ipynb`]) {
      const n = normalize(cand)
      if (fileSet.has(n)) return n
    }
    return undefined
  }
  if (imp.level > 0) {
    let base = dirname(fromFile)
    for (let i = 1; i < imp.level; i++) base = dirname(base)
    return tryBase(base === '.' ? '' : base)
  }
  let dir = dirname(fromFile)
  for (;;) {
    const hit = tryBase(dir === '.' ? '' : dir)
    if (hit) return hit
    if (dir === '.' || dir === '' || dir === '/') return undefined
    dir = dirname(dir)
  }
}

/** TS/JS specifier → project file: relative paths, and "@/" style aliases rooted at a src folder. */
function resolveTsModule(fromFile: string, spec: string, fileSet: Set<string>, srcRoots: string[]): string | undefined {
  const tryStem = (stem: string): string | undefined => {
    const s = normalize(stem)
    if (fileSet.has(s)) return s
    for (const ext of TS_EXTS) if (fileSet.has(s + ext)) return s + ext
    // "./x.js" written for a .ts file.
    const noExt = s.replace(/\.(m|c)?js$/, '')
    if (noExt !== s) for (const ext of TS_EXTS) if (fileSet.has(noExt + ext)) return noExt + ext
    for (const ext of TS_EXTS) if (fileSet.has(join(s, `index${ext}`))) return join(s, `index${ext}`)
    return undefined
  }
  if (spec.startsWith('.')) return tryStem(join(dirname(fromFile), spec))
  const alias = /^[@~#]\/(.*)$/.exec(spec)
  if (alias) for (const root of srcRoots) {
    const hit = tryStem(join(root, alias[1]))
    if (hit) return hit
  }
  return undefined
}

/** The package name of a non-project import, for Sources. */
function packageName(spec: string): string | null {
  if (/^[@~#]\//.test(spec)) return null // a path alias into the project, not a package
  if (spec.startsWith('node:')) return 'node'
  if (spec.startsWith('@')) return spec.split('/').slice(0, 2).join('/').replace(/^@/, '')
  return spec.split('/')[0]
}

export async function buildMap(project: ProjectInfo): Promise<CodeMap> {
  const { files, truncated } = await listCodeFiles(project)
  const fileSet = new Set(files.map((f) => normalize(f)))
  const srcRoots = [...new Set(files.map((f) => f.split('/')).filter((p) => p.includes('src')).map((p) => p.slice(0, p.indexOf('src') + 1).join('/')))]
  const nodes: MapNode[] = []
  const symbols: FileSymbols[] = []
  const libraries = new Set<string>()
  const languages = new Set<string>()
  const skipped: CodeMap['skipped'] = []
  const pyInputs: Array<{ path: string; source: string; cells?: Array<{ start: number; end: number }>; viewLineOf?: number[] }> = []
  const tsImportsByFile = new Map<string, Array<{ local: string; imported: string; from: string; line: number }>>()

  for (const rel of files) {
    const ext = extname(rel).toLowerCase()
    const lang = LANG_OF[ext]
    const full = join(project.root, rel)
    const info = await stat(full).catch(() => null)
    if (!info || info.size > (ext === '.ipynb' ? MAX_NOTEBOOK_BYTES : MAX_FILE_BYTES)) {
      skipped.push({ file: rel, reason: 'too large to map' })
      continue
    }
    const raw = await readFile(full, 'utf8').catch(() => null)
    if (raw === null) continue
    languages.add(LANG_NAME[lang])
    if (lang === 'python') {
      if (ext === '.ipynb') {
        const nb = notebookToPython(raw)
        if (nb) pyInputs.push({ path: rel, source: nb.code, cells: nb.cells, viewLineOf: nb.viewLineOf })
      } else pyInputs.push({ path: rel, source: raw })
      continue
    }
    const sym: FileSymbols = { path: rel, lang, defines: new Map(), imports: new Map(), owners: [] }
    if (lang === 'ts') {
      let r
      try {
        r = analyzeTs(rel, raw)
      } catch (e) {
        skipped.push({ file: rel, reason: `could not be parsed: ${(e as Error).message}` })
        continue
      }
      tsImportsByFile.set(rel, r.imports)
      for (const d of r.decls) {
        const id = `${rel}#${d.name}`
        nodes.push({ id, kind: d.kind, name: d.name, file: rel, line: d.line, fields: d.fields, methods: d.methods })
        sym.defines.set(d.name, id)
        sym.owners.push({ id, refs: d.refs, bases: d.extends, implementsRefs: d.implements })
      }
      if (r.functions.length) {
        const id = `${rel}#module`
        nodes.push({ id, kind: 'module', name: basename(rel), file: rel, line: 1, fields: [], methods: r.functions.map(({ refs: _r, ...m }) => m) })
        for (const f of r.functions) sym.defines.set(f.name, id)
        sym.owners.push({ id, refs: r.functions.flatMap((f) => f.refs), bases: [], implementsRefs: [] })
      }
    } else {
      const r = analyzeCurly(raw)
      r.imports.forEach((i) => libraries.add(i))
      for (const t of r.types) {
        const id = `${rel}#${t.name}`
        nodes.push({ id, kind: t.kind, name: t.name, file: rel, line: t.line, fields: t.fields, methods: t.methods })
        sym.defines.set(t.name, id)
        // The pattern reader has no per-reference lines; the declaration line stands in.
        sym.owners.push({
          id,
          refs: t.refs.map((name) => ({ name, line: t.line })),
          bases: t.extends.map((name) => ({ name, line: t.line })),
          implementsRefs: t.implements.map((name) => ({ name, line: t.line }))
        })
      }
      if (r.functions.length) {
        const id = `${rel}#module`
        nodes.push({ id, kind: 'module', name: basename(rel), file: rel, line: 1, fields: [], methods: r.functions.map(({ refs: _r, ...m }) => m) })
        for (const f of r.functions) sym.defines.set(f.name, id)
        sym.owners.push({ id, refs: r.functions.flatMap((f) => f.refs.map((name) => ({ name, line: f.line }))), bases: [], implementsRefs: [] })
      }
    }
    symbols.push(sym)
  }

  if (pyInputs.length) {
    const python = await findPython()
    if (!python) skipped.push(...pyInputs.map((p) => ({ file: p.path, reason: 'Python 3 not found to read it' })))
    else {
      const results = await runPythonAnalyzer(python, pyInputs.map(({ path, source, cells }) => ({ path, source, ...(cells ? { cells } : {}) })))
      for (const r of results) {
        const input = pyInputs.find((p) => p.path === r.path)!
        const at = (line: number) => input.viewLineOf?.[line - 1] ?? line
        const mapRefs = (refs: Ref[]) => refs.map((x) => ({ ...x, line: at(x.line) }))
        if (r.errors.length) skipped.push({ file: r.path, reason: `parts could not be read: ${r.errors.slice(0, 2).join('; ')}` })
        const sym: FileSymbols = { path: r.path, lang: 'python', defines: new Map(), imports: new Map(), owners: [] }
        for (const imp of r.imports) {
          const file = resolvePythonModule(r.path, imp, fileSet)
          sym.imports.set(imp.local, { file, imported: imp.imported, module: imp.module, line: at(imp.line) })
          if (!file && imp.level === 0 && imp.module) libraries.add(imp.module.split('.')[0])
        }
        for (const c of r.classes) {
          const id = `${r.path}#${c.name}`
          nodes.push({
            id,
            kind: c.kind,
            name: c.name,
            file: r.path,
            line: at(c.line),
            fields: c.fields.map((f) => ({ name: f.name, detail: '', line: at(f.line), visibility: f.visibility, isStatic: f.static })),
            methods: c.methods.map((m) => ({ name: m.name, detail: m.args, line: at(m.line), stub: m.stub, isStatic: m.static, visibility: m.visibility }))
          })
          sym.defines.set(c.name, id)
          sym.owners.push({ id, refs: mapRefs(c.refs), bases: mapRefs(c.baseRefs ?? []), implementsRefs: [] })
        }
        if (r.functions.length) {
          const id = `${r.path}#module`
          nodes.push({
            id,
            kind: 'module',
            name: basename(r.path),
            file: r.path,
            line: 1,
            fields: [],
            methods: r.functions.map((f) => ({ name: f.name, detail: f.args, line: at(f.line), stub: f.stub }))
          })
          for (const f of r.functions) sym.defines.set(f.name, id)
          sym.owners.push({ id, refs: mapRefs(r.functions.flatMap((f) => f.refs)), bases: [], implementsRefs: [] })
        }
        symbols.push(sym)
      }
    }
  }

  // TS/JS imports resolve once every file's symbols exist.
  for (const sym of symbols) {
    if (sym.lang !== 'ts') continue
    for (const imp of tsImportsByFile.get(sym.path) ?? []) {
      const file = resolveTsModule(sym.path, imp.from, fileSet, srcRoots)
      sym.imports.set(imp.local, { file, imported: imp.imported, module: imp.from, line: imp.line })
      const pkg = !file && !imp.from.startsWith('.') ? packageName(imp.from) : null
      if (pkg) libraries.add(pkg)
    }
  }

  const byPath = new Map(symbols.map((s) => [s.path, s]))
  const nodeById = new Map(nodes.map((n) => [n.id, n]))

  /** Resolve a reference made in `sym` to a node, with the reason. Never crosses languages. */
  const resolve = (sym: FileSymbols, ref: Ref): { id: string; note: string } | null => {
    if (ref.qualifier) {
      const imp = sym.imports.get(ref.qualifier)
      if (!imp?.file) return null
      const target = byPath.get(imp.file)
      const id = target?.defines.get(ref.name)
      return id && target!.lang === sym.lang ? { id, note: `${ref.qualifier}.${ref.name} (imported module ${imp.module})` } : null
    }
    const local = sym.defines.get(ref.name)
    if (local) return { id: local, note: `${ref.name}, defined in this file` }
    const imp = sym.imports.get(ref.name)
    if (imp?.file) {
      const target = byPath.get(imp.file)
      if (!target || target.lang !== sym.lang) return null
      const wanted = imp.imported === 'default' || imp.imported === '*' ? ref.name : imp.imported
      const id = target.defines.get(wanted)
      if (id) return { id, note: `${ref.name}, imported from ${imp.module}` }
      return null
    }
    // Java/C#/Kotlin/Swift/C++: same package or namespace needs no import. Same language and folder only.
    if (sym.lang !== 'python' && sym.lang !== 'ts') {
      const folder = dirname(sym.path)
      for (const other of symbols) {
        if (other.lang !== sym.lang || dirname(other.path) !== folder) continue
        const id = other.defines.get(ref.name)
        if (id) return { id, note: `${ref.name}, same package (${folder === '.' ? 'project root' : folder})` }
      }
    }
    return null
  }

  const edges = new Map<string, MapEdge>()
  const addEdge = (from: string, to: string, kind: MapEdge['kind'], ev: EdgeEvidence) => {
    if (from === to) return
    const key = `${from}>${to}>${kind}`
    const e = edges.get(key) ?? { from, to, kind, evidence: [] }
    if (e.evidence.length < MAX_EVIDENCE && !e.evidence.some((x) => x.line === ev.line && x.file === ev.file)) e.evidence.push(ev)
    edges.set(key, e)
  }

  for (const sym of symbols) {
    for (const owner of sym.owners) {
      const node = nodeById.get(owner.id)!
      for (const [refs, kind] of [
        [owner.bases, 'extends'],
        [owner.implementsRefs, 'implements']
      ] as const) {
        for (const b of refs) {
          const hit = resolve(sym, b)
          if (hit) {
            const target = nodeById.get(hit.id)!
            addEdge(owner.id, hit.id, kind === 'extends' && target.kind === 'interface' ? 'implements' : kind, {
              file: sym.path,
              line: b.line,
              note: `${node.name} ${kind} ${hit.note}`
            })
          } else if (!['object', 'ABC', 'Generic', 'Protocol', 'Enum', 'IntEnum', 'StrEnum'].includes(b.name)) {
            node.externalBases = [...new Set([...(node.externalBases ?? []), b.qualifier ? `${b.qualifier}.${b.name}` : b.name])]
          }
        }
      }
      for (const ref of owner.refs) {
        const hit = resolve(sym, ref)
        if (!hit || hit.id === owner.id) continue
        if (edges.has(`${owner.id}>${hit.id}>extends`) || edges.has(`${owner.id}>${hit.id}>implements`)) continue
        addEdge(owner.id, hit.id, 'uses', { file: sym.path, line: ref.line, note: `uses ${hit.note}` })
      }
    }
  }

  // The project's own modules are not libraries.
  const own = new Set(files.flatMap((f) => [basename(f).replace(/\.[^.]+$/, ''), f.split('/')[0]]))
  return {
    nodes,
    edges: [...edges.values()],
    libraries: [...libraries].filter((l) => !own.has(l)).sort(),
    languages: [...languages],
    skipped,
    ...(truncated ? { truncated: `Showing the first ${MAX_FILES} code files.` } : {})
  }
}

/** The code map, as the coach sees it (ports.CodeMapper). */
export const codeMapper: CodeMapper = { build: (p) => buildMap(p) }
