import { useEffect, useState } from 'react'
import { BookOpen, Clapperboard, ExternalLink, PenLine, FileCode2, Lightbulb, ListOrdered, ScrollText, Workflow } from 'lucide-react'
import { BoardPlayer } from '@/features/visualize/board-player'
import { useBoardOpen } from '@/features/visualize/board-open'
import { QuestionBody } from './question-body'
import { StepCard } from './step-card'
import { DocExampleView } from '@/features/sources/doc-example'
import type { Card } from '../../../../shared/cards'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const SHELL = 'flex flex-col gap-3 rounded-lg border bg-card p-3.5'
const LABEL = 'flex items-center gap-1.5 font-mono text-[10px] tracking-[0.06em] text-muted-foreground'

export function CardView({
  id,
  card,
  answer,
  active,
  latest,
  onAnswer,
  typed
}: {
  /** The chat item it is in (for Expand on a board). */
  id?: string
  card: Card
  /** For questions: what the learner answered, if they did. */
  answer?: string
  /** For questions: whether it can still be answered (the latest open question). */
  active?: boolean
  /** For pseudocode: the newest one starts hidden, line by line; older ones open in full. */
  latest?: boolean
  /** For a step: how many of its pseudocode lines they have written (shown as done). */
  typed?: number
  onAnswer: (text: string) => void
}) {
  switch (card.kind) {
    case 'question':
      return <QuestionCard card={card} answer={answer} active={!!active} onAnswer={onAnswer} />
    case 'diagram':
      return <DiagramCard card={card} />
    case 'code_ref':
      return <CodeRefCard card={card} />
    case 'concept':
      return <ConceptCard card={card} />
    case 'steps':
      return <StepsCard card={card} />
    case 'pseudocode':
      return <PseudocodeCard card={card} revealAll={!latest} />
    case 'step':
      return <StepCard card={card} answer={answer} active={!!active} onAnswer={onAnswer} typed={typed} />
    case 'board':
      return <BoardCard id={id} card={card} />
    case 'animation':
      return <OldAnimation card={card} />
  }
}

function BoardCard({ id, card }: { id?: string; card: Extract<Card, { kind: 'board' }> }) {
  const open = useBoardOpen()
  return (
    <div className={SHELL}>
      <div className={LABEL}>
        <PenLine className="size-3 text-brand-text" aria-hidden="true" />
        {card.title.toUpperCase()}
      </div>
      <p className="flex items-start gap-2 text-[13px]">
        <Lightbulb className="mt-0.5 size-3.5 shrink-0 text-brand-text" aria-hidden="true" />
        {card.note}
      </p>
      <BoardPlayer board={card.board} compact onExpand={open && id ? () => open(id) : undefined} />
    </div>
  )
}

/** A card from the old animator (removed): past sessions show its title only. */
function OldAnimation({ card }: { card: Extract<Card, { kind: 'animation' }> }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-[12px] text-muted-foreground">
      <Clapperboard className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{card.title}</span>
      <span className="shrink-0">old animation, no longer shown</span>
    </div>
  )
}

function QuestionCard({
  card,
  answer,
  active,
  onAnswer
}: {
  card: Extract<Card, { kind: 'question' }>
  answer?: string
  active: boolean
  onAnswer: (text: string) => void
}) {
  return (
    <div className={cn(SHELL, active && 'border-brand-line/60')}>
      <QuestionBody card={card} answer={answer} active={active} onAnswer={onAnswer} />
    </div>
  )
}

let mermaidReady: Promise<typeof import('mermaid')['default']> | null = null
function loadMermaid() {
  mermaidReady ??= import('mermaid').then(({ default: mermaid }) => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'base',
      fontFamily: 'Geist Variable, ui-sans-serif, system-ui, sans-serif',
      flowchart: { htmlLabels: false, curve: 'basis' },
      themeVariables: {
        darkMode: true,
        background: '#2e2e2e',
        primaryColor: '#3a1a1f',
        primaryBorderColor: '#c0394b',
        primaryTextColor: '#ffffff',
        secondaryColor: '#2a2a2a',
        secondaryBorderColor: '#5c5c5c',
        secondaryTextColor: '#c9c9c9',
        tertiaryColor: '#242424',
        tertiaryBorderColor: '#424242',
        tertiaryTextColor: '#c9c9c9',
        lineColor: '#a8a8a8',
        textColor: '#c9c9c9',
        mainBkg: '#3a1a1f',
        nodeBorder: '#c0394b',
        clusterBkg: '#2a2a2a',
        clusterBorder: '#424242',
        edgeLabelBackground: '#2e2e2e',
        actorBkg: '#3a1a1f',
        actorBorder: '#c0394b',
        actorTextColor: '#ffffff',
        signalColor: '#c9c9c9',
        signalTextColor: '#c9c9c9',
        noteBkgColor: '#2a2a2a',
        noteTextColor: '#c9c9c9',
        noteBorderColor: '#5c5c5c',
        fontSize: '13px'
      }
    })
    return mermaid
  })
  return mermaidReady
}

let diagramCounter = 0

