import { useState, type KeyboardEvent } from 'react'
import { ArrowRight, Clapperboard, Compass, LifeBuoy, Send, ShieldCheck, Square } from 'lucide-react'
import type { CoachIntent, TurnUsage } from '../../../../shared/harness'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

/** Each button sends a structured intent; the coach is routed by that, not by the words. */
const CHIPS: Array<{ label: string; icon: typeof LifeBuoy; intent: CoachIntent; message: string }> = [
  { label: "I'm stuck", icon: LifeBuoy, intent: 'stuck', message: "I'm stuck. Help me work out what's going on, without giving me the answer." },
  { label: 'Visualize', icon: Clapperboard, intent: 'visualize', message: 'Visualize my code running.' },
  { label: 'Where am I?', icon: Compass, intent: 'where', message: 'Where am I: what is done, half-built, and missing?' },
  { label: 'What next?', icon: ArrowRight, intent: 'next', message: 'What should I do next?' }
]

function formatTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}

export function Composer({
  wide = false,
  disabledReason,
  busy,
  usage,
  onSend,
  onStop,
  hasCode = true
}: {
  /** False for an idea with no folder yet: there is nothing to visualize. */
  hasCode?: boolean
  wide?: boolean
  /** When set, the composer is disabled and this is shown as the placeholder. */
  disabledReason: string | null
  busy: boolean
  usage: TurnUsage | null
  onSend: (text: string, intent?: CoachIntent) => void
  onStop: () => void
}) {
  const [text, setText] = useState('')
  const disabled = disabledReason !== null

  function submit() {
    if (disabled || text.trim() === '') return
    onSend(text)
    setText('')
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <footer className="shrink-0 border-t border-divider bg-chrome p-3">
      <div className={cn('mx-auto flex flex-col gap-2.5', wide && 'max-w-3xl py-1')}>
        <div className="flex flex-wrap gap-1.5">
          {CHIPS.filter((c) => hasCode || c.intent !== 'visualize').map(({ label, icon: Icon, message, intent }) => (
            <Button
              key={label}
              variant="outline"
              size="xs"
              disabled={disabled || busy}
              onClick={() => onSend(message, intent)}
              className="h-7 px-2.5 text-[11.5px]"
            >
              <Icon />
              {label}
            </Button>
          ))}
        </div>
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <label htmlFor="ask" className="sr-only">
            Ask BetterCoder
          </label>
          <Textarea
            id="ask"
            rows={1}
            value={text}
            disabled={disabled}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={disabledReason ?? (hasCode ? 'Ask about your code…' : 'Ask about your plan…')}
            className="max-h-40 min-h-9 resize-none bg-muted py-2 text-[13px]"
          />
          {busy ? (
            <Button type="button" size="icon" variant="secondary" aria-label="Stop" onClick={onStop}>
              <Square />
            </Button>
          ) : (
            <Button type="submit" size="icon" aria-label="Send" disabled={disabled || text.trim() === ''}>
              <Send />
            </Button>
          )}
        </form>
        <div className="flex items-center justify-between gap-2 font-mono text-[10px] tracking-[0.04em] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <ShieldCheck className="size-3 text-brand-text" aria-hidden="true" />
            NO CODE · READ-ONLY ACCESS
          </span>
          {usage && (
            <span
              title={`New = tokens processed fresh (what mostly counts). Cached = context the provider reused at a large discount (${formatTokens(usage.cacheRead)} tokens, ${cacheShare(usage)}% of what was read).`}
            >
              {formatTokens(usage.input + usage.output)} NEW · {cacheShare(usage)}% CACHED
            </span>
          )}
        </div>
      </div>
    </footer>
  )
}

/** How much of what the model read came from the provider's cache. */
export function cacheShare(u: TurnUsage): number {
  const read = u.input + u.cacheRead
  return read > 0 ? Math.round((u.cacheRead / read) * 100) : 0
}
