/** The Map tab's class diagram and the Sources tab's links. Uses tests/fixtures (read-only). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import type { ProjectInfo } from '../src/shared/ipc'
import type { ChatItem } from '../src/shared/chat'
import { buildMap } from '../src/main/engines/map/build-map'
import { analyzeCurly } from '../src/main/engines/map/curly-analyzer'
import { stackDocs } from '../src/main/engines/map/docs'
import { findPython } from '../src/main/engines/visualize/runner'
import { linksFromChat } from '../src/renderer/src/features/sources/sources-tab'
import { ancestors, buildTree, relationsOf, visibleNodes } from '../src/renderer/src/features/map/tree'
import { readFile } from 'node:fs/promises'

const FIX = join(import.meta.dirname, 'fixtures')
const hasPython = !!(await findPython())
const proj = (dir: string, files?: string[]): ProjectInfo => ({
  root: join(FIX, dir),
  name: dir,
  stacks: [],
  manifests: [],
  languages: [],
  fileCount: 0,
  git: null,
  ...(files ? { files } : {})
})
const short = (id: string) => id.split('#')[1]

test('Python: classes with fields and methods, unfinished methods flagged, module functions, uses arrows', { skip: !hasPython }, async () => {
  const map = await buildMap(proj('todo-app'))
  const todo = map.nodes.find((n) => n.name === 'TodoList')!
  assert.equal(todo.kind, 'class')
  assert.deepEqual(todo.fields.map((f) => f.name), ['items'])
  assert.equal(todo.methods.find((m) => m.name === 'complete')?.stub, true, 'complete() is unfinished')
  assert.equal(todo.methods.find((m) => m.name === 'remove')?.stub, false)
  assert.equal(todo.methods.find((m) => m.name === 'remove')?.detail, '(self, number)')
  const app = map.nodes.find((n) => n.kind === 'module' && n.file === 'app.py')!
  assert.deepEqual(app.methods.map((m) => m.name), ['show', 'main'])
  assert.ok(map.edges.some((e) => e.from === app.id && short(e.to) === 'TodoList' && e.kind === 'uses'))
  assert.ok(!map.libraries.includes('todos'), "the project's own modules are not libraries")
  assert.ok(map.libraries.includes('unittest'))
})

test('notebooks are mapped by cell; a broken cell is reported, not fatal; lines point at the cell view', { skip: !hasPython }, async () => {
  const map = await buildMap(proj('notebook'))
  const forest = map.nodes.find((n) => n.file === 'forest.ipynb')!
  assert.deepEqual(forest.methods.map((m) => m.name), ['spread'])
  assert.ok(map.skipped.some((s) => s.file === 'unfinished.ipynb'), 'the unfinished cell is reported')
  assert.ok(map.libraries.includes('numpy'))
})

test('Java: interface, abstract class, extends/implements/uses arrows, fields with types, TODO methods', async () => {
  const map = await buildMap(proj('java-shapes'))
  const kind = (name: string) => map.nodes.find((n) => n.name === name)?.kind
  assert.equal(kind('Shape'), 'interface')
  assert.equal(kind('AbstractShape'), 'abstract')
  assert.equal(kind('Circle'), 'class')
  const edges = map.edges.map((e) => `${short(e.from)} ${e.kind} ${short(e.to)}`)
  assert.ok(edges.includes('AbstractShape implements Shape'), JSON.stringify(edges))
  assert.ok(edges.includes('Circle extends AbstractShape'))
  assert.ok(edges.includes('Main uses Circle'))
  const circle = map.nodes.find((n) => n.name === 'Circle')!
  assert.deepEqual(circle.fields.map((f) => `${f.name}:${f.detail}`), ['radius:double'])
  assert.equal(circle.methods.find((m) => m.name === 'area')?.stub, true, 'TODO body is flagged')
})

test('C# and TypeScript shapes are read too', () => {
  const cs = analyzeCurly(`using System;
public interface IRepo { void Save(); }
public class OrderRepo : IRepo {
    private int count;
    public void Save() { throw new NotImplementedException(); }
}`)
  assert.deepEqual(cs.types.map((t) => `${t.kind}:${t.name}`), ['interface:IRepo', 'class:OrderRepo'])
  assert.deepEqual(cs.types[1].implements, ['IRepo'])
  assert.equal(cs.types[1].methods[0].stub, true)
  const ts = analyzeCurly(`import React from 'react'
export class Store extends Base implements Persist {
  items: string[] = [];
  add(x: string): void { this.items.push(x) }
}
export function render(store) { return store }`)
  assert.equal(ts.types[0].extends[0], 'Base')
  assert.deepEqual(ts.types[0].implements, ['Persist'])
  assert.deepEqual(ts.functions.map((f) => f.name), ['render'])
  assert.ok(ts.imports.includes('react'))
})

test('Sources: official docs only for what the project uses', () => {
  const docs = stackDocs(['Python'], ['Python'], ['numpy', 'matplotlib', 'somethingunknown'])
  const titles = docs.map((d) => d.title)
  assert.ok(titles.includes('Python documentation'))
  assert.ok(titles.includes('NumPy user guide'))
  assert.ok(titles.some((t) => t.startsWith('Matplotlib')))
  assert.equal(docs.length, 3, 'unknown libraries are not invented')
  assert.ok(docs.every((d) => d.url.startsWith('https://') && d.official))
})

test('Sources: links the coach gave in the session are collected once each', () => {
  const items: ChatItem[] = [
    { kind: 'assistant', id: 'a', text: '**Read about slicing**\n- See [NumPy indexing](https://numpy.org/doc/stable/user/basics.indexing.html).' },
    { kind: 'card', id: 'c', card: { kind: 'concept', term: 'Zero-based indexing', explanation: 'Lists count from 0.', docTitle: 'Python tutorial: lists', docUrl: 'https://docs.python.org/3/tutorial/introduction.html#lists' } },
    { kind: 'assistant', id: 'b', text: 'Again: https://numpy.org/doc/stable/user/basics.indexing.html, and http://insecure.example' }
  ]
  const links = linksFromChat(items)
  assert.deepEqual(links.map((l) => l.title), ['NumPy indexing', 'Python tutorial: lists'])
  assert.equal(links[0].context, 'Read about slicing')
})

// ── Correctness rules that hold for any project, and the drill-down tree ──

const langOf = (id: string) => (/\.(py|ipynb)#/.test(id) ? 'python' : /\.(tsx?|jsx?|mjs|cjs)#/.test(id) ? 'ts' : 'other')

test('same name in two languages: no arrow ever crosses languages (the "Patent" bug)', { skip: !hasPython }, async () => {
  const map = await buildMap(proj('mixed-app'))
  assert.equal(map.nodes.filter((n) => n.name === 'Patent').length, 2, 'one Python class, one TypeScript interface')
  for (const e of map.edges) assert.equal(langOf(e.from), langOf(e.to), `${e.from} -> ${e.to}`)
})

test('every arrow is backed by evidence: a real line, in the source file, naming the target', { skip: !hasPython }, async () => {
  const map = await buildMap(proj('mixed-app'))
  const byId = new Map(map.nodes.map((n) => [n.id, n]))
  assert.ok(map.edges.length > 0)
  for (const e of map.edges) {
    assert.ok(e.evidence.length > 0, `no evidence for ${e.from} -> ${e.to}`)
    const target = byId.get(e.to)!
    for (const ev of e.evidence) {
      assert.equal(ev.file, byId.get(e.from)!.file, 'evidence is in the file the arrow starts from')
      const text = (await readFile(join(FIX, 'mixed-app', ev.file), 'utf8')).split('\n')[ev.line - 1] ?? ''
      if (target.kind !== 'module') assert.ok(text.includes(target.name), `${ev.file}:${ev.line} "${text.trim()}" should mention ${target.name}`)
    }
  }
})

test('imports resolve: Python absolute + module.attr, TS relative + "@/" alias; outside bases are labels, not arrows', { skip: !hasPython }, async () => {
  const map = await buildMap(proj('mixed-app'))
  const arrow = (fromSuffix: string, toSuffix: string, kind: string) =>
    map.edges.some((e) => e.from.endsWith(fromSuffix) && e.to.endsWith(toSuffix) && e.kind === kind)
  assert.ok(arrow('library.py#module', 'domain.py#Patent', 'uses'), 'from app.domain import Patent')
  assert.ok(arrow('library.py#module', 'domain.py#Article', 'uses'), 'domain.Article via "from app import domain"')
  assert.ok(arrow('App.tsx#module', 'client.ts#module', 'uses'), './api/client relative import')
  assert.ok(arrow('App.tsx#module', 'client.ts#Patent', 'uses'), '@/api/client alias import')
  assert.ok(arrow('client.ts#LibraryPatent', 'client.ts#Patent', 'implements'), 'interface extends interface')
  const pyPatent = map.nodes.find((n) => n.name === 'Patent' && n.file.endsWith('.py'))!
  assert.deepEqual(pyPatent.externalBases, ['BaseModel'])
  assert.ok(map.libraries.includes('pydantic') && map.libraries.includes('react'), map.libraries.join(','))
  assert.ok(!map.libraries.some((l) => l === 'app' || l.includes('api')), 'project modules and aliases are not libraries')
  const lib = map.nodes.find((n) => n.file.endsWith('library.py'))!
  assert.equal(lib.methods.find((m) => m.name === 'unfinished')?.stub, true)
})

test('the tree starts small, folds single folders, and drills down level by level', { skip: !hasPython }, async () => {
  const map = await buildMap(proj('mixed-app'))
  const { root, index } = buildTree(map, 'mixed-app')
  const start = visibleNodes(root, new Set(['root']))
  assert.deepEqual(start.map((n) => n.label), ['mixed-app', 'backend/app', 'frontend/src'], 'two top folders, folded')
  const backend = index.get(start[1].id)!
  assert.ok(backend.stats.types >= 2 && backend.stats.functions >= 3, JSON.stringify(backend.stats))
  assert.equal(backend.stats.todos, 1)
  const second = visibleNodes(root, new Set(['root', backend.id])).map((n) => n.label)
  assert.ok(second.includes('api') && second.includes('domain.py'), second.join(','))
  const patent = [...index.values()].find((n) => n.kind === 'type' && n.label === 'Patent' && n.file?.endsWith('.py'))!
  assert.deepEqual(ancestors(index, patent.id).map((id) => index.get(id)!.label), ['domain.py', 'backend/app', 'mixed-app'])
})

test('relations list who uses an item, with the proving line', { skip: !hasPython }, async () => {
  const map = await buildMap(proj('mixed-app'))
  const tsPatent = map.nodes.find((n) => n.name === 'Patent' && n.file.endsWith('.ts'))!
  const rel = relationsOf(map, tsPatent.id)
  const usedBy = rel.filter((r) => r.direction === 'in').map((r) => `${r.kind}:${r.other.name}`)
  assert.ok(usedBy.includes('implements:LibraryPatent'), usedBy.join(','))
  assert.ok(usedBy.includes('uses:App.tsx'), usedBy.join(','))
  const fromApp = rel.find((r) => r.other.name === 'App.tsx')!
  assert.match(fromApp.evidence[0].note, /imported from @\/api\/client/)
})

test('sources: an idea with no folder gets no stack docs, not an error (regression: "Link your project folder first")', async () => {
  const { projectStackDocs } = await import('../src/main/engines/map/project-docs')
  assert.deepEqual(await projectStackDocs({ root: '', name: 'idea', stacks: [], manifests: [], languages: [], fileCount: 0, git: null }), [])
  assert.deepEqual(await projectStackDocs(null), [])
})
