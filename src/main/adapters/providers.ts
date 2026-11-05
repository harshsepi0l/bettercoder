import { app } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { type Api, type Model } from '@earendil-works/pi-ai'
import { builtinModels } from '@earendil-works/pi-ai/providers/all'
import type { HarnessSettings, ProviderId, ProviderStatus } from '../../shared/harness'
import { KeychainCredentialStore } from './keychain'
import { DEFAULT_PROFILE, cleanProfile, forgetSkill as forget, noteSkill as note, type LearnerProfile, type Skill } from '../../shared/profile'

/**
 * Subscription sign-ins BetterCoder does not offer, with the reason.
 * Anthropic does not allow Claude Pro/Max subscriptions in third-party apps; its API keys are fine.
 */
export const BLOCKED_SIGN_IN: Record<string, string> = {
  anthropic: 'Anthropic does not allow Claude subscriptions in other apps. Use an Anthropic API key instead.'
}

/** Providers listed first, the rest follow alphabetically. */
const FEATURED = ['xai', 'openai', 'anthropic', 'google', 'openrouter', 'mistral', 'groq', 'deepseek']

export const credentials = new KeychainCredentialStore()
/** Every provider pi-ai ships, with stored keys and sign-ins from the OS keychain. */
export const models = builtinModels({
  credentials,
  identity: { attribution: { name: 'bettercoder', url: 'https://github.com/' } }
})

export function isKnownProvider(id: string): boolean {
  return models.getProvider(id) !== undefined
}

const settingsFile = () => join(app.getPath('userData'), 'settings.json')
let selected: { provider: ProviderId; id: string } | null = null
let profile: LearnerProfile = DEFAULT_PROFILE

export async function loadSettings(): Promise<void> {
  try {
    const saved = JSON.parse(await readFile(settingsFile(), 'utf8'))
    selected = saved.model ?? null
    profile = cleanProfile(saved.profile)
  } catch {
    selected = null
    profile = DEFAULT_PROFILE
  }
}

async function saveSelectedModel(): Promise<void> {
  await writeFile(settingsFile(), JSON.stringify({ model: selected, profile }, null, 2))
}

export function getProfile(): LearnerProfile {
  return profile
}

/** Styles, own words and onboarding from the panel. Skills are kept: only evidence and corrections change them. */
export async function setProfile(next: unknown): Promise<void> {
  profile = { ...cleanProfile(next), skills: profile.skills }
  await saveSelectedModel()
}

/** Evidence of how well they know a topic (their code, the coach, or their own correction). */
export async function noteSkill(skill: Omit<Skill, 'at'>): Promise<void> {
  profile = { ...profile, skills: note(profile.skills, skill, Date.now()) }
  await saveSelectedModel()
}

export async function forgetSkill(language: string, topic: string): Promise<void> {
  profile = { ...profile, skills: forget(profile.skills, language, topic) }
  await saveSelectedModel()
}


export async function setSelectedModel(provider: ProviderId, id: string): Promise<void> {
  if (!models.getModel(provider, id)) throw new Error(`Unknown model ${provider}/${id}`)
  selected = { provider, id }
  await saveSelectedModel()
}

/** The model the coach uses, or null when nothing is connected and chosen. */
export async function currentModel(): Promise<Model<Api> | null> {
  if (!selected) return null
  const stored = await credentials.read(selected.provider)
  if (!stored) return null
  return models.getModel(selected.provider, selected.id) ?? null
}

/** When a provider gets connected and nothing is chosen yet, pick a sensible default from it. */
export async function ensureDefaultModel(provider: ProviderId): Promise<void> {
  if (selected && (await credentials.read(selected.provider))) return
  const list = models.getModels(provider)
  if (list.length === 0) return
  const preferred = list[list.length - 1] // catalogs list newest last
  selected = { provider, id: preferred.id }
  await saveSelectedModel()
}

export async function getSettings(): Promise<HarnessSettings> {
  const stored = new Map((await credentials.list()).map((c) => [c.providerId, c.type]))
  const rank = (id: string) => {
    const i = FEATURED.indexOf(id)
    return i === -1 ? FEATURED.length : i
  }
  const providers: ProviderStatus[] = models
    .getProviders()
    .map((p): ProviderStatus => {
      const connected = (stored.get(p.id) as ProviderStatus['connected']) ?? null
      const oauth = p.auth?.oauth
      return {
        id: p.id,
        name: p.name,
        connected,
        keyLabel: p.auth?.apiKey?.name,
        signInLabel: oauth && !BLOCKED_SIGN_IN[p.id] ? (oauth.loginLabel ?? `Sign in with ${p.name}`) : undefined,
        signInNote: oauth && BLOCKED_SIGN_IN[p.id] ? BLOCKED_SIGN_IN[p.id] : undefined,
        modelCount: models.getModels(p.id).length,
        // Only connected providers send their model lists (some have hundreds).
        models: connected ? models.getModels(p.id).map((m) => ({ id: m.id, name: m.name ?? m.id })) : []
      }
    })
    .sort((a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name))
  const model = selected && stored.has(selected.provider) ? selected : null
  return { providers, model, profile }
}
