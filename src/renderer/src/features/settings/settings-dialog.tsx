import { useEffect, useState } from 'react'
import type { LearnerProfile } from '../../../../shared/profile'
import { CodeViewPicker, SkillsView, StyleEditor } from '@/features/profile/profile-editor'
import { CheckCircle2, ExternalLink, KeyRound, Loader2, LogIn, Search, X } from 'lucide-react'
import type { ProviderId, ProviderStatus } from '../../../../shared/harness'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import type { SettingsState } from './use-settings'

export function SettingsDialog({
  open,
  onOpenChange,
  state,
  onRedoSetup
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  state: SettingsState
  onRedoSetup: () => void
}) {
  const { settings } = state
  // The coach updates what it thinks of them as it goes: show the latest when Settings opens.
  useEffect(() => {
    if (open) void state.refresh()
  }, [open])
  const connected = settings?.providers.filter((p) => p.connected) ?? []
  const modelValue = settings?.model ? `${settings.model.provider}::${settings.model.id}` : undefined

  async function chooseModel(value: string) {
    const [provider, id] = value.split('::') as [ProviderId, string]
    state.apply(await window.harness.setModel(provider, id))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-heading">Settings</DialogTitle>
          <DialogDescription>
            How your coach talks to you, and the model it runs on. Keys and sign-ins are stored in your OS keychain and
            never leave this app's main process.
          </DialogDescription>
        </DialogHeader>

        {settings && <YouSection state={state} onRedoSetup={onRedoSetup} />}

        <Separator />

        <section className="flex flex-col gap-2">
          <Label className="text-heading">Coach model</Label>
          {connected.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">Connect a provider below to pick a model.</p>
          ) : (
            <Select value={modelValue} onValueChange={chooseModel}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Choose a model" />
              </SelectTrigger>
              <SelectContent>
                {connected.map((p) => (
                  <SelectGroup key={p.id}>
                    <SelectLabel>{p.name}</SelectLabel>
                    {[...p.models].reverse().map((m) => (
                      <SelectItem key={m.id} value={`${p.id}::${m.id}`}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          )}
        </section>

        <Separator />

        <ProvidersSection state={state} />
      </DialogContent>
    </Dialog>
  )
}

/** What the coach thinks of them, their style and their own words. Applies from the next message, in every session. */
function YouSection({ state, onRedoSetup }: { state: SettingsState; onRedoSetup: () => void }) {
  const saved = state.settings!.profile
  const [draft, setDraft] = useState<LearnerProfile>(saved)
  // Skills change on their own (evidence, corrections); only style and own words are drafted here.
  const editable = JSON.stringify([saved.styles, saved.notes])
  useEffect(() => {
    setDraft(saved)
  }, [editable])
  const dirty = JSON.stringify([draft.styles, draft.notes]) !== editable
  return (
    <section className="flex flex-col gap-4" aria-labelledby="you-heading">
      <div className="flex flex-col gap-1">
        <h3 id="you-heading" className="text-sm font-medium text-heading">
          You
        </h3>
        <p className="text-[12px] text-muted-foreground">Sets how much your coach explains, and how it talks to you.</p>
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-[12.5px] font-medium text-heading">Real code in step cards</span>
        <CodeViewPicker value={saved.codeView} onChange={async (codeView) => state.apply(await window.harness.setProfile({ ...saved, codeView }))} />
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-[12.5px] font-medium text-heading">Coach thinks</span>
        <SkillsView
          skills={saved.skills}
          onSet={async (s, level) => state.apply(await window.harness.setSkill(s.language, s.topic, level))}
          onForget={async (s) => state.apply(await window.harness.forgetSkill(s.language, s.topic))}
        />
      </div>
      <StyleEditor profile={draft} onChange={setDraft} idPrefix="settings" />
      <div className="flex items-center gap-2">
        <span className="flex-1 text-[11.5px] text-muted-foreground">Applies from your next message, in every session.</span>
        <Button variant="outline" size="sm" onClick={onRedoSetup}>
          Redo setup
        </Button>
        <Button size="sm" disabled={!dirty} onClick={async () => state.apply(await window.harness.setProfile({ ...saved, styles: draft.styles, notes: draft.notes }))}>
          Save
        </Button>
      </div>
    </section>
  )
}

function errorText(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

/** Connected providers, plus a searchable list of every provider pi-ai ships. */
export function ProvidersSection({ state }: { state: SettingsState }) {
  const [query, setQuery] = useState('')
  const [flow, setFlow] = useState<{ provider: ProviderStatus; kind: 'api_key' | 'oauth' } | null>(null)
  const providers = state.settings?.providers ?? []
  const connected = providers.filter((p) => p.connected)
  const q = query.trim().toLowerCase()
  const available = providers.filter((p) => !p.connected && (!q || p.name.toLowerCase().includes(q) || p.id.includes(q)))

  async function start(provider: ProviderStatus, kind: 'api_key' | 'oauth') {
    state.clearAuth()
    setFlow({ provider, kind })
    try {
      state.apply(await window.harness.login(provider.id, kind))
    } catch (e) {
      state.setAuth({ type: 'error', message: errorText(e) })
    }
  }

  return (
    <section className="flex flex-col gap-4">
      {connected.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <Label className="text-heading">Connected</Label>
          {connected.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
              <span className="text-[13px] text-heading">{p.name}</span>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="border-status-done/50 text-status-done">
                  <CheckCircle2 className="size-3" aria-hidden="true" />
                  {p.connected === 'oauth' ? 'Signed in' : 'API key'}
                </Badge>
                <Button variant="ghost" size="xs" onClick={async () => state.apply(await window.harness.logout(p.id))}>
                  Disconnect
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {flow && (
        <ConnectFlow
          provider={flow.provider}
          kind={flow.kind}
          state={state}
          onClose={() => {
            setFlow(null)
            state.clearAuth()
          }}
        />
      )}

      <div className="flex flex-col gap-2">
        <Label htmlFor="provider-search" className="text-heading">
          Add a provider <span className="font-normal text-muted-foreground">({providers.length} available)</span>
        </Label>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            id="provider-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search: OpenAI, Gemini, Groq, OpenRouter…"
            className="bg-muted pl-8"
          />
        </div>
        <div className="flex max-h-72 flex-col overflow-y-auto rounded-md border">
          {available.length === 0 && <p className="px-3 py-3 text-[12.5px] text-muted-foreground">No providers match.</p>}
          {available.map((p) => (
            <div key={p.id} className="flex items-center gap-2 border-b px-3 py-2 last:border-b-0">
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[13px] text-heading">{p.name}</span>
                <span className="text-[11px] text-muted-foreground">
                  {p.modelCount} model{p.modelCount === 1 ? '' : 's'}
                  {p.signInNote ? ' · subscription sign-in not available' : ''}
                </span>
              </div>
              {p.signInLabel && (
                <Button size="xs" onClick={() => start(p, 'oauth')} disabled={flow !== null} title={p.signInLabel}>
                  <LogIn />
                  Sign in
                </Button>
              )}
              {p.keyLabel && (
                <Button variant="outline" size="xs" onClick={() => start(p, 'api_key')} disabled={flow !== null} title={p.keyLabel}>
                  <KeyRound />
                  API key
                </Button>
              )}
            </div>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Keys and sign-ins are stored in your OS keychain. Claude Pro/Max sign-in isn't offered: Anthropic doesn't allow
          subscriptions in other apps, so use an Anthropic API key.
        </p>
      </div>
    </section>
  )
}

/** One provider's connect flow: whatever it asks (key, region, code) and its progress. */
function ConnectFlow({
  provider,
  kind,
  state,
  onClose
}: {
  provider: ProviderStatus
  kind: 'api_key' | 'oauth'
  state: SettingsState
  onClose: () => void
}) {
  const [value, setValue] = useState('')
  const auth = state.auth
  const finished = auth?.type === 'done'
  const failed = auth?.type === 'error'

  async function answer(v: string | null) {
    if (auth?.type !== 'prompt') return
    const id = auth.id
    state.clearAuth()
    setValue('')
    await window.harness.answerPrompt(id, v)
  }

  async function cancel() {
    if (auth?.type === 'prompt') await window.harness.answerPrompt(auth.id, null)
    await window.harness.cancelLogin()
    onClose()
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-brand-line/50 bg-brand-tint p-3">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium text-heading">
          {kind === 'oauth' ? (provider.signInLabel ?? `Sign in to ${provider.name}`) : (provider.keyLabel ?? `${provider.name} API key`)}
        </span>
        <Button variant="ghost" size="icon-xs" aria-label="Close" onClick={finished || failed ? onClose : cancel}>
          <X />
        </Button>
      </div>

      {auth?.type === 'prompt' && (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (auth.prompt.type !== 'select' && value.trim()) void answer(value.trim())
          }}
        >
          <Label htmlFor="auth-answer" className="text-[12.5px] leading-relaxed">
            {auth.prompt.message}
          </Label>
          {auth.prompt.type === 'select' ? (
            <div className="flex flex-col gap-1.5">
              {auth.prompt.options.map((o) => (
                <Button key={o.id} type="button" variant="outline" className="h-auto justify-start py-2 text-left" onClick={() => answer(o.id)}>
                  <span className="flex flex-col">
                    <span className="text-[12.5px]">{o.label}</span>
                    {o.description && <span className="text-[11px] text-muted-foreground">{o.description}</span>}
                  </span>
                </Button>
              ))}
            </div>
          ) : (
            <div className="flex gap-2">
              <Input
                id="auth-answer"
                autoFocus
                type={auth.prompt.type === 'secret' ? 'password' : 'text'}
                autoComplete="off"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={auth.prompt.placeholder}
                className="bg-background"
              />
              <Button type="submit" disabled={!value.trim()}>
                Continue
              </Button>
            </div>
          )}
        </form>
      )}

      {auth?.type === 'device_code' && (
        <div className="flex flex-col gap-2">
          <span className="text-[12.5px]">Enter this code on the page that just opened in your browser:</span>
          <span className="font-mono text-2xl tracking-[0.2em] text-heading select-text">{auth.userCode}</span>
          <Button variant="outline" size="sm" className="self-start" onClick={() => window.open(auth.verificationUri, '_blank')}>
            <ExternalLink />
            Open page again
          </Button>
        </div>
      )}
      {auth?.type === 'auth_url' && (
        <div className="flex flex-col gap-2">
          <span className="text-[12.5px]">{auth.instructions ?? 'Finish signing in in your browser.'}</span>
          <Button variant="outline" size="sm" className="self-start" onClick={() => window.open(auth.url, '_blank')}>
            <ExternalLink />
            Open sign-in page again
          </Button>
        </div>
      )}
      {(auth?.type === 'progress' || auth?.type === 'info') && <p className="text-[12.5px] text-muted-foreground">{auth.message}</p>}
      {!auth && (
        <p className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          Connecting…
        </p>
      )}
      {finished && (
        <p className="flex items-center gap-2 text-[12.5px] text-status-done">
          <CheckCircle2 className="size-3.5" aria-hidden="true" />
          Connected. Pick a model above.
        </p>
      )}
      {failed && <p className="text-[12.5px] text-status-missing">{auth.message}</p>}
    </div>
  )
}
