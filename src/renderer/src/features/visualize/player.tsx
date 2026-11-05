import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { AlertTriangle, ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react'
import type { Trace, TraceStep } from '../../../../shared/trace'
import { changedNames, localsWithPending, visibleSteps } from '../../../../shared/example-steps'
import { Button } from '@/components/ui/button'
import { useCodeView } from '@/features/coach/code-view'
import { revealInBox } from '@/lib/scroll'
import { cn } from '@/lib/utils'
import { ValueView } from './values'

type StoryPart = { name: string; what: string } | { text: string }

/** For a hidden example: what changed on screen, since there are no lines to point at. Names are kept apart to light them. */
function narrateExample(prev: TraceStep | undefined, step: TraceStep, isLast: boolean): StoryPart[] {
  if (step.event === 'exception') return [{ text: `Error: ${step.exception ?? ''}` }]
  const before = new Map(prev?.frames.flatMap((f) => f.locals.map(([n, v]) => [n, JSON.stringify(v)] as const)) ?? [])
  const parts: StoryPart[] = []
  for (const f of step.frames) {
    for (const [n, v] of f.locals) {
      if (!before.has(n)) parts.push({ name: n, what: 'is made' })
      else if (before.get(n) !== JSON.stringify(v)) parts.push({ name: n, what: 'changes' })
    }
  }
  const printed = step.output.slice(prev?.output.length ?? 0).trim()
  if (printed) parts.push({ text: `prints ${printed.split('\n').at(-1)}` })
  if (parts.length) return parts
  return [{ text: isLast ? 'Done' : 'Start' }]
}

function narrate(step: TraceStep, file: string): string {
  const where = step.file === file ? `line ${step.line}` : `${step.file}:${step.line}`
  switch (step.event) {
    case 'call':
      return `Enter ${step.func}()`
    case 'return':
      return `${step.func}() finishes`
    case 'exception':
      return `Error in ${step.func}(): ${step.exception ?? ''}`
    default:
      return `About to run ${where} in ${step.func}()`
  }
}

/** The same lit look as a changed value, so a story line and its values read as one. */
const LIT = 'bg-brand-tint ring-1 ring-brand-line/60'

/**
 * A hidden example's story: one numbered line per step reached, growing as it plays. Lines stay once shown (going
 * back only moves the light); the current line and the values it names are lit the same way.
 */
function Story({ steps, at, shown, onPick, one }: { steps: TraceStep[]; at: number; shown: number; onPick: (i: number) => void; one: boolean }) {
  const box = useRef<HTMLOListElement>(null)
  const end = useRef<HTMLLIElement>(null)
  useEffect(() => {
    // Only this list scrolls, never the chat around it (scrollIntoView pulled the page back while playing).
    if (box.current && end.current) revealInBox(box.current, end.current)
  }, [at])
  return (
    <ol ref={box} className="m-0 flex max-h-80 list-none flex-col gap-0.5 overflow-auto rounded-md bg-muted p-1.5 text-[12.5px]">
      {/* One at a time (the step-card setting): only the current line. Highlight: every line reached, current lit. */}
      {steps.slice(0, Math.max(shown, at) + 1).map((s, k) =>
        one && k !== at ? null : (
          <li key={k} ref={k === at ? end : undefined}>
            <button
              type="button"
              onClick={() => onPick(k)}
              className={cn(
                'flex w-full items-start gap-2 rounded px-1.5 py-0.5 text-left',
                k === at ? 'bg-brand-tint text-heading shadow-[inset_2px_0_0_var(--brand-line)]' : 'text-muted-foreground hover:bg-accent/50',
                s.event === 'exception' && 'text-status-missing'
              )}
            >
              <span className="w-4 shrink-0 text-right font-mono text-[10.5px] leading-[1.6]">{k + 1}.</span>
              <span className="min-w-0 flex-1 break-words">
                {narrateExample(steps[k - 1], s, k === steps.length - 1).map((p, n) => (
                  <span key={n}>
                    {n > 0 && <span className="text-muted-foreground"> · </span>}
                    {'name' in p ? (
                      <>
                        <span className={cn('rounded px-1 font-mono text-[11.5px]', k === at ? cn(LIT, 'text-heading') : 'bg-background/60')}>{p.name}</span>{' '}
                        {p.what}
                      </>
                    ) : (
                      p.text
                    )}
                  </span>
                ))}
              </span>
            </button>
          </li>
        )
      )}
    </ol>
  )
}

const SPEEDS = [1400, 800, 400]

/** Step through a recorded run: code on one side, variables drawn on the other. */
export function TracePlayer({ trace, compact = false }: { trace: Trace; compact?: boolean }) {
  // A hidden example shows only steps where something on screen changes (also for ones saved before that rule).
  const steps = useMemo(() => (trace.example ? visibleSteps(trace.steps) : trace.steps), [trace])
  const total = steps.length
  const [i, setI] = useState(0)
  // The learner's step-card choice (Settings › You) also sets how an example's story shows; Highlight until they pick.
  const oneAtATime = useCodeView().view === 'stepper'
  // The furthest step reached: story lines stay shown after that, even when going back or replaying.
  const [shown, setShown] = useState(0)
  if (i > shown) setShown(i)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const codeRef = useRef<HTMLDivElement>(null)
  const step = steps[Math.min(i, Math.max(0, total - 1))]
  const diff = useMemo(() => (step ? changedNames(steps[i - 1], step) : new Set<string>()), [steps, i, step])

  useEffect(() => {
    if (!playing) return
    if (i >= total - 1) {
      setPlaying(false)
      return
    }
    const t = setTimeout(() => setI((x) => x + 1), SPEEDS[speed])
    return () => clearTimeout(t)
  }, [playing, i, total, speed])

  useEffect(() => {
    const line = codeRef.current?.querySelector<HTMLElement>('[data-current="true"]')
    if (codeRef.current && line) revealInBox(codeRef.current, line, 'center')
  }, [i])

  function onKey(e: KeyboardEvent) {
    if (e.key === 'ArrowRight') setI((x) => Math.min(total - 1, x + 1))
    else if (e.key === 'ArrowLeft') setI((x) => Math.max(0, x - 1))
    else if (e.key === ' ') {
      e.preventDefault()
      setPlaying((p) => !p)
    } else return
  }

  if (total === 0) {
    return (
      <p className="text-[12.5px] text-muted-foreground">
        Nothing ran inside {trace.file}.{trace.stopped ? ` ${trace.stopped}` : ''}
      </p>
    )
  }

  const inFile = step.file === trace.file
  const lineCount = trace.source.length
  // In compact (card) mode, show a window of lines around the current one.
  const window = compact ? 7 : Infinity
  const from = compact ? Math.max(1, Math.min(step.line - 3, lineCount - window + 1)) : 1
  const to = compact ? Math.min(lineCount, from + window - 1) : lineCount

  return (
    <div className="flex flex-col gap-2.5 outline-none" tabIndex={0} onKeyDown={onKey} aria-label="Code animation. Left and right arrows step, space plays.">
      <div className={cn('grid gap-2.5', compact || trace.example ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]')}>
        {/* An example the coach wrote: its code never reaches the window, so only the variables and output show. */}
        {!trace.example && (
          <div ref={codeRef} className={cn('overflow-auto rounded-md border bg-background py-1.5', compact ? 'max-h-52' : 'max-h-[420px]')}>
            {!inFile && <p className="px-3 pb-1 font-mono text-[10.5px] text-muted-foreground">now in {step.file}</p>}
            <pre className="m-0 font-mono text-[12px] leading-[1.65]">
              {trace.source.slice(from - 1, to).map((line, k) => {
                const n = from + k
                const current = inFile && n === step.line
                const error = current && step.event === 'exception'
                return (
                  <div
                    key={n}
                    data-current={current}
                    className={cn(
                      'flex border-l-2 pr-3',
                      current ? (error ? 'border-status-missing bg-status-missing/15' : 'border-brand-line bg-brand-tint text-heading') : 'border-transparent'
                    )}
                  >
                    <span className="w-9 shrink-0 pr-2 text-right text-muted-foreground/70 select-none">
                      {current ? (step.event === 'return' ? '↩' : '▶') : n}
                    </span>
                    <span className="whitespace-pre">{line || ' '}</span>
                  </div>
                )
              })}
            </pre>
          </div>
        )}

        {/* An example has no code pane, so its values get the room (they were cut off at 16rem). */}
        <div className={cn('flex flex-col gap-2 overflow-auto', trace.example ? 'max-h-[32rem]' : compact ? 'max-h-64' : 'max-h-[420px]')}>
          {step.frames.map((f, fi) => (
            <div key={`${fi}-${f.func}`} className={cn('rounded-md border px-2.5 py-2', fi === step.frames.length - 1 && fi > 0 ? 'border-brand-line/60' : '')}>
              <div className="mb-1.5 font-mono text-[10px] tracking-[0.06em] text-muted-foreground">
                {f.func === 'scenario' ? 'YOUR SCENARIO' : f.func === 'top level' ? (trace.example ? 'VALUES' : 'TOP LEVEL') : `${f.func.toUpperCase()}()`}
              </div>
              {(trace.example ? localsWithPending(steps, fi, f) : f.locals).length === 0 ? (
                <span className="text-[11.5px] text-muted-foreground">no variables yet</span>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {(trace.example ? localsWithPending(steps, fi, f) : f.locals).map(([name, v]) => (
                    <div
                      key={name}
                      className={cn('flex items-start gap-2 rounded px-1 py-0.5 transition-colors', diff.has(`${fi}:${name}`) && LIT, !v && 'opacity-45')}
                    >
                      <span className="shrink-0 pt-1 font-mono text-[12px] text-heading">{name}</span>
                      {/* In an example, a value made later stays in its place, faded, so the box never jumps. */}
                      {v ? <ValueView value={v} /> : <span className="pt-1 text-[11.5px] text-muted-foreground italic">not made yet</span>}
                    </div>
                  ))}
                </div>
              )}
              {fi === step.frames.length - 1 && step.event === 'return' && step.returnValue && (
                <div className="mt-1.5 flex items-start gap-2 border-t pt-1.5">
                  <span className="pt-1 font-mono text-[11px] text-muted-foreground">returns</span>
                  <ValueView value={step.returnValue} />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {trace.example ? (
        <Story steps={steps} at={i} shown={shown} onPick={setI} one={oneAtATime} />
      ) : (
        <div
          className={cn(
            'flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[12.5px]',
            step.event === 'exception' ? 'bg-status-missing/10 text-status-missing' : 'bg-muted'
          )}
        >
          {step.event === 'exception' && <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />}
          <span className="font-mono text-[10.5px] text-muted-foreground">{trace.scenario[step.scenarioStep] ? `${step.scenarioStep + 1}. ` : ''}</span>
          <span className="min-w-0 flex-1 truncate">{narrate(step, trace.file)}</span>
        </div>
      )}

      {step.output && !trace.example && (
        <pre className="m-0 max-h-20 overflow-auto rounded-md border bg-background px-2.5 py-1.5 font-mono text-[11.5px] text-muted-foreground">
          {step.output}
        </pre>
      )}

      <div className="flex items-center gap-1.5">
        <Button variant="ghost" size="icon-sm" aria-label="First step" onClick={() => setI(0)} disabled={i === 0}>
          <ChevronFirst />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Previous step" onClick={() => setI((x) => Math.max(0, x - 1))} disabled={i === 0}>
          <ChevronLeft />
        </Button>
        <Button
          size="icon-sm"
          aria-label={playing ? 'Pause' : 'Play'}
          onClick={() => {
            if (!playing && i >= total - 1) setI(0)
            setPlaying((p) => !p)
          }}
        >
          {playing ? <Pause /> : <Play />}
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Next step" onClick={() => setI((x) => Math.min(total - 1, x + 1))} disabled={i >= total - 1}>
          <ChevronRight />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Last step" onClick={() => setI(total - 1)} disabled={i >= total - 1}>
          <ChevronLast />
        </Button>
        <label className="sr-only" htmlFor={`scrub-${trace.file}`}>
          Step
        </label>
        <input
          id={`scrub-${trace.file}`}
          type="range"
          min={0}
          max={total - 1}
          value={i}
          onChange={(e) => setI(Number(e.target.value))}
          className="mx-1 h-1 min-w-0 flex-1 accent-[#c0394b]"
        />
        <span className="w-14 shrink-0 text-right font-mono text-[10.5px] text-muted-foreground">
          {i + 1}/{total}
        </span>
        <Button variant="ghost" size="xs" onClick={() => setSpeed((s) => (s + 1) % SPEEDS.length)} aria-label="Change speed">
          {['1×', '2×', '4×'][speed]}
        </Button>
      </div>
      {trace.stopped && <p className="text-[11.5px] text-muted-foreground">Note: {trace.stopped}</p>}
    </div>
  )
}
