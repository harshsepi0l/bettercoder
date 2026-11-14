import { Suspense, lazy, memo, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, Maximize2, Pause, Play } from 'lucide-react'
import { boardScene, type Board } from '../../../../shared/board'
import { Button } from '@/components/ui/button'
import { useCodeView } from '@/features/coach/code-view'
import { revealInBox } from '@/lib/scroll'
import { cn } from '@/lib/utils'

// Excalidraw is large: it loads the first time a board shows.
const BoardCanvas = lazy(() => import('./board-canvas'))

const SPEEDS = [1800, 1100, 600]

/**
 * A whiteboard the coach drew: the board, the line for each step, and play / step controls. Memoised: a card's board
 * never changes, so a streamed reply re-rendering the chat must not redraw every board in it.
 */
export const BoardPlayer = memo(function BoardPlayer({ board, compact = false, onExpand }: { board: Board; compact?: boolean; onExpand?: () => void }) {
  const total = board.steps.length
  const [i, setI] = useState(0)
  const [shown, setShown] = useState(0)
  if (i > shown) setShown(i)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(0)
  // The learner's code-view choice (Settings › You) also sets how the story shows: every line so far, or only the current one.
  const oneAtATime = useCodeView().view === 'stepper'
  const drawn = useMemo(() => boardScene(board, i), [board, i])
  const frame = useMemo(() => boardScene(board, total - 1), [board, total])

  useEffect(() => {
    if (!playing) return
    if (i >= total - 1) {
      setPlaying(false)
      return
    }
    const t = setTimeout(() => setI((x) => x + 1), SPEEDS[speed])
    return () => clearTimeout(t)
  }, [playing, i, total, speed])

  function onKey(e: KeyboardEvent) {
    if (e.key === 'ArrowRight') setI((x) => Math.min(total - 1, x + 1))
    else if (e.key === 'ArrowLeft') setI((x) => Math.max(0, x - 1))
    else if (e.key === ' ') {
      e.preventDefault()
      setPlaying((p) => !p)
    }
  }

  return (
    <div className={cn('flex flex-col gap-2.5 outline-none', !compact && 'min-h-0 flex-1')} tabIndex={0} onKeyDown={onKey} aria-label="Whiteboard. Left and right arrows step, space plays.">
      <div className={cn('overflow-hidden rounded-md border bg-background', compact ? 'h-72' : 'min-h-[300px] flex-1')}>
        <Suspense fallback={<div className="h-full animate-pulse bg-muted" aria-hidden="true" />}>
          <BoardCanvas drawn={drawn} frame={frame} interactive={!compact} />
        </Suspense>
      </div>
      <Story board={board} at={i} shown={shown} one={oneAtATime} onPick={setI} />
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
        <span className="ml-auto font-mono text-[10.5px] text-muted-foreground">
          {i + 1}/{total}
        </span>
        <Button variant="ghost" size="xs" onClick={() => setSpeed((s) => (s + 1) % SPEEDS.length)} aria-label="Change speed">
          {['1×', '2×', '3×'][speed]}
        </Button>
        {onExpand && (
          <Button variant="outline" size="xs" onClick={onExpand} aria-label="Open this board full size in Visualize">
            <Maximize2 />
            Expand
          </Button>
        )}
      </div>
    </div>
  )
})

/** One line per step: every line reached so far with the current one lit (highlight), or only the current one (stepper). */
function Story({ board, at, shown, one, onPick }: { board: Board; at: number; shown: number; one: boolean; onPick: (i: number) => void }) {
  const box = useRef<HTMLOListElement>(null)
  const current = useRef<HTMLLIElement>(null)
  useEffect(() => {
    // Only this list scrolls, never the chat around it.
    if (box.current && current.current) revealInBox(box.current, current.current)
  }, [at])
  const lines = one ? [at] : board.steps.slice(0, shown + 1).map((_, k) => k)
  return (
    <ol ref={box} className="m-0 flex max-h-40 list-none flex-col gap-0.5 overflow-auto rounded-md bg-muted p-1.5 text-[12.5px]">
      {lines.map((k) => (
        <li key={k} ref={k === at ? current : undefined}>
          <button
            type="button"
            onClick={() => onPick(k)}
            className={cn(
              'flex w-full items-start gap-2 rounded px-1.5 py-0.5 text-left',
              k === at ? 'bg-brand-tint text-heading shadow-[inset_2px_0_0_var(--brand-line)]' : 'text-muted-foreground hover:bg-accent/50'
            )}
          >
            <span className="w-4 shrink-0 text-right font-mono text-[10.5px] leading-[1.6]">{k + 1}.</span>
            <span className="min-w-0 flex-1 break-words">{board.steps[k].say}</span>
          </button>
        </li>
      ))}
    </ol>
  )
}
