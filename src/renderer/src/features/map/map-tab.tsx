import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import dagre from '@dagrejs/dagre'
import {
  Box,
  ChevronRight,
  Clapperboard,
  FileCode2,
  Folder,
  FolderOpen,
  FunctionSquare,
  Loader2,
  Map as MapIcon,
  MessageSquare,
  RefreshCw,
  Search,
  Variable,
  X,
  Code
} from 'lucide-react'
import type { CoachIntent } from '../../../../shared/harness'
import type { ProjectInfo } from '../../../../shared/ipc'
import type { CodeMap } from '../../../../shared/map'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { EmptyState } from '@/features/shell/empty-state'
import { ancestors, buildTree, relationsOf, treeIdFor, visibleNodes, type Relation, type TreeNode } from './tree'

/** Cached per project, so switching tabs doesn't re-read the code. */
const cache = new Map<string, CodeMap>()

const W = 236
const H = 58
const LEAF_H = 36

type CardData = { node: TreeNode; open: boolean; selected: boolean }

function statLine(n: TreeNode): string {
  const s = n.stats
  const parts = [
    s.dirs ? `${s.dirs} folder${s.dirs === 1 ? '' : 's'}` : '',
    n.kind === 'root' || n.kind === 'dir' ? `${s.files} file${s.files === 1 ? '' : 's'}` : '',
    s.types ? `${s.types} type${s.types === 1 ? '' : 's'}` : '',
    s.functions ? `${s.functions} function${s.functions === 1 ? '' : 's'}` : ''
  ].filter(Boolean)
  if (n.kind === 'type') {
    const fields = n.children.filter((c) => c.kind === 'field').length
    const methods = n.children.filter((c) => c.kind === 'method').length
    return `${fields} field${fields === 1 ? '' : 's'} · ${methods} method${methods === 1 ? '' : 's'}`
  }
  return parts.join(' · ')
}

const ICON = {
  root: FolderOpen,
  dir: Folder,
  file: FileCode2,
  type: Box,
  function: FunctionSquare,
  field: Variable,
  method: FunctionSquare
} as const

const isLeaf = (n: TreeNode) => n.kind === 'field' || n.kind === 'method' || n.kind === 'function'

/** One box in the tree. Click to open or close its level. */
const Card = memo(function Card({ data }: NodeProps<Node<CardData>>) {
  const { node, open, selected } = data
  const Icon = ICON[node.kind]
  const leaf = isLeaf(node)
  return (
    <div
      className={cn(
        'flex cursor-pointer items-center gap-2 rounded-md border px-2.5 transition-colors',
        selected ? 'border-brand-line ring-2 ring-brand-line/40' : 'border-border hover:border-brand-line/60',
        node.kind === 'type' ? 'bg-brand-tint' : leaf ? 'bg-muted' : 'bg-card'
      )}
      style={{ width: W, height: leaf ? LEAF_H : H }}
    >
      <Handle type="target" position={Position.Left} className="!h-1 !w-1 !border-0 !bg-transparent" />
      <Handle type="source" position={Position.Right} className="!h-1 !w-1 !border-0 !bg-transparent" />
      <Icon className={cn('size-4 shrink-0', node.kind === 'type' ? 'text-brand-text' : 'text-muted-foreground')} aria-hidden="true" />
      <div className="flex min-w-0 flex-1 flex-col">
        {node.kind === 'type' && node.sub && <span className="font-mono text-[9px] leading-tight text-brand-text">{node.sub}</span>}
        <span className={cn('truncate text-[12.5px] font-medium text-heading', leaf && 'font-mono text-[11.5px] font-normal')}>
          {node.label}
          {leaf && <span className="text-muted-foreground">{node.kind === 'field' ? (node.sub ? `: ${node.sub}` : '') : node.sub}</span>}
        </span>
        {!leaf && <span className="truncate text-[10.5px] text-muted-foreground">{statLine(node)}</span>}
      </div>
      {(node.stub || (node.kind !== 'type' && node.stats.todos > 0) || (node.kind === 'type' && node.stats.todos > 0)) && (
        <span className="shrink-0 font-mono text-[9px] text-status-progress">{node.stub ? 'TODO' : `${node.stats.todos} TODO`}</span>
      )}
      {node.children.length > 0 && (
        <ChevronRight className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} aria-hidden="true" />
      )}
    </div>
  )
})
const nodeTypes = { card: Card }

