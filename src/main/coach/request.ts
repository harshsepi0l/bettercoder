import type { Message } from '@earendil-works/pi-ai'
import { turnReminder } from './prompts'
import { HIDDEN_PREFIX, readIntent, readMode, stripIntent, turnState, textOf, hasCode } from './turn'

/**
 * Building each model request so that it only ever grows: a provider re-reads a request at full price from the first
 * byte that differs from what it saw before (xAI: "never edit, remove, or reorder earlier messages"). So:
 * - the per-turn note (learner now, editor view, last run, tasks, reminder) is written once per learner message and
 *   then sent with that message exactly as it was, every time (kept in memory only, never stored);
 * - old tool results are cut to one-line stubs, and old notes dropped, only every TIDY_EVERY learner messages, all at
 *   once: one cache miss then, instead of one on every message;
 * - replies that contained code are replaced by a stub, so the model never builds on them.
 */

/** Learner messages between tidy-ups of the history (old tool results stubbed, old notes dropped). */
export const TIDY_EVERY = 4

/** The note each learner message was first sent with, by message; one per open session, in memory only. */
export type SentNotes = Map<string, string>

const noteKey = (m: Message, text: string) => `${m.timestamp}\u0000${text}`

export function prepareMessages(
  messages: readonly Message[],
  idea = false,
  editor: string | (() => string) = '',
  sent: SentNotes = new Map()
): Message[] {
  // Learner messages; hidden redo messages ("[BetterCoder] …") belong to the turn before them.
  const learner: number[] = []
  messages.forEach((m, i) => {
    if (m.role === 'user' && !textOf(m.content).startsWith(HIDDEN_PREFIX)) learner.push(i)
  })
  const lastUser = learner.at(-1) ?? -1
  // The last tidy-up: the learner message it happened at. Everything before it is tidied; nothing after it changes.
  const tidyAt = learner.length > 0 ? learner[Math.floor((learner.length - 1) / TIDY_EVERY) * TIDY_EVERY] : -1
  return messages.map((m, i) => {
    if (m.role === 'toolResult' && i < tidyAt && textOf(m.content).length > 300) {
      return { ...m, content: [{ type: 'text', text: `[${m.toolName} result from an earlier turn, removed to save space. Call it again if you need it.]` }] }
    }
    if (m.role === 'assistant' && hasCode(textOf(m.content))) {
      const kept = m.content.filter((c) => c.type !== 'text')
      return { ...m, content: [{ type: 'text', text: '[reply withheld: it contained code]' }, ...kept] } as Message
    }
    if (m.role === 'user' && learner.includes(i)) {
      const text = stripIntent(textOf(m.content))
      const key = noteKey(m, text)
      let note = sent.get(key)
      if (note === undefined && i === lastUser) {
        const view = typeof editor === 'function' ? editor() : editor
        const raw = textOf(m.content)
        const reminder = turnReminder(readIntent(raw) ?? turnState(messages).intent, idea, readMode(raw))
        note = `${view ? `${view}\n\n` : ''}${reminder}`
        sent.set(key, note)
      }
      // Notes from before the last tidy-up are dropped (and forgotten); after a restart older notes are gone too.
      if (i < tidyAt) sent.delete(key)
      return note !== undefined && i >= tidyAt ? { ...m, content: `${text}\n\n${note}` } : { ...m, content: text }
    }
    return m
  }) as Message[]
}

/**
 * Prompt caching. Providers bill a request's unchanged start at a fraction of the price, but only if it reaches a
 * server that still has it. pi-ai already routes by pi-durable's session id (`prompt_cache_key`, which is what xAI's
 * Responses API uses); a second, different id (an `x-grok-conv-id` header) only risked splitting the routing, so none
 * is added. "long" keeps the cache through the learner's pauses where the provider offers it (pi-ai sends it only to
 * those that do).
 */
export function cacheSettings(): { cacheRetention: 'long' } {
  return { cacheRetention: 'long' }
}
