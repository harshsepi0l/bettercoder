import { useState } from 'react'
import type { LearnerProfile } from '../../../../shared/profile'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ProvidersSection } from '@/features/settings/settings-dialog'
import type { SettingsState } from '@/features/settings/use-settings'
import { cn } from '@/lib/utils'
import { CodeViewPicker, StyleEditor } from './profile-editor'

/** How an answer reads (style step preview). */
const PREVIEW = { headline: 'Off-by-one in your loop bound', bullets: ['range(n) stops at n - 1', 'Check the last index you visit'] }

const STEPS = 3

/**
 * First launch: how the coach talks → how real code shows in step cards → connect a model. Their level is never asked: the coach judges it per topic
 * from their code and chats, and shows it in Settings › You.
 */
export function Onboarding({ state, onDone }: { state: SettingsState; onDone: () => void }) {
  const [step, setStep] = useState(0)
  // Highlight is preselected, so finishing always saves a pick (changeable in Settings › You).
  const [draft, setDraft] = useState<LearnerProfile>(() => ({ codeView: 'highlight', ...state.settings!.profile }))
  const [saving, setSaving] = useState(false)
  const connected = state.settings?.providers.some((p) => p.connected) ?? false

  async function finish() {
    setSaving(true)
    try {
      state.apply(await window.harness.setProfile({ ...draft, onboarded: true }))
      onDone()
    } finally {
      setSaving(false)
    }
  }

  const titles = ['How should your coach talk to you?', 'How should real code look?', 'Connect the AI your coach runs on']
  const subs = [
    'Pick any that fit, or say it in your own words. Optional. Your coach works out your level as you go.',
    'Your coach writes pseudocode; the real line comes from the official docs. Pick how you want to see it.',
    'Sign in or paste a key. It stays in your computer’s keychain.'
  ]
  const preview = PREVIEW

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col items-center gap-6 px-4 py-10">
        <div className="flex items-center gap-2 font-mono text-[11px] tracking-[0.06em] text-muted-foreground" aria-label={`Step ${step + 1} of ${STEPS}`}>
          {Array.from({ length: STEPS }, (_, i) => (
            <span key={i} className={cn('h-1 w-6 rounded-full', i <= step ? 'bg-brand-line' : 'bg-border')} />
          ))}
          <span className="ml-1.5">
            STEP {step + 1} OF {STEPS}
          </span>
        </div>
        <div className="flex flex-col items-center gap-2 text-center">
          <h1 className="text-[26px] font-semibold tracking-tight text-heading">{titles[step]}</h1>
          <p className="text-[14px] text-muted-foreground">{subs[step]}</p>
        </div>

        {step === 0 && (
          <div className="grid w-full grid-cols-1 gap-6 md:grid-cols-[1.15fr_1fr]">
            <StyleEditor profile={draft} onChange={setDraft} idPrefix="onboarding" />
            <div className="flex flex-col gap-2">
              <span className="font-mono text-[10.5px] tracking-[0.06em] text-muted-foreground">PREVIEW</span>
              <div className="flex flex-col gap-3 rounded-xl border bg-chrome p-4 text-[13px]">
                <div className="max-w-[80%] self-end rounded-lg bg-accent px-3 py-2 text-heading">why does my list skip the last item?</div>
                <div className="flex flex-col gap-1 leading-relaxed">
                  <strong className="text-heading">{preview.headline}</strong>
                  {preview.bullets.map((b) => (
                    <span key={b}>· {b}</span>
                  ))}
                </div>
                {draft.styles.includes('questions') && (
                  <div className="flex flex-col gap-2 rounded-lg border bg-card p-3">
                    <span className="text-heading">Does that make sense so far?</span>
                    <div className="flex gap-1.5 text-[12px]">
                      <span className="rounded-md border px-2.5 py-1">Yes, got it</span>
                      <span className="rounded-md border px-2.5 py-1">Not yet</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="w-full max-w-3xl">
            <CodeViewPicker value={draft.codeView} onChange={(codeView) => setDraft({ ...draft, codeView })} />
          </div>
        )}

        {step === 2 && (
          <div className="w-full max-w-xl">
            <ProvidersSection state={state} />
          </div>
        )}

        <div className="flex items-center gap-3">
          {step > 0 && (
            <Button variant="outline" size="lg" onClick={() => setStep(step - 1)}>
              Back
            </Button>
          )}
          {step < STEPS - 1 ? (
            <Button size="lg" onClick={() => setStep(step + 1)}>
              Continue
            </Button>
          ) : (
            <Button size="lg" disabled={saving} onClick={finish}>
              {connected ? 'Finish' : 'Do this later'}
            </Button>
          )}
          {step === 0 && (
            <Button variant="link" onClick={() => setStep(1)}>
              Skip
            </Button>
          )}
        </div>
      </div>
    </ScrollArea>
  )
}
