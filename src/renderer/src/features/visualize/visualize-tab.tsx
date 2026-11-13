import { useMemo, useState } from 'react'
import { Lightbulb, PenLine } from 'lucide-react'
import { boardsFromChat, type ChatItem } from '../../../../shared/chat'
import type { CoachIntent } from '../../../../shared/harness'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { EmptyState } from '@/features/shell/empty-state'
import { cn } from '@/lib/utils'
import { BoardPlayer } from './board-player'

/**
 * The whiteboard, full size: every board the coach drew in this session (pick one; newest first), which can be
 * panned and zoomed here. With none yet, one button asks the coach to draw.
 */
export function VisualizeTab({
  items,
  busy,
  onAsk
}: {
  items: ChatItem[]
  busy: boolean
  onAsk: (text: string, intent?: CoachIntent) => void
}) {
  const boards = useMemo(() => boardsFromChat(items), [items])
  const [picked, setPicked] = useState<string | null>(null)
  const draw = (
    <Button size="sm" disabled={busy} onClick={() => onAsk('Draw what my code does on the whiteboard.', 'visualize')}>
      <PenLine />
      {boards.length ? 'Draw another' : 'Ask the coach to draw it'}
    </Button>
  )

  if (boards.length === 0) {
    return (
      <EmptyState icon={PenLine} title="Whiteboard" action={draw}>
        The coach draws ideas and your code here, step by step: values, lists, and what points to what.
      </EmptyState>
    )
  }

  const current = boards.find((b) => b.id === picked) ?? boards.at(-1)!
  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 p-3.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {[...boards].reverse().map((b) => (
            <button
              key={b.id}
              type="button"
              aria-pressed={b.id === current.id}
              onClick={() => setPicked(b.id)}
              className={cn(
                'rounded-full border px-2.5 py-0.5 text-[12px]',
                b.id === current.id ? 'border-brand-line bg-brand-tint text-heading' : 'text-muted-foreground hover:bg-accent/50'
              )}
            >
              {b.card.title}
            </button>
          ))}
          <span className="ml-auto">{draw}</span>
        </div>
        <p className="flex items-start gap-2 text-[13px]">
          <Lightbulb className="mt-0.5 size-3.5 shrink-0 text-brand-text" aria-hidden="true" />
          {current.card.note}
        </p>
        <BoardPlayer key={current.id} board={current.card.board} />
      </div>
    </ScrollArea>
  )
}
