/** Types shared by the harness (main process) and the panel (renderer). */
import type { OpenSession } from './workspace'
import type { Card } from './cards'
import type { LearnerProfile, SkillLevel } from './profile'

/** Card actions that hint at the learner's level. */
export type CardUse = 'pseudocode_all' | 'pseudocode_steps' | 'example_full'

export const HARNESS_IPC = {
  send: 'harness:send',
  abort: 'harness:abort',
  event: 'harness:event',
  getSettings: 'settings:get',
  login: 'settings:login',
  answerPrompt: 'settings:answer-prompt',
  cancelLogin: 'settings:cancel-login',
  logout: 'settings:logout',
  setModel: 'settings:set-model',
  setProfile: 'settings:set-profile',
  authEvent: 'settings:auth-event',
  cardUse: 'harness:card-use',
  forgetSkill: 'settings:forget-skill',
  setSkill: 'settings:set-skill'
} as const

/** Any provider pi-ai ships ("xai", "openai", "google", ...). */
export type ProviderId = string

/** What a composer button asks for. Structured data from the UI, never guessed from words. */
export type CoachIntent = 'visualize' | 'stuck' | 'where' | 'next'


export interface ProviderStatus {
  id: ProviderId
  name: string
  /** How it is connected right now, if at all. */
  connected: null | 'api_key' | 'oauth'
  /** What its key is called ("OpenAI API key"), when it takes one. */
  keyLabel?: string
  /** Label for the subscription sign-in button, when the provider offers one we support. */
  signInLabel?: string
  /** Why a sign-in the provider has is not offered. */
  signInNote?: string
  modelCount: number
  /** Only filled for connected providers. */
  models: Array<{ id: string; name: string }>
}

export interface HarnessSettings {
  providers: ProviderStatus[]
  model: { provider: ProviderId; id: string } | null
  profile: LearnerProfile
}

export type AuthPromptUi =
  | { type: 'text' | 'secret' | 'manual_code'; message: string; placeholder?: string }
  | { type: 'select'; message: string; options: Array<{ id: string; label: string; description?: string }> }

export type AuthUiEvent =
  /** The provider's setup asks the learner something (a key, a region, a choice). Answer with answerPrompt. */
  | { type: 'prompt'; id: string; provider: ProviderId; prompt: AuthPromptUi }
  | { type: 'device_code'; userCode: string; verificationUri: string }
  | { type: 'auth_url'; url: string; instructions?: string }
  | { type: 'progress'; message: string }
  | { type: 'info'; message: string }
  | { type: 'done' }
  | { type: 'error'; message: string }

export interface TurnUsage {
  input: number
  output: number
  cacheRead: number
  total: number
}

export type HarnessEvent =
  | { type: 'busy'; busy: boolean }
  /** The learner's message, echoed so the chat (and its saved copy) shows it. */
  | { type: 'user'; id: string; text: string }
  | { type: 'assistant_start'; id: string }
  | { type: 'text'; id: string; delta: string }
  /** A session became the active one (opened or created). */
  | { type: 'session_opened'; open: OpenSession }
  /** The open session was deleted; nothing is open now. */
  | { type: 'session_closed' }
  | { type: 'assistant_end'; id: string }
  | { type: 'tool'; id: string; label: string; detail: string; status: 'running' | 'done' | 'error' }
  /** A visual card from the coach (question, diagram, code reference, concept, steps). */
  | { type: 'card'; id: string; card: Card }
  | { type: 'error'; message: string }
  | { type: 'usage'; turn: TurnUsage; session: TurnUsage }

export interface HarnessApi {
  /** `intent` only from buttons; typed text is sent without one. */
  send(text: string, intent?: CoachIntent): Promise<void>
  abort(): Promise<void>
  onEvent(listener: (event: HarnessEvent) => void): () => void
  getSettings(): Promise<HarnessSettings>
  /** Connect a provider: "api_key" runs its guided key setup, "oauth" its sign-in. */
  login(provider: ProviderId, kind: 'api_key' | 'oauth'): Promise<HarnessSettings>
  /** Answer (or, with null, cancel) a prompt from the connect flow. */
  answerPrompt(id: string, value: string | null): Promise<void>
  cancelLogin(): Promise<void>
  logout(provider: ProviderId): Promise<HarnessSettings>
  setModel(provider: ProviderId, id: string): Promise<HarnessSettings>
  /** Styles and the learner's own words; applies from the next message. Skills are not changed here. */
  setProfile(profile: LearnerProfile): Promise<HarnessSettings>
  /** The learner corrects what the coach thinks of one topic. */
  setSkill(language: string, topic: string, level: SkillLevel): Promise<HarnessSettings>
  forgetSkill(language: string, topic: string): Promise<HarnessSettings>
  /** How the learner used a card (evidence of their level for the coach). */
  cardUse(kind: CardUse): Promise<void>
  onAuthEvent(listener: (event: AuthUiEvent) => void): () => void
}
