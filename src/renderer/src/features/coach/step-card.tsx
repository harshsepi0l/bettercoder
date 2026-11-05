import { useState } from 'react'
import { BookOpen, ExternalLink, Footprints, MapPin } from 'lucide-react'
import type { Card, StepLine } from '../../../../shared/cards'
import { splitLine, type LineSegment } from '../../../../shared/line-parts'
import type { CodeView } from '../../../../shared/profile'
import { Button } from '@/components/ui/button'
import { DocExampleView, docHost, useDocExample } from '@/features/sources/doc-example'
import { cn } from '@/lib/utils'
import { useCodeView } from './code-view'
import { QuestionBody } from './question-body'

type StepCardData = Extract<Card, { kind: 'step' }>

const SHELL = 'flex flex-col gap-3.5 rounded-lg border bg-card p-3.5'
const LABEL = 'flex items-center gap-1.5 font-mono text-[10px] tracking-[0.06em] text-muted-foreground'
const linked = (l: StepLine) => !!(l.method && l.docUrl)
const depthOf = (text: string) => Math.min(6, Math.floor((text.length - text.trimStart().length) / 2))

/**
 * One step in one card: the idea, the pseudocode, and (optionally) a question. Lines that use a real method link to
 * the official line for it, shown the way the learner picked: highlighted in its example, or one line at a time.
 */
export function StepCard({
  card,
  answer,
  active,
  onAnswer
}: {
  card: StepCardData
  answer?: string
  active: boolean
  onAnswer: (text: string) => void
}) {
  // Picked in onboarding or Settings › You, never inside a session; Highlight until they pick.
  const shown: CodeView = useCodeView().view ?? 'highlight'
  const hasLinks = card.lines.some(linked)
  return (
    <div className={cn(SHELL, active && 'border-brand-line/60')}>
      <div className={LABEL}>
        <Footprints className="size-3 text-brand-text" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">{card.title.toUpperCase()}</span>
        {card.anchor && (
          <button
            type="button"
            className="flex shrink-0 items-center gap-1 rounded text-brand-text underline-offset-2 hover:underline"
            title="Open in your editor"
            onClick={() => void window.ide.openInEditor(card.anchor!.path, card.anchor!.line)}
          >
            <MapPin className="size-3" aria-hidden="true" />
            {card.anchor.path.split('/').pop()}:{card.anchor.line}
          </button>
        )}
      </div>

      {card.idea && <Idea idea={card.idea} showExample={!hasLinks} />}

      {card.lines.length > 0 && (shown === 'stepper' ? <Stepper lines={card.lines} /> : <Highlight lines={card.lines} />)}

      {card.question && (
        <div className="border-t pt-3">
          <QuestionBody card={card.question} answer={answer} active={active} onAnswer={onAnswer} />
        </div>
      )}
    </div>
  )
}

function Idea({ idea, showExample }: { idea: NonNullable<StepCardData['idea']>; showExample: boolean }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className={LABEL}>
        <BookOpen className="size-3 text-brand-text" aria-hidden="true" />
        THE IDEA
      </div>
      <p className="text-[14px] leading-relaxed">
        <strong className="font-semibold text-heading">{idea.term}</strong>: {idea.explanation}
      </p>
      {/* With linked lines, the official code shows per line instead. */}
      {showExample && idea.docUrl && <DocExampleView url={idea.docUrl} term={idea.term} level={idea.level} />}
      {idea.docUrl && (
        <a
          href={idea.docUrl}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1.5 self-start text-[12px] text-brand-text underline-offset-2 hover:underline"
        >
          <ExternalLink className="size-3" aria-hidden="true" />
          {idea.docTitle ?? 'Read the docs'}
        </a>
      )}
    </div>
  )
}

/** The official example for one line's method, with the line that uses it lit. */
function LineExample({ line, oneLine = false }: { line: StepLine; oneLine?: boolean }) {
  const example = useDocExample(line.docUrl, line.method)
  const [more, setMore] = useState(false)
  const [picked, setPicked] = useState<number | undefined>(undefined)
  if (!line.docUrl) return null
  if (!example) {
    return (
      <p className="text-[12px] text-muted-foreground">
        Looking up <span className="font-mono text-brand-text">{line.method}</span> in the official docs…{' '}
        <a href={line.docUrl} target="_blank" rel="noreferrer" className="text-brand-text underline-offset-2 hover:underline">
          Open the page
        </a>
      </p>
    )
  }
  const single = oneLine && !more && example.focus !== undefined
  const lines = single ? [example.excerpt[example.focus!].trim()] : example.excerpt
  const focus = single ? 0 : example.focus
  // For topics they're new to: the parts the coach named, found in the official line (the line itself is untouched).
  const segments = focus !== undefined && line.parts?.length ? splitLine(lines[focus], line.parts) : []
  const labelled = segments.some((s) => s.says)
  // Until they tap, the first labelled part is shown, so the idea is visible at rest. A pick from the other view
  // (one line vs the whole example splits differently) falls back to the first labelled part.
  const current = picked !== undefined && segments[picked]?.says ? picked : segments.findIndex((s) => s.says)
  return (
    <div className="flex flex-col gap-1.5">
      <div className={LABEL}>
        <span className="size-1.5 rounded-full bg-status-done" aria-hidden="true" />
        {oneLine ? 'THE DOCS WRITE IT AS' : `OFFICIAL EXAMPLE · ${line.method}`} · {docHost(example.url)}
      </div>
      <pre className="m-0 overflow-x-auto rounded-md bg-muted py-1.5 font-mono text-[11.5px] leading-relaxed">
        {lines.map((l, i) => (
          <div key={i} className={cn('px-2.5', i === focus && lines.length > 1 && 'bg-brand-text/10 shadow-[inset_2px_0_0_var(--brand-line)] text-heading')}>
            {i === focus && labelled ? <TapParts segments={segments} current={current} onPick={setPicked} /> : l || ' '}
          </div>
        ))}
      </pre>
      {labelled && <PartLabel segment={segments[current]} />}
      {oneLine && example.focus !== undefined && example.excerpt.length > 1 && (
        <button type="button" onClick={() => (setMore((m) => !m), setPicked(undefined))} className="self-start text-[11.5px] text-brand-text underline-offset-2 hover:underline">
          {more ? 'Just the line' : 'See it in the example'}
        </button>
      )}
    </div>
  )
}

