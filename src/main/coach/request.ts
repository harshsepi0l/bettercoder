import type { Message } from '@earendil-works/pi-ai'
import { turnReminder } from './prompts'
import { HIDDEN_PREFIX, readIntent, stripIntent, turnState, textOf, hasCode } from './turn'

/**
 * Building each model request: old tool results stubbed, code replies withheld, the per-turn note (learner now,
 * editor view, reminder) on the newest message, and the prompt-cache settings.
 */
/**
 * Before each request: old tool results become one-line stubs (every request resends
 * everything, so old file contents are what makes token use balloon), and replies
 * that contained code are replaced by a stub so the model never builds on them.
 */
export function prepareMessages(messages: readonly Message[], hasPython = true, idea = false, editor = ''): Message[] {
  // The learner's latest message: hidden redo messages ("[BetterCoder] …") belong to the same turn.
  let lastUser = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user' && !textOf(messages[i].content).startsWith(HIDDEN_PREFIX)) {
      lastUser = i
      break
    }
  }
  return messages.map((m, i) => {
    if (m.role === 'toolResult' && i < lastUser && textOf(m.content).length > 300) {
      return { ...m, content: [{ type: 'text', text: `[${m.toolName} result from an earlier turn, removed to save space. Call it again if you need it.]` }] }
    }
    if (m.role === 'assistant' && hasCode(textOf(m.content))) {
      const kept = m.content.filter((c) => c.type !== 'text')
      return { ...m, content: [{ type: 'text', text: '[reply withheld: it contained code]' }, ...kept] } as Message
    }
    if (m.role === 'user') {
      const text = textOf(m.content)
      const intent = readIntent(text)
      if (i === lastUser) {
        const reminder = turnReminder(intent ?? turnState(messages).intent, hasPython, idea)
        // The editor as it is now: only on this request, so stale copies never pile up in the transcript.
        return { ...m, content: `${stripIntent(text)}\n\n${editor ? `${editor}\n\n` : ''}${reminder}` }
      }
      if (intent) return { ...m, content: stripIntent(text) }
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
