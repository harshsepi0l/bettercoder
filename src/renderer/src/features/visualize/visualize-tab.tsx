import { useEffect, useMemo, useState } from 'react'
import { Clapperboard, Lightbulb, Loader2, Play, Plus, X } from 'lucide-react'
import { animationsFromChat, type ChatItem } from '../../../../shared/chat'
import type { ProjectInfo } from '../../../../shared/ipc'
import type { ScenarioCall, Trace } from '../../../../shared/trace'
import type { PythonOutline } from '../../../../shared/visualize'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { EmptyState } from '@/features/shell/empty-state'
import { cn } from '@/lib/utils'
import { TracePlayer } from './player'

interface Row {
  call: string
  args: string
  assign: string
}

function message(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  return raw.replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, '')
}

/** Turn "\"buy milk\", 2" into ["buy milk", 2]. Bare words become text. */
function parseArgs(text: string): unknown[] {
  const t = text.trim()
  if (!t) return []
  try {
    return JSON.parse(`[${t}]`) as unknown[]
  } catch {
    return t.split(',').map((part) => {
      const p = part.trim()
      try {
        return JSON.parse(p)
      } catch {
        return p
      }
    })
  }
}

/**
 * Every animation the coach showed in this session (pick one to replay it full size), then: pick a Python file,
 * describe calls to run, and watch your code execute step by step.
 */
export function VisualizeTab({ project, items = [] }: { project: ProjectInfo | null; items?: ChatItem[] }) {
  const shown = useMemo(() => animationsFromChat(items), [items])
  const session = shown.length > 0 && <SessionAnimations animations={shown} />
  // With no folder, the session's animations are the whole tab (the "open a folder" note only shows when there are none).
  const ownCode = project?.root || !session ? <OwnCode project={project} /> : null
  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-3.5">
        {session}
        {ownCode}
      </div>
    </ScrollArea>
  )
}

/** The coach's animations from this session: a row to pick from, and the picked one full size (newest first). */
function SessionAnimations({ animations }: { animations: ReturnType<typeof animationsFromChat> }) {
  const [picked, setPicked] = useState(animations.at(-1)!.id)
  const current = animations.find((a) => a.id === picked) ?? animations.at(-1)!
  return (
    <section className="flex flex-col gap-3 rounded-lg border bg-card p-3.5">
      <div className="font-mono text-[10px] tracking-[0.06em] text-muted-foreground">FROM THIS SESSION · {animations.length}</div>
      <div className="flex flex-wrap gap-1.5">
        {[...animations].reverse().map((a) => (
          <button
            key={a.id}
            type="button"
            aria-pressed={a.id === current.id}
            onClick={() => setPicked(a.id)}
            className={cn(
              'rounded-full border px-2.5 py-0.5 text-[12px]',
              a.id === current.id ? 'border-brand-line bg-brand-tint text-heading' : 'text-muted-foreground hover:bg-accent/50'
            )}
          >
            {a.card.title}
          </button>
        ))}
      </div>
      <p className="flex items-start gap-2 text-[13px]">
        <Lightbulb className="mt-0.5 size-3.5 shrink-0 text-brand-text" aria-hidden="true" />
        {current.card.note}
      </p>
      <TracePlayer key={current.id} trace={current.card.trace} />
    </section>
  )
}

