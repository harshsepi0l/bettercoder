import type { CodeMap, EdgeEvidence, MapEdge, MapNode } from '../../../../shared/map'

/**
 * The Map as a drill-down tree: project → folders → files → classes and
 * functions → members. Only opened levels are shown, like a decision tree,
 * so big projects stay readable. Relationships are listed per item, with the
 * line that proves each one, instead of drawn all at once.
 */

export type TreeKind = 'root' | 'dir' | 'file' | 'type' | 'function' | 'field' | 'method'

export interface TreeStats {
  dirs: number
  files: number
  types: number
  functions: number
  todos: number
}

export interface TreeNode {
  id: string
  kind: TreeKind
  label: string
  /** «interface», «abstract», … for types; the signature for functions and methods. */
  sub?: string
  parent?: string
  children: TreeNode[]
  stats: TreeStats
  /** The map box this item belongs to (types; functions point at their file's module box). */
  mapId?: string
  file?: string
  line?: number
  stub?: boolean
}

const STEREO: Partial<Record<MapNode['kind'], string>> = {
  interface: '«interface»',
  abstract: '«abstract»',
  enum: '«enum»',
  struct: '«struct»',
  type: '«type»'
}

const zero = (): TreeStats => ({ dirs: 0, files: 0, types: 0, functions: 0, todos: 0 })
const addStats = (a: TreeStats, b: TreeStats) => {
  a.dirs += b.dirs
  a.files += b.files
  a.types += b.types
  a.functions += b.functions
  a.todos += b.todos
}

