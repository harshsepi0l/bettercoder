import { Check, X } from 'lucide-react'
import { NOTES_MAX, SKILL_LEVELS, STYLES, THEMES, type CodeView, type LearnerProfile, type Skill, type SkillLevel, type Theme } from '../../../../shared/profile'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

const BY: Record<Skill['by'], string> = { code: 'from your code', coach: 'from your chats', you: 'set by you' }

/**
 * What the coach thinks of each topic, per language. The learner is never asked their level: BetterCoder judges it
 * from evidence, and this is where they see it and fix a wrong guess.
 */
export function SkillsView({ skills, onSet, onForget }: { skills: Skill[]; onSet: (s: Skill, level: SkillLevel) => void; onForget: (s: Skill) => void }) {
  if (skills.length === 0) {
    return <p className="text-[12px] text-muted-foreground">Nothing yet. Your coach learns this from your code and your chats.</p>
  }
  const byLanguage = new Map<string, Skill[]>()
  for (const s of [...skills].sort((a, b) => a.topic.localeCompare(b.topic))) {
    byLanguage.set(s.language, [...(byLanguage.get(s.language) ?? []), s])
  }
  return (
    <div className="flex flex-col gap-3">
      {[...byLanguage].map(([language, list]) => (
        <div key={language} className="flex flex-col gap-1.5">
          <span className="bc-label">{language === 'general' ? 'GENERAL' : language.toUpperCase()}</span>
          <ul className="flex flex-col divide-y rounded-lg border">
            {list.map((s) => (
              <li key={s.topic} className="flex items-center gap-3 px-3 py-2">
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[13px] text-heading">{s.topic}</span>
                  <span className="truncate text-[11.5px] text-muted-foreground">
                    {s.evidence ? `${s.evidence} · ` : ''}
                    {BY[s.by]}
                  </span>
                </div>
                <div role="radiogroup" aria-label={`Your level in ${s.topic}`} className="flex shrink-0 gap-0.5 rounded-md bg-muted p-0.5">
                  {SKILL_LEVELS.map((l) => (
                    <button
                      key={l.id}
                      type="button"
                      role="radio"
                      aria-checked={l.id === s.level}
                      onClick={() => l.id !== s.level && onSet(s, l.id)}
                      className={cn(
                        'h-6 rounded px-2 text-[11.5px] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                        l.id === s.level ? 'bg-primary font-medium text-primary-foreground' : 'text-foreground hover:bg-accent'
                      )}
                    >
                      {l.label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  aria-label={`Forget ${s.topic}`}
                  title="Forget this"
                  onClick={() => onForget(s)}
                  className="rounded p-1 text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <X className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

/** Style chips and the learner's own words. */
export function StyleEditor({
  profile,
  onChange,
  idPrefix = 'style'
}: {
  profile: LearnerProfile
  onChange: (next: LearnerProfile) => void
  idPrefix?: string
}) {
  function toggle(id: (typeof STYLES)[number]['id']) {
    const has = profile.styles.includes(id)
    onChange({ ...profile, styles: has ? profile.styles.filter((s) => s !== id) : [...profile.styles, id] })
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Coaching style">
        {STYLES.map((s) => {
          const on = profile.styles.includes(s.id)
          return (
            <button
              key={s.id}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(s.id)}
              className={cn(
                'h-8 rounded-full border px-3.5 text-[12.5px] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                on ? 'border-brand-line bg-primary/35 text-heading' : 'bg-card text-foreground hover:border-muted-foreground/50'
              )}
            >
              {s.label}
            </button>
          )
        })}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-notes`} className="text-heading">
          In your own words
        </Label>
        <Textarea
          id={`${idPrefix}-notes`}
          rows={4}
          maxLength={NOTES_MAX}
          value={profile.notes}
          onChange={(e) => onChange({ ...profile, notes: e.target.value })}
          placeholder="e.g. I learn by seeing it. Max 3 bullets. Don't move on until I say I get it."
          className="resize-none bg-card text-[13px]"
        />
        <div className="flex justify-between text-[11.5px] text-muted-foreground">
          <span>Your coach follows this. It still never writes your code.</span>
          <span>
            {profile.notes.length} / {NOTES_MAX}
          </span>
        </div>
      </div>
    </div>
  )
}

/** The sample step both previews draw. The real lines are copied word for word from Microsoft Learn. */
const SAMPLE = [
  { text: 'a ← read a number', method: 'ReadLine' },
  { text: 'turn a into a number', method: 'Parse' },
  { text: 'show the result', method: 'WriteLine' }
]
const SNIPPET = ['ctr++;', 's = Console.ReadLine();', 'Console.WriteLine("Line {0}: {1}", ctr, s);']

const VIEWS: Array<{ id: CodeView; label: string; blurb: string }> = [
  { id: 'highlight', label: 'Highlight', blurb: 'See every line. Pick one to see it lit up in the official example.' },
  { id: 'stepper', label: 'One at a time', blurb: 'One line, its real code and why, then Next.' }
]

function HighlightPreview() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-1.5 rounded-md bg-background p-2.5 font-mono text-[11px]">
      <div className="flex flex-col gap-0.5 rounded bg-muted/60 p-1">
        {SAMPLE.map((l, i) => (
          <div key={l.text} className={cn('flex items-center gap-2 rounded border px-1.5 py-0.5', i === 0 ? 'border-brand-line bg-brand-text/10 text-heading' : 'border-transparent text-muted-foreground')}>
            <span className="min-w-0 flex-1 truncate">{l.text}</span>
            <span className="rounded-full border px-1.5 text-[9.5px] text-brand-text">{l.method}</span>
          </div>
        ))}
      </div>
      <div className="text-[9px] tracking-[0.06em] text-muted-foreground">OFFICIAL EXAMPLE · learn.microsoft.com</div>
      <div className="flex flex-col rounded bg-muted py-1">
        {SNIPPET.map((l, i) => (
          <span key={l} className={cn('truncate px-2', i === 1 ? 'bg-brand-text/10 text-heading shadow-[inset_2px_0_0_var(--brand-line)]' : 'text-muted-foreground')}>
            {l}
          </span>
        ))}
      </div>
    </div>
  )
}

function StepperPreview() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-1.5 rounded-md bg-background p-2.5 font-mono text-[11px]">
      <div className="flex items-center gap-2">
        <div className="flex flex-1 gap-1">
          {SAMPLE.map((l, i) => (
            <span key={l.text} className={cn('h-[3px] flex-1 rounded-full', i === 0 ? 'bg-brand-line' : 'bg-border')} />
          ))}
        </div>
        <span className="text-[9.5px] text-muted-foreground">1 / 3</span>
      </div>
      <div className="rounded bg-muted px-2 py-1.5 text-[13px] text-heading">{SAMPLE[0].text}</div>
      <div className="font-sans text-[11px] text-foreground">It waits for them to type, then press Enter.</div>
      <div className="text-[9px] tracking-[0.06em] text-muted-foreground">THE DOCS WRITE IT AS · learn.microsoft.com</div>
      <div className="truncate rounded bg-muted px-2 py-1 text-heading">{SNIPPET[1]}</div>
      <div className="flex gap-1.5 font-sans">
        <span className="rounded border px-2 py-0.5 text-[10.5px] text-muted-foreground">Back</span>
        <span className="rounded bg-primary px-2 py-0.5 text-[10.5px] text-primary-foreground">Next line</span>
      </div>
    </div>
  )
}

/**
 * How step cards show real code next to pseudocode, with a live-looking preview of each. Used in onboarding and
 * Settings › You; never inside a session.
 */
export function CodeViewPicker({ value, onChange }: { value: CodeView | undefined; onChange: (view: CodeView) => void }) {
  return (
    <div role="radiogroup" aria-label="How step cards show real code" className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2">
      {VIEWS.map((v) => {
        const on = v.id === value
        return (
          <button
            key={v.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(v.id)}
            className={cn(
              'flex min-w-0 flex-col gap-3 rounded-xl border-2 bg-card p-3.5 text-left transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
              on ? 'border-brand-line' : 'border-border hover:border-muted-foreground/50'
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex flex-col gap-0.5">
                <span className="text-[14px] font-semibold text-heading">{v.label}</span>
                <span className="text-[12px] text-muted-foreground">{v.blurb}</span>
              </div>
              <span
                aria-hidden="true"
                className={cn('flex size-[18px] shrink-0 items-center justify-center rounded-full border-2', on ? 'border-brand-line bg-brand-line text-white' : 'border-muted-foreground/60')}
              >
                {on && <Check className="size-3" strokeWidth={3} />}
              </span>
            </div>
            {v.id === 'highlight' ? <HighlightPreview /> : <StepperPreview />}
          </button>
        )
      })}
    </div>
  )
}

const THEME_PREVIEW: Record<Theme, { ground: string; line: string; text: string; accent: string }[]> = {
  system: [
    { ground: '#0f0f10', line: '#2a2a2a', text: '#f4f2ed', accent: '#c0394b' },
    { ground: '#fbfbfa', line: '#d9d9d6', text: '#1c1c1e', accent: '#8b1e2d' }
  ],
  dark: [{ ground: '#0f0f10', line: '#2a2a2a', text: '#f4f2ed', accent: '#c0394b' }],
  light: [{ ground: '#fbfbfa', line: '#d9d9d6', text: '#1c1c1e', accent: '#8b1e2d' }]
}

/**
 * The app's look: dark (black with red), light (the same look in daylight), or the computer's setting, each with a
 * small preview. Settings › You only; never inside a session.
 */
export function ThemePicker({ value, onChange }: { value: Theme | undefined; onChange: (theme: Theme) => void }) {
  const picked = value ?? 'system'
  return (
    <div role="radiogroup" aria-label="The app's look" className="grid w-full grid-cols-3 gap-3">
      {THEMES.map((t) => {
        const on = t.id === picked
        return (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(t.id)}
            className={cn('flex flex-col gap-2 rounded-xl border p-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring', on ? 'border-brand-line' : 'hover:border-muted-foreground/50')}
          >
            <span className="flex h-14 overflow-hidden rounded-md border" aria-hidden="true">
              {THEME_PREVIEW[t.id].map((p, i) => (
                <span key={i} className="flex flex-1 flex-col justify-between p-2" style={{ background: p.ground }}>
                  <span className="h-1.5 w-8 rounded-full" style={{ background: p.text }} />
                  <span className="h-px w-full" style={{ background: p.line }} />
                  <span className="h-2.5 w-6 rounded-sm" style={{ background: p.accent }} />
                </span>
              ))}
            </span>
            <span className={cn('text-[12.5px]', on ? 'font-medium text-heading' : 'text-foreground')}>{t.label}</span>
          </button>
        )
      })}
    </div>
  )
}