function layout(nodes: TreeNode[], open: Set<string>, selected: string | null) {
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'LR', nodesep: 10, ranksep: 48, marginx: 16, marginy: 16 })
  g.setDefaultEdgeLabel(() => ({}))
  for (const n of nodes) g.setNode(n.id, { width: W, height: isLeaf(n) ? LEAF_H : H })
  const visible = new Set(nodes.map((n) => n.id))
  for (const n of nodes) if (n.parent && visible.has(n.parent)) g.setEdge(n.parent, n.id)
  dagre.layout(g)
  const flowNodes: Node<CardData>[] = nodes.map((n) => {
    const p = g.node(n.id)
    const h = isLeaf(n) ? LEAF_H : H
    return { id: n.id, type: 'card', position: { x: p.x - W / 2, y: p.y - h / 2 }, data: { node: n, open: open.has(n.id), selected: n.id === selected } }
  })
  const edges: Edge[] = nodes
    .filter((n) => n.parent && visible.has(n.parent))
    .map((n) => ({ id: `${n.parent}>${n.id}`, source: n.parent!, target: n.id, type: 'smoothstep', style: { stroke: '#5c5c5c', strokeWidth: 1 } }))
  return { nodes: flowNodes, edges }
}

const RELATION_TITLE: Record<string, string> = {
  'extends-out': 'Extends',
  'implements-out': 'Implements',
  'uses-out': 'Uses',
  'extends-in': 'Extended by',
  'implements-in': 'Implemented by',
  'uses-in': 'Used by'
}