export function buildTree(map: CodeMap, projectName: string): { root: TreeNode; index: Map<string, TreeNode> } {
  const index = new Map<string, TreeNode>()
  const root: TreeNode = { id: 'root', kind: 'root', label: projectName, children: [], stats: zero() }
  index.set(root.id, root)

  const ensureDir = (path: string): TreeNode => {
    if (!path || path === '.') return root
    const id = `dir:${path}`
    const existing = index.get(id)
    if (existing) return existing
    const parent = ensureDir(path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')
    const node: TreeNode = { id, kind: 'dir', label: path.split('/').at(-1)!, parent: parent.id, children: [], stats: zero() }
    parent.children.push(node)
    index.set(id, node)
    return node
  }

  const byFile = new Map<string, MapNode[]>()
  for (const n of map.nodes) byFile.set(n.file, [...(byFile.get(n.file) ?? []), n])

  for (const [file, boxes] of [...byFile.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const dir = ensureDir(file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '')
    const fileNode: TreeNode = { id: `file:${file}`, kind: 'file', label: file.split('/').at(-1)!, parent: dir.id, file, line: 1, children: [], stats: zero() }
    dir.children.push(fileNode)
    index.set(fileNode.id, fileNode)
    for (const box of boxes.sort((a, b) => a.line - b.line)) {
      if (box.kind === 'module') {
        for (const fn of box.methods) {
          const n: TreeNode = {
            id: `fn:${file}#${fn.name}@${fn.line}`,
            kind: 'function',
            label: fn.name,
            sub: fn.detail || '()',
            parent: fileNode.id,
            children: [],
            stats: { ...zero(), functions: 1, todos: fn.stub ? 1 : 0 },
            mapId: box.id,
            file,
            line: fn.line,
            stub: fn.stub
          }
          fileNode.children.push(n)
          index.set(n.id, n)
        }
        continue
      }
      const typeNode: TreeNode = {
        id: `type:${box.id}`,
        kind: 'type',
        label: box.name,
        sub: STEREO[box.kind],
        parent: fileNode.id,
        children: [],
        stats: { ...zero(), types: 1, todos: box.methods.filter((m) => m.stub).length },
        mapId: box.id,
        file,
        line: box.line
      }
      for (const f of box.fields) {
        const n: TreeNode = { id: `${typeNode.id}.f.${f.name}`, kind: 'field', label: f.name, sub: f.detail, parent: typeNode.id, children: [], stats: zero(), mapId: box.id, file, line: f.line }
        typeNode.children.push(n)
        index.set(n.id, n)
      }
      for (const m of box.methods) {
        const n: TreeNode = {
          id: `${typeNode.id}.m.${m.name}@${m.line}`,
          kind: 'method',
          label: m.name,
          sub: m.detail || '()',
          parent: typeNode.id,
          children: [],
          stats: zero(),
          mapId: box.id,
          file,
          line: m.line,
          stub: m.stub
        }
        typeNode.children.push(n)
        index.set(n.id, n)
      }
      fileNode.children.push(typeNode)
      index.set(typeNode.id, typeNode)
    }
  }

  // Roll counts up, and fold folders that only contain one folder ("backend/app").
  const finish = (n: TreeNode): TreeStats => {
    if (n.kind === 'file') {
      n.stats = zero()
      n.stats.files = 1
      for (const c of n.children) addStats(n.stats, c.stats)
      return n.stats
    }
    if (n.kind !== 'dir' && n.kind !== 'root') return n.stats
    while (n.kind === 'dir' && n.children.length === 1 && n.children[0].kind === 'dir') {
      const only = n.children[0]
      index.delete(only.id)
      n.label = `${n.label}/${only.label}`
      n.children = only.children
      for (const c of n.children) c.parent = n.id
    }
    const s = zero()
    for (const c of n.children) {
      addStats(s, finish(c))
      if (c.kind === 'dir') s.dirs++
    }
    n.stats = s
    // Folders first, then files, alphabetically.
    n.children.sort((a, b) => (a.kind === b.kind ? a.label.localeCompare(b.label) : a.kind === 'dir' ? -1 : b.kind === 'dir' ? 1 : 0))
    return s
  }
  finish(root)
  // Re-index folded folders under their surviving ids.
  const reindex = (n: TreeNode) => {
    index.set(n.id, n)
    n.children.forEach(reindex)
  }
  reindex(root)
  return { root, index }
}

/** The visible part of the tree: every opened node's children. */
export function visibleNodes(root: TreeNode, open: Set<string>): TreeNode[] {
  const out: TreeNode[] = []
  const walk = (n: TreeNode) => {
    out.push(n)
    if (open.has(n.id)) n.children.forEach(walk)
  }
  walk(root)
  return out
}

/** Ids of every ancestor of a node, so it can be revealed. */
export function ancestors(index: Map<string, TreeNode>, id: string): string[] {
  const out: string[] = []
  let n = index.get(id)
  while (n?.parent) {
    out.push(n.parent)
    n = index.get(n.parent)
  }
  return out
}

export interface Relation {
  kind: MapEdge['kind']
  direction: 'out' | 'in'
  other: MapNode
  evidence: EdgeEvidence[]
}

/** What a map box extends, implements, uses, and what uses it, with the lines that prove it. */
export function relationsOf(map: CodeMap, mapId: string): Relation[] {
  const byId = new Map(map.nodes.map((n) => [n.id, n]))
  const out: Relation[] = []
  for (const e of map.edges) {
    if (e.from === mapId && byId.has(e.to)) out.push({ kind: e.kind, direction: 'out', other: byId.get(e.to)!, evidence: e.evidence })
    else if (e.to === mapId && byId.has(e.from)) out.push({ kind: e.kind, direction: 'in', other: byId.get(e.from)!, evidence: e.evidence })
  }
  const order = { extends: 0, implements: 1, uses: 2 }
  return out.sort((a, b) => order[a.kind] - order[b.kind] || a.direction.localeCompare(b.direction) || a.other.name.localeCompare(b.other.name))
}

/** The tree id that shows a map box: its type node, or its file for a module of functions. */
export function treeIdFor(node: MapNode): string {
  return node.kind === 'module' ? `file:${node.file}` : `type:${node.id}`
}