function DiagramCard({ card }: { card: Extract<Card, { kind: 'diagram' }> }) {
  const [svg, setSvg] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let cancelled = false
    void loadMermaid()
      .then((mermaid) => mermaid.render(`diagram-${++diagramCounter}`, card.mermaid))
      .then(({ svg }) => !cancelled && setSvg(svg))
      .catch(() => !cancelled && setFailed(true))
    return () => {
      cancelled = true
    }
  }, [card.mermaid])

  return (
    <figure className={cn(SHELL, 'm-0')}>
      <figcaption className={LABEL}>
        <Workflow className="size-3 text-brand-text" aria-hidden="true" />
        {card.title.toUpperCase()}
      </figcaption>
      {svg ? (
        <div
          role="img"
          aria-label={card.title}
          className="flex justify-center overflow-x-auto [&_svg]:h-auto [&_svg]:max-w-full"
          // Rendered by Mermaid with securityLevel "strict" (sanitised, no scripts or links).
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : failed ? (
        <p className="text-[12px] text-muted-foreground">This diagram couldn't be drawn.</p>
      ) : (
        <div className="h-24 animate-pulse rounded-md bg-muted" aria-hidden="true" />
      )}
      {card.caption && <p className="text-[12.5px] leading-relaxed text-muted-foreground">{card.caption}</p>}
    </figure>
  )
}

function CodeRefCard({ card }: { card: Extract<Card, { kind: 'code_ref' }> }) {
  const end = card.startLine + card.lines.length - 1
  return (
    <div className={cn(SHELL, 'gap-0 p-0')}>
      <div className={cn(LABEL, 'border-b px-3.5 py-2')}>
        <FileCode2 className="size-3 text-brand-text" aria-hidden="true" />
        <span className="normal-case tracking-normal text-foreground">
          {card.path}:{card.focusLine ?? card.startLine}
        </span>
        <span className="ml-auto">YOUR CODE · LINES {card.startLine}–{end}</span>
      </div>
      <pre className="m-0 overflow-x-auto py-2 font-mono text-[12px] leading-[1.6] select-text">
        {card.lines.map((line, i) => {
          const n = card.startLine + i
          const focus = n === card.focusLine
          return (
            <div
              key={n}
              className={cn('flex border-l-2 pr-3', focus ? 'border-brand-line bg-brand-tint text-heading' : 'border-transparent')}
            >
              <span className="w-10 shrink-0 pr-3 text-right text-muted-foreground/70 select-none">{n}</span>
              <span className="whitespace-pre">{line || ' '}</span>
            </div>
          )
        })}
      </pre>
      {card.note && (
        <p className="flex items-start gap-2 border-t px-3.5 py-2.5 text-[13px] leading-relaxed">
          <Lightbulb className="mt-0.5 size-3.5 shrink-0 text-brand-text" aria-hidden="true" />
          {card.note}
        </p>
      )}
    </div>
  )
}

function ConceptCard({ card }: { card: Extract<Card, { kind: 'concept' }> }) {
  return (
    <div className={cn(SHELL, 'border-l-0')}>
      <div className={LABEL}>
        <BookOpen className="size-3 text-brand-text" aria-hidden="true" />
        CONCEPT
      </div>
      <p className="text-[15px] font-semibold text-heading">{card.term}</p>
      <p className="text-[13px] leading-relaxed">{card.explanation}</p>
      {card.docUrl && <DocExampleView url={card.docUrl} term={card.term} level={card.level} />}
      {card.docUrl && (
        <a
          href={card.docUrl}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1.5 self-start rounded-md border px-2.5 py-1.5 text-[12px] text-brand-text hover:bg-accent/50"
        >
          <ExternalLink className="size-3.5" aria-hidden="true" />
          {card.docTitle ?? 'Read the docs'}
        </a>
      )}
    </div>
  )
}

/** Old sessions only (checklists are gone): shown as plain numbered lines, never checkboxes. */
function StepsCard({ card }: { card: Extract<Card, { kind: 'steps' }> }) {
  return (
    <div className={SHELL}>
      <div className={LABEL}>
        <ListOrdered className="size-3 text-brand-text" aria-hidden="true" />
        {card.title.toUpperCase()}
      </div>
      <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
        {card.steps.map((step, i) => (
          <li key={i} className="text-[13px] leading-relaxed">
            <span className="mr-1.5 font-mono text-muted-foreground">{i + 1}.</span>
            {step}
          </li>
        ))}
      </ol>
    </div>
  )
}

function PseudocodeCard({ card, revealAll }: { card: Extract<Card, { kind: 'pseudocode' }>; revealAll: boolean }) {
  const [shown, setShown] = useState(revealAll ? card.lines.length : 1)
  const all = shown >= card.lines.length
  return (
    <div className={SHELL}>
      <div className={LABEL}>
        <ScrollText className="size-3 text-brand-text" aria-hidden="true" />
        {card.title.toUpperCase()}
        <span className="ml-auto normal-case tracking-normal">
          {Math.min(shown, card.lines.length)} / {card.lines.length}
        </span>
      </div>
      <ol className="m-0 flex list-none flex-col gap-1 rounded-md bg-muted p-2.5 font-mono text-[12.5px] leading-relaxed">
        {card.lines.slice(0, shown).map((line, i) => {
          const depth = Math.min(6, Math.floor((line.length - line.trimStart().length) / 2))
          return (
            <li key={i} style={{ paddingLeft: `${depth * 1.25}rem` }} className="whitespace-pre-wrap break-words">
              {line.trim()}
            </li>
          )
        })}
      </ol>
      {card.note && all && (
        <p className="flex items-start gap-2 text-[13px]">
          <Lightbulb className="mt-0.5 size-3.5 shrink-0 text-brand-text" aria-hidden="true" />
          {card.note}
        </p>
      )}
      {!all && (
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              // Stepping through to the end is evidence for the coach (they want it in small pieces).
              if (shown + 1 === card.lines.length) void window.harness.cardUse('pseudocode_steps')
              setShown((n) => n + 1)
            }}
          >
            Next line
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              // Skipping most of the reveal is evidence too (they may not need it line by line).
              if (shown < card.lines.length / 2) void window.harness.cardUse('pseudocode_all')
              setShown(card.lines.length)
            }}
          >
            Show all
          </Button>
        </div>
      )}
    </div>
  )
}