/** Run the learner's own Python: pick a file, describe calls, animate. */
function OwnCode({ project }: { project: ProjectInfo | null }) {
  const [files, setFiles] = useState<string[]>([])
  const [file, setFile] = useState<string | undefined>()
  const [outline, setOutline] = useState<PythonOutline | null>(null)
  const [rows, setRows] = useState<Row[]>([{ call: '', args: '', assign: '' }])
  const [trace, setTrace] = useState<Trace | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setFiles([])
    setFile(undefined)
    setTrace(null)
    // An idea has no folder: asking for its files would only error.
    if (!project?.root) return
    void window.visualize.files().then((fs) => {
      setFiles(fs)
      setFile(fs[0])
    })
  }, [project?.root, project?.files?.join('|')])

  useEffect(() => {
    setOutline(null)
    if (!file) return
    void window.visualize.outline(file).then((o) => {
      setOutline(o)
      // Start with a sensible first row: create the first class, or call the first function.
      // Notebooks and scripts usually run top to bottom: start with no calls. A file of classes starts with one.
      const cls = o.classes[0]
      setRows(cls && !file.toLowerCase().endsWith('.ipynb') ? [{ call: cls.name, args: '', assign: cls.name.charAt(0).toLowerCase() + cls.name.slice(1) }] : [])
    })
  }, [file])

  if (!project?.root) {
    return (
      <EmptyState icon={Clapperboard} title="Visualize">
        Open a folder or files, then watch your own Python run line by line.
      </EmptyState>
    )
  }
  if (files.length === 0) {
    return (
      <EmptyState icon={Clapperboard} title="No Python files here">
        The animator runs Python files and notebooks for now. Open a project with .py or .ipynb files.
      </EmptyState>
    )
  }

  // Suggestions: functions, classes, and methods on names assigned in earlier rows.
  const suggestions = outline
    ? [
        ...outline.functions,
        ...outline.classes.map((c) => c.name),
        ...rows.flatMap((r) => {
          const cls = outline.classes.find((c) => c.name === r.call)
          return cls && r.assign ? cls.methods.filter((m) => !m.startsWith('_')).map((m) => `${r.assign}.${m}`) : []
        })
      ]
    : []

  async function run() {
    if (!file) return
    setRunning(true)
    setError(null)
    try {
      const scenario: ScenarioCall[] = rows
        .filter((r) => r.call.trim())
        .map((r) => ({ call: r.call.trim(), args: parseArgs(r.args), ...(r.assign.trim() ? { assign: r.assign.trim() } : {}) }))
      setTrace(await window.visualize.run(file, scenario))
    } catch (e) {
      setError(message(e))
      setTrace(null)
    } finally {
      setRunning(false)
    }
  }

  const update = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)))

  return (
    <>
      <section className="flex flex-col gap-3 rounded-lg border bg-card p-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[10px] tracking-[0.06em] text-muted-foreground">FILE</span>
          <Select value={file} onValueChange={setFile}>
            <SelectTrigger size="sm" className="min-w-48 bg-muted font-mono text-[12px]" aria-label="Python file">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {files.map((f) => (
                <SelectItem key={f} value={f} className="font-mono text-[12px]">
                  {f}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="ml-auto text-[11px] text-muted-foreground">Runs a copy of your code, sandboxed. Your files are not changed.</span>
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="grid grid-cols-[1.4fr_1.4fr_1fr_28px] gap-1.5 font-mono text-[10px] tracking-[0.06em] text-muted-foreground">
            <span>CALL</span>
            <span>WITH</span>
            <span>KEEP AS</span>
            <span />
          </div>
          {rows.length === 0 && (
            <p className="text-[12px] text-muted-foreground">No calls: the whole file runs top to bottom. Add calls to run specific functions instead.</p>
          )}
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-[1.4fr_1.4fr_1fr_28px] gap-1.5">
              <Input
                aria-label={`Call ${i + 1}`}
                list="viz-suggestions"
                value={r.call}
                onChange={(e) => update(i, { call: e.target.value })}
                placeholder="TodoList or todos.add"
                className="h-8 bg-muted font-mono text-[12px]"
              />
              <Input
                aria-label={`Values for call ${i + 1}`}
                value={r.args}
                onChange={(e) => update(i, { args: e.target.value })}
                placeholder='"buy milk", 2'
                className="h-8 bg-muted font-mono text-[12px]"
              />
              <Input
                aria-label={`Keep result of call ${i + 1} as`}
                value={r.assign}
                onChange={(e) => update(i, { assign: e.target.value })}
                placeholder="optional"
                className="h-8 bg-muted font-mono text-[12px]"
              />
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove call ${i + 1}`}
                disabled={rows.length === 0}
                onClick={() => setRows((rs) => rs.filter((_, k) => k !== i))}
              >
                <X />
              </Button>
            </div>
          ))}
          <datalist id="viz-suggestions">
            {suggestions.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setRows((rs) => [...rs, { call: '', args: '', assign: '' }])} disabled={rows.length >= 12}>
            <Plus />
            Add call
          </Button>
          <Button size="sm" onClick={run} disabled={running} className="ml-auto">
            {running ? <Loader2 className="animate-spin" /> : <Play />}
            {rows.some((r) => r.call.trim()) ? 'Run calls and animate' : 'Run whole file and animate'}
          </Button>
        </div>
        {error && <p className="text-[12.5px] text-status-missing">{error}</p>}
      </section>

      {trace && (
        <section className="rounded-lg border bg-card p-3.5">
          <TracePlayer key={JSON.stringify(trace.scenario) + trace.steps.length} trace={trace} />
        </section>
      )}
    </>
  )
}
