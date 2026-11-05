import { useId, useState } from 'react'
import { Check, CornerDownRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/** A question with clickable answers (and their own words), shared by question cards and step cards. */
export function QuestionBody({
  card,
  answer,
  active,
  onAnswer
}: {
  card: { question: string; options: string[]; allowOther: boolean }
  answer?: string
  active: boolean
  onAnswer: (text: string) => void
}) {
  const [other, setOther] = useState('')
  const otherId = useId()
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[14px] font-medium leading-snug text-heading">{card.question}</p>
      <div className="flex flex-col gap-1.5">
        {card.options.map((o) => {
          const chosen = answer === o
          return (
            <button
              key={o}
              type="button"
              disabled={!active}
              onClick={() => onAnswer(o)}
              className={cn(
                'flex items-center gap-2.5 rounded-md border px-3 py-2.5 text-left text-[13px] transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                chosen && 'border-brand-line bg-brand-tint text-heading',
                !chosen && active && 'hover:border-brand-line/60 hover:bg-accent/50',
                !chosen && !active && 'opacity-50'
              )}
            >
              <span
                className={cn(
                  'flex size-4 shrink-0 items-center justify-center rounded-full border',
                  chosen ? 'border-brand-line bg-brand-line text-white' : 'border-muted-foreground/60'
                )}
                aria-hidden="true"
              >
                {chosen && <Check className="size-2.5" />}
              </span>
              {o}
            </button>
          )
        })}
      </div>
      {active && card.allowOther && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (other.trim()) onAnswer(other.trim())
          }}
        >
          <label htmlFor={otherId} className="sr-only">
            Your own answer
          </label>
          <Input
            id={otherId}
            value={other}
            onChange={(e) => setOther(e.target.value)}
            placeholder="Or in your own words…"
            className="h-8 bg-muted text-[12.5px]"
          />
          <Button type="submit" size="sm" variant="secondary" disabled={!other.trim()}>
            Answer
          </Button>
        </form>
      )}
      {!active && answer && !card.options.includes(answer) && (
        <p className="flex items-center gap-1.5 text-[12px] text-brand-text">
          <CornerDownRight className="size-3.5" aria-hidden="true" />
          {answer}
        </p>
      )}
    </div>
  )
}
