import { useEffect, useState } from 'react'
import { ArrowLeftRight, Check, Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { EditorSource, EditorSourceId, ImportPlan, ImportResult } from '../../../../shared/editor-import'

/** The built-in VS Code is on, and the editors found on this computer (null while loading). */
export function useEditorSources(): { enabled: boolean; sources: EditorSource[] } | null {
  const [state, setState] = useState<{ enabled: boolean; sources: EditorSource[] } | null>(null)
  useEffect(() => {
    void window.editorImport
      .sources()
      .then(setState)
      .catch(() => setState({ enabled: false, sources: [] }))
  }, [])
  return state
}

const short = (id: string) => id.split('.').slice(1).join('.')

/** Rows with the same reason become one row: "csdevkit, csharp — the open C# extension instead". */
function byReason(items: Array<{ id: string; why: string }>): Array<{ label: string; why: string }> {
  const groups = new Map<string, string[]>()
  for (const i of items) groups.set(i.why, [...(groups.get(i.why) ?? []), short(i.id)])
  return [...groups].map(([why, ids]) => ({ label: ids.length > 3 ? `${ids.length} extensions` : ids.join(', '), why: ids.length > 3 ? `${why}: ${ids.join(', ')}` : why }))
}

/**
 * "Bring your VS Code": pick the editor to copy from, see what comes over (and what doesn't, and why), bring it over.
 * In onboarding and in Settings › Editor. AI extensions and AI settings are always left out.
 */
export function EditorImport({ sources, onDone }: { sources: EditorSource[]; onDone?: (result: ImportResult | null) => void }) {
  const [picked, setPicked] = useState<EditorSourceId | 'fresh'>(sources[0]?.id ?? 'fresh')
  const [plan, setPlan] = useState<ImportPlan | null>(null)
  const [loading, setLoading] = useState(false)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setPlan(null)
    setResult(null)
    setError(null)
    if (picked === 'fresh') return
    let live = true
    setLoading(true)
    void window.editorImport
      .plan(picked)
      .then((p) => live && setPlan(p))
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => live && setLoading(false))
    return () => {
      live = false
    }
  }, [picked])

  async function bring() {
    if (picked === 'fresh') return onDone?.(null)
    setRunning(true)
    setError(null)
    try {
      const r = await window.editorImport.run(picked)
      setResult(r)
      onDone?.(r)
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, '') : String(e))
    } finally {
      setRunning(false)
    }
  }

  const ext = plan?.extensions ?? []
  const installs = ext.filter((f) => f.kind === 'install')
  const swaps = ext.filter((f) => f.kind === 'swap')
  const blocked = ext.filter((f) => f.kind === 'blocked')
  const missing = ext.filter((f) => f.kind === 'missing')
  const look = plan ? [plan.look.theme, plan.look.font && `${plan.look.font}${plan.look.fontSize ? ` ${plan.look.fontSize}` : ''}`, plan.look.tabSize && `tab ${plan.look.tabSize}`].filter(Boolean).join(' · ') : ''

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Bring settings from">
        {[...sources.map((s) => ({ id: s.id as EditorSourceId | 'fresh', name: s.name, sub: `found · ${s.extensions} extensions` })), { id: 'fresh' as const, name: 'Start fresh', sub: 'our defaults' }].map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={picked === o.id}
            disabled={running}
            onClick={() => setPicked(o.id)}
            className={cn(
              'flex min-w-40 flex-1 items-center gap-2.5 rounded-lg border px-3.5 py-2.5 text-left text-[13px]',
              picked === o.id ? 'border-brand-line bg-brand-tint text-heading' : 'bg-card hover:bg-accent'
            )}
          >
            <span className={cn('size-3.5 flex-none rounded-full border', picked === o.id ? 'border-[4px] border-brand-line' : 'border-muted-foreground')} />
            <span className="flex flex-col">
              <span>{o.name}</span>
              <span className="text-[11px] text-muted-foreground">{o.sub}</span>
            </span>
          </button>
        ))}
      </div>

      {picked !== 'fresh' && (
        <div className="overflow-hidden rounded-lg border bg-chrome text-[13px]">
          {loading && (
            <div className="flex items-center gap-2 px-3.5 py-3 text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Checking what can come over…
            </div>
          )}
          {plan && (
            <>
              <Head>COMES WITH YOU</Head>
              {look && <Row icon="ok" label="Theme, font, tab size" detail={look} />}
              <Row icon="ok" label="Settings, shortcuts, snippets" detail={`${plan.settings.kept} settings · ${plan.keybindings} shortcuts · ${plan.snippets} snippet files`} />
              {installs.length > 0 && <Row icon="ok" label="Extensions" detail={installs.slice(0, 5).map((f) => short(f.id)).join(' · ') + (installs.length > 5 ? ` +${installs.length - 5}` : '')} mono />}
              {byReason(swaps.flatMap((f) => (f.kind === 'swap' ? [{ id: f.id, why: f.why.replace(/^.*?; /, '') }] : []))).map((g) => (
                <Row key={g.why} icon="swap" label={g.label} detail={g.why} />
              ))}
              {(blocked.length > 0 || missing.length > 0 || plan.settings.dropped.length > 0) && <Head tone="out">LEFT OUT</Head>}
              {blocked.length > 0 && <Row icon="no" label={blocked.map((f) => short(f.id)).join(', ')} detail="They write code for you. Here, you write it." />}
              {plan.settings.dropped.length > 0 && <Row icon="no" label={`${plan.settings.dropped.length} settings`} detail="AI, keys and things BetterCoder sets itself" />}
              {byReason(missing.flatMap((f) => (f.kind === 'missing' ? [{ id: f.id, why: f.why }] : []))).map((g) => (
                <Row key={g.why} icon="no" label={g.label} detail={g.why} />
              ))}
            </>
          )}
        </div>
      )}

      {error && <p className="text-[12px] text-status-missing">{error}</p>}
      {result && (
        <p className="text-[12px] text-status-done">
          Done. {result.installed.length} extensions in{result.failed.length ? `; ${result.failed.length} couldn't install (${result.failed.map(short).join(', ')})` : ''}.
        </p>
      )}

      <div className="flex items-center gap-3">
        <span className="flex-1 text-[12px] text-muted-foreground">AI extensions stay off. You can do this again in Settings › Editor.</span>
        {picked !== 'fresh' && (
          <Button disabled={running || loading || !plan} onClick={bring}>
            {running ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Bringing it over…
              </>
            ) : result ? (
              'Bring it over again'
            ) : (
              'Bring it over'
            )}
          </Button>
        )}
      </div>
    </div>
  )
}

function Head({ children, tone }: { children: React.ReactNode; tone?: 'out' }) {
  return <div className={cn('border-t px-3.5 py-2 font-mono text-[10.5px] tracking-[0.06em] first:border-t-0', tone === 'out' ? 'text-status-missing' : 'text-muted-foreground')}>{children}</div>
}

function Row({ icon, label, detail, mono }: { icon: 'ok' | 'swap' | 'no'; label: string; detail: string; mono?: boolean }) {
  return (
    <div className="flex items-center gap-3 border-t px-3.5 py-2">
      {icon === 'ok' && <Check className="size-4 flex-none text-status-done" aria-label="Comes over" />}
      {icon === 'swap' && <ArrowLeftRight className="size-4 flex-none text-status-progress" aria-label="Swapped" />}
      {icon === 'no' && <X className="size-4 flex-none text-status-missing" aria-label="Left out" />}
      <span className="max-w-[45%] flex-none truncate text-heading" title={label}>
        {label}
      </span>
      <span className={cn('ml-auto min-w-0 flex-1 truncate text-right text-[12px] text-muted-foreground', mono && 'font-mono')} title={detail}>
        {detail}
      </span>
    </div>
  )
}