function Relations({ relations, onShow }: { relations: Relation[]; onShow: (r: Relation) => void }) {
  const groups = new Map<string, Relation[]>()
  for (const r of relations) {
    const key = `${r.kind}-${r.direction}`
    groups.set(key, [...(groups.get(key) ?? []), r])
  }
  if (relations.length === 0) return <p className="text-[12px] text-muted-foreground">No links to other parts of the project.</p>
  return (
    <div className="flex flex-col gap-3">
      {[...groups.entries()].map(([key, list]) => (
        <section key={key} className="flex flex-col gap-1">
          <span className="font-mono text-[10px] tracking-[0.06em] text-muted-foreground">
            {RELATION_TITLE[key].toUpperCase()} · {list.length}
          </span>
          {list.map((r) => (
            <details key={`${key}-${r.other.id}`} className="group rounded border bg-muted/40">
              <summary className="flex cursor-pointer list-none items-center gap-1.5 px-2 py-1.5 text-[12px]">
                <ChevronRight className="size-3 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden="true" />
                <span className="truncate font-mono text-heading">{r.other.kind === 'module' ? r.other.name : r.other.name}</span>
                <span className="truncate text-[10.5px] text-muted-foreground">{r.other.file}</span>
                <Button
                  variant="ghost"
                  size="xs"
                  className="ml-auto h-5 px-1.5 text-[10.5px]"
                  onClick={(e) => {
                    e.preventDefault()
                    onShow(r)
                  }}
                >
                  Show
                </Button>
              </summary>
              <ul className="m-0 list-none border-t px-2 py-1.5">
                {r.evidence.map((ev) => (
                  <li key={`${ev.file}:${ev.line}`} className="py-0.5 text-[11px]">
                    <span className="font-mono text-brand-text">
                      {ev.file}:{ev.line}
                    </span>{' '}
                    <span className="text-muted-foreground">{ev.note}</span>
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </section>
      ))}
    </div>
  )
}

function Explorer({ map, project, onAsk, onRefresh, loading }: { map: CodeMap; project: ProjectInfo; onAsk: (text: string, intent?: CoachIntent) => void; onRefresh: () => void; loading: boolean }) {
  const { root, index } = useMemo(() => buildTree(map, project.name), [map, project.name])
  const [open, setOpen] = useState<Set<string>>(() => new Set(['root']))
  const [selected, setSelected] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const flow = useReactFlow()

  const visible = useMemo(() => visibleNodes(root, open), [root, open])
  const graph = useMemo(() => layout(visible, open, selected), [visible, open, selected])
  const picked = selected ? (index.get(selected) ?? null) : null
  const panelOpen = !!picked && picked.kind !== 'root'

  /** What to keep in view: the box just opened (with its children) or revealed; null = the whole tree. */
  const [focus, setFocus] = useState<string | null>(null)

  // Drilling down centres on the opened box and its children at a readable size, not the whole tree.
  useEffect(() => {
    const t = setTimeout(() => {
      const f = focus ? index.get(focus) : null
      if (f) {
        const ids = [f.id, ...(open.has(f.id) ? f.children.map((c) => c.id) : []), ...(f.parent ? [f.parent] : [])]
        void flow.fitView({ nodes: ids.map((id) => ({ id })), padding: 0.25, duration: 250, minZoom: 0.75, maxZoom: 1.1 })
      } else void flow.fitView({ padding: 0.15, duration: 250, maxZoom: 1.1 })
    }, 40)
    return () => clearTimeout(t)
  }, [visible.length, flow, panelOpen, focus, index, open])

  const reveal = useCallback(
    (id: string) => {
      setOpen((o) => new Set([...o, ...ancestors(index, id)]))
      setSelected(id)
      setFocus(id)
    },
    [index]
  )

  const toggle = (id: string) => {
    const n = index.get(id)
    setSelected(id)
    setFocus(id)
    if (!n || n.children.length === 0) return
    setOpen((o) => {
      const next = new Set(o)
      if (next.has(id)) {
        // Closing a level closes everything under it.
        for (const k of [...next]) if (k === id || ancestors(index, k).includes(id)) next.delete(k)
      } else next.add(id)
      return next
    })
  }

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q.length < 2) return []
    return [...index.values()].filter((n) => n.kind !== 'root' && n.label.toLowerCase().includes(q)).slice(0, 12)
  }, [query, index])

  const crumbs = picked ? [...ancestors(index, picked.id)].reverse().map((id) => index.get(id)!).concat(picked) : [root]
  const mapNode = picked?.mapId ? map.nodes.find((n) => n.id === picked.mapId) : undefined
  const relations = mapNode ? relationsOf(map, mapNode.id) : []
  const python = picked?.file && /\.(py|ipynb)$/i.test(picked.file)
  const what = picked
    ? picked.kind === 'type'
      ? `the ${picked.sub?.replace(/[«»]/g, '') || 'class'} ${picked.label}`
      : picked.kind === 'file'
        ? picked.file
        : picked.kind === 'dir' || picked.kind === 'root'
          ? `the ${picked.label} folder`
          : `${picked.label}${picked.kind === 'field' ? '' : '()'}`
    : ''

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-divider px-3.5 py-2">
        <nav aria-label="Path" className="flex min-w-0 flex-1 flex-wrap items-center gap-0.5 text-[12px]">
          {crumbs.map((c, i) => (
            <span key={c.id} className="flex items-center gap-0.5">
              {i > 0 && <ChevronRight className="size-3 text-muted-foreground" aria-hidden="true" />}
              <button type="button" onClick={() => reveal(c.id)} className={cn('rounded px-1 py-0.5 hover:bg-accent/50', i === crumbs.length - 1 ? 'text-heading' : 'text-muted-foreground')}>
                {c.label}
              </button>
            </span>
          ))}
        </nav>
        <div className="relative w-56">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a class, function, file…" className="h-7 bg-muted pl-7 text-[12px]" aria-label="Find in map" />
          {matches.length > 0 && (
            <div className="absolute top-8 right-0 z-10 flex w-72 flex-col rounded-md border bg-popover py-1 shadow-lg">
              {matches.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className="flex items-center gap-2 px-2.5 py-1.5 text-left text-[12px] hover:bg-accent/50"
                  onClick={() => {
                    reveal(m.id)
                    setQuery('')
                  }}
                >
                  <span className="truncate font-mono text-heading">{m.label}</span>
                  <span className="ml-auto truncate text-[10.5px] text-muted-foreground">{m.file ?? m.kind}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <Button variant="ghost" size="xs" onClick={() => void flow.fitView({ padding: 0.15, duration: 250, maxZoom: 1.1 })}>
          Fit all
        </Button>
        <Button
          variant="ghost"
          size="xs"
          onClick={() => {
            setOpen(new Set(['root']))
            setFocus(null)
          }}
        >
          Collapse all
        </Button>
        <Button variant="ghost" size="xs" onClick={onRefresh} disabled={loading}>
          <RefreshCw className={cn(loading && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
        <ReactFlow
          nodes={graph.nodes}
          edges={graph.edges}
          nodeTypes={nodeTypes}
          colorMode="dark"
          minZoom={0.15}
          nodesDraggable={false}
          nodesConnectable={false}
          onNodeClick={(_, n) => toggle(n.id)}
          onPaneClick={() => setSelected(null)}
          proOptions={{ hideAttribution: true }}
          style={{ background: 'var(--background)' }}
        >
          <Background gap={20} size={1} color="#3b3b3b" />
          <Controls showInteractive={false} />
        </ReactFlow>
        </div>

        {picked && picked.kind !== 'root' && (
          <aside className="flex w-80 shrink-0 flex-col gap-3 overflow-y-auto border-l border-divider bg-card p-3.5">
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 flex-col gap-1">
                <Badge variant="outline" className="self-start border-brand-line/60 text-brand-text">
                  {picked.sub && picked.kind === 'type' ? picked.sub.replace(/[«»]/g, '') : picked.kind === 'type' ? 'class' : picked.kind === 'dir' ? 'folder' : picked.kind}
                </Badge>
                <span className="truncate text-[15px] font-semibold text-heading">{picked.label}</span>
                {picked.file && (
                  <span className="truncate font-mono text-[11px] text-muted-foreground">
                    {picked.file}:{picked.line ?? 1}
                  </span>
                )}
                {!isLeaf(picked) && <span className="text-[11px] text-muted-foreground">{statLine(picked)}</span>}
                {mapNode?.externalBases && (
                  <span className="text-[11px] text-muted-foreground">
                    extends <span className="font-mono">{mapNode.externalBases.join(', ')}</span> (outside your project)
                  </span>
                )}
                {picked.stub && <span className="text-[11px] text-status-progress">Unfinished: the body is empty or marked TODO.</span>}
              </div>
              <Button variant="ghost" size="icon-xs" aria-label="Close" onClick={() => setSelected(null)}>
                <X />
              </Button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" onClick={() => onAsk(`Explain ${what}${picked.file && picked.kind !== 'file' ? ` in ${picked.file}` : ''}.`)}>
                <MessageSquare />
                Explain this
              </Button>
              {picked.file && picked.kind !== 'dir' && (
                <Button variant="outline" size="sm" onClick={() => void window.ide.openInEditor(picked.file!, picked.line ?? 1)}>
                  <Code />
                  Open in editor
                </Button>
              )}
              {python && picked.kind !== 'dir' && (
                <Button variant="outline" size="sm" onClick={() => onAsk(`Animate ${picked.kind === 'file' ? `all of ${picked.file}` : `${picked.label} in ${picked.file}`}`, 'visualize')}>
                  <Clapperboard />
                  Animate
                </Button>
              )}
            </div>
            {mapNode && (
              <section className="flex flex-col gap-2">
                <span className="text-[12px] font-medium text-heading">
                  How it connects{mapNode.kind === 'module' ? ` (${mapNode.name}'s functions)` : ''}
                </span>
                <Relations relations={relations} onShow={(r) => reveal(treeIdFor(r.other))} />
              </section>
            )}
          </aside>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 border-t border-divider px-3.5 py-1.5 text-[11px] text-muted-foreground">
        <span>Click a box to open it. Click again to close.</span>
        <span>Every link is backed by a line of code; open one under "How it connects" to see it.</span>
        {(map.skipped.length > 0 || map.truncated) && (
          <span className="ml-auto" title={map.skipped.map((s) => `${s.file}: ${s.reason}`).join('\n')}>
            {map.truncated ?? ''} {map.skipped.length > 0 ? `${map.skipped.length} file(s) partly skipped` : ''}
          </span>
        )}
      </div>
    </div>
  )
}

/** The project as a drill-down tree: folders → files → classes and functions → members. */
export function MapTab({ project, onAsk }: { project: ProjectInfo | null; onAsk: (text: string, intent?: CoachIntent) => void }) {
  const key = project ? `${project.root}|${project.files?.join(',') ?? ''}` : ''
  const [map, setMap] = useState<CodeMap | null>(() => cache.get(key) ?? null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    async (force: boolean) => {
      if (!project) return
      if (!force && cache.has(key)) {
        setMap(cache.get(key)!)
        return
      }
      setLoading(true)
      setError(null)
      try {
        const m = await window.codeMap.build()
        cache.set(key, m)
        setMap(m)
      } catch (e) {
        setError((e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
      } finally {
        setLoading(false)
      }
    },
    [project, key]
  )

  useEffect(() => {
    setMap(cache.get(key) ?? null)
    void load(false)
  }, [key, load])

  if (!project) {
    return (
      <EmptyState icon={MapIcon} title="Project map">
        Open a folder or files to explore its folders, files, classes and functions.
      </EmptyState>
    )
  }
  if (!map) {
    return (
      <EmptyState icon={MapIcon} title={loading ? 'Reading your code…' : 'Project map'}>
        {loading ? <Loader2 className="mx-auto size-4 animate-spin" aria-label="Loading" /> : (error ?? 'Nothing to show yet.')}
      </EmptyState>
    )
  }
  if (map.nodes.length === 0) {
    return (
      <EmptyState icon={MapIcon} title="No classes or functions found">
        The map reads Python, notebooks, TypeScript/JavaScript, Java, C#, Kotlin, Swift and C++.
      </EmptyState>
    )
  }
  return (
    <ReactFlowProvider>
      <Explorer key={key} map={map} project={project} onAsk={onAsk} onRefresh={() => void load(true)} loading={loading} />
    </ReactFlowProvider>
  )
}