/** The official line with the labelled parts underlined; tap one to see what it does. */
function TapParts({ segments, current, onPick }: { segments: LineSegment[]; current: number; onPick: (i: number) => void }) {
  return (
    <>
      {segments.map((s, i) =>
        s.says ? (
          <button
            key={i}
            type="button"
            aria-pressed={i === current}
            onClick={() => onPick(i)}
            className={cn(
              'rounded-t-sm border-b border-dashed border-brand-line px-px text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
              i === current && 'border-solid bg-brand-text/15 text-heading'
            )}
          >
            {s.text}
          </button>
        ) : (
          <span key={i}>{s.text}</span>
        )
      )}
    </>
  )
}

/** The label of the part in view (one is always picked: the first labelled part until they tap). */
function PartLabel({ segment }: { segment: LineSegment }) {
  return (
    <p className="min-h-[1.5em] text-[12.5px] leading-relaxed" aria-live="polite">
      <span className="font-mono text-heading">{segment.text.trim()}</span> {segment.says}
    </p>
  )
}

/** C: every line visible; pick one to see its official example, with the matching line lit. */
function Highlight({ lines }: { lines: StepLine[] }) {
  const [sel, setSel] = useState(() => Math.max(0, lines.findIndex(linked)))
  const current = lines[sel]
  return (
    <div className="flex flex-col gap-2.5">
      <ol className="m-0 flex list-none flex-col gap-0.5 rounded-md bg-muted/60 p-1.5">
        {lines.map((l, i) => (
          <li key={i}>
            <button
              type="button"
              aria-pressed={i === sel}
              onClick={() => setSel(i)}
              style={{ paddingLeft: `${0.5 + depthOf(l.text) * 1.1}rem` }}
              className={cn(
                'flex w-full items-center gap-2 rounded border border-transparent py-1 pr-2 text-left font-mono text-[12.5px] text-heading outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                i === sel ? 'border-brand-line bg-brand-text/10' : 'hover:bg-accent/50'
              )}
            >
              <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{l.text.trim()}</span>
              {linked(l) && (
                <span className="shrink-0 rounded-full border px-2 font-mono text-[10.5px] text-brand-text">{l.method!.split('.').pop()}</span>
              )}
            </button>
          </li>
        ))}
      </ol>
      {current?.note && <p className="text-[13px] leading-relaxed">{current.note}</p>}
      {current && linked(current) ? (
        <LineExample line={current} />
      ) : (
        lines.some(linked) && <p className="text-[12px] text-muted-foreground">Plain logic: no method to look up. Pick a line with a tag to see real code.</p>
      )}
    </div>
  )
}

/** D: one line at a time, with its official line and a note. */
function Stepper({ lines }: { lines: StepLine[] }) {
  const [at, setAt] = useState(0)
  const line = lines[at]
  const depth = depthOf(line.text)
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2">
        <div className="flex flex-1 gap-1" aria-hidden="true">
          {lines.map((_, i) => (
            <span key={i} className={cn('h-[3px] flex-1 rounded-full', i <= at ? 'bg-brand-line' : 'bg-border')} />
          ))}
        </div>
        <span className="font-mono text-[10.5px] text-muted-foreground">
          {at + 1} / {lines.length}
        </span>
      </div>
      <p className="m-0 rounded-md bg-muted px-3 py-2.5 font-mono text-[15px] text-heading">
        {depth > 0 && <span className="mr-2 text-[11px] text-muted-foreground">inside ›</span>}
        {line.text.trim()}
      </p>
      {line.note && <p className="text-[13px] leading-relaxed">{line.note}</p>}
      {linked(line) && <LineExample key={at} line={line} oneLine />}
      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={at === 0} onClick={() => setAt((n) => n - 1)}>
          Back
        </Button>
        <Button
          size="sm"
          disabled={at === lines.length - 1}
          onClick={() => {
            // Stepping through to the end is evidence for the coach (they want it in small pieces).
            if (at + 1 === lines.length - 1) void window.harness.cardUse('pseudocode_steps')
            setAt((n) => n + 1)
          }}
        >
          Next line
        </Button>
      </div>
    </div>
  )
}
