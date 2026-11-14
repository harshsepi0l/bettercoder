import { BookOpen, ListChecks, Map, MessageSquare, PenLine, type LucideIcon } from 'lucide-react'
import type { CoachMode } from '../../../../shared/harness'
import { cn } from '@/lib/utils'

/** The coach's modes, at the top of its pane. Chat is the only place the conversation is; the others are views. */
export const MODES: Array<{ id: CoachMode; label: string; icon: LucideIcon }> = [
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'tasks', label: 'Tasks', icon: ListChecks },
  { id: 'visualize', label: 'Visualize', icon: PenLine },
  { id: 'map', label: 'Map', icon: Map },
  { id: 'sources', label: 'Sources', icon: BookOpen }
]

export function ModeBar({ mode, onChange, locked }: { mode: CoachMode; onChange: (m: CoachMode) => void; locked: CoachMode[] }) {
  return (
    <div role="tablist" aria-label="Coach mode" className="@container flex h-11 shrink-0 items-stretch justify-between gap-1 overflow-x-auto border-b border-divider bg-chrome px-3">
      {MODES.map(({ id, label, icon: Icon }) => {
        const off = locked.includes(id)
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={mode === id}
            disabled={off}
            title={off ? 'Link your project folder to use this' : undefined}
            onClick={() => onChange(id)}
            className={cn(
              'bc-label flex shrink-0 items-center justify-center gap-1.5 px-1.5 outline-none focus-visible:ring-2 focus-visible:ring-brand-line disabled:opacity-40',
              mode === id ? 'text-heading shadow-[inset_0_-2px_0_var(--brand-line)]' : 'hover:text-foreground'
            )}
          >
            {/* A narrow pane keeps the words and drops the icons, so all five modes always fit. */}
            <Icon className="hidden size-3.5 shrink-0 @[440px]:block" aria-hidden="true" />
            <span className="truncate">{label}</span>
          </button>
        )
      })}
    </div>
  )
}
