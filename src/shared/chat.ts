import { cardQuestion, type Card } from './cards'
import type { HarnessEvent } from './harness'

/** One row in the Coach chat. Built from harness events, saved with the session. */
export type ChatItem =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; text: string }
  | { kind: 'tool'; id: string; label: string; detail: string; status: 'running' | 'done' | 'error' }
  | { kind: 'notice'; id: string; text: string; tone: 'error' }
  | { kind: 'card'; id: string; card: Card }

/**
 * Fold one harness event into the chat. Shared by the main process (which
 * saves the chat) and the panel (which shows it), so both always agree.
 */
export function applyEvent(items: ChatItem[], e: HarnessEvent, makeId: () => string): ChatItem[] {
  switch (e.type) {
    case 'user':
      return [...items, { kind: 'user', id: e.id, text: e.text }]
    case 'assistant_start':
      return [...items, { kind: 'assistant', id: e.id, text: '' }]
    case 'text':
      return items.map((x) => (x.kind === 'assistant' && x.id === e.id ? { ...x, text: x.text + e.delta } : x))
    case 'assistant_end':
      // Drop replies that only called tools and said nothing.
      return items.filter((x) => !(x.kind === 'assistant' && x.id === e.id && x.text.trim() === ''))
    case 'tool': {
      const existing = items.find((x) => x.kind === 'tool' && x.id === e.id)
      if (!existing) return [...items, { kind: 'tool', id: e.id, label: e.label, detail: e.detail, status: e.status }]
      return items.map((x) =>
        x.kind === 'tool' && x.id === e.id ? { ...x, status: e.status, detail: e.detail || x.detail } : x
      )
    }
    case 'card':
      return [...items, { kind: 'card', id: e.id, card: e.card }]
    case 'error':
      return [...items, { kind: 'notice', id: makeId(), tone: 'error', text: e.message }]
    default:
      return items
  }
}

/** A short title from the first thing the learner asked. */
export function titleFrom(text: string): string {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length > 48 ? `${one.slice(0, 45).trimEnd()}…` : one
}

/**
 * Which question cards are answered, and which one can still be answered.
 * A learner message answers only the last question before it, and only when it is one of that card's options
 * (a click): anything typed stays a normal chat message. Questions the coach asked earlier in the same turn were
 * never answered and stay closed. Only the latest question, with nothing sent after it, is open.
 */
export function questionStates(items: readonly ChatItem[]): Map<string, { answer?: string; answerIndex?: number; open: boolean }> {
  const out = new Map<string, { answer?: string; answerIndex?: number; open: boolean }>()
  let pending: string | null = null
  items.forEach((item, i) => {
    if (item.kind === 'card' && cardQuestion(item.card)) {
      if (pending) out.set(pending, { open: false })
      pending = item.id
    } else if (item.kind === 'user' && pending) {
      const card = items.find((x) => x.id === pending && x.kind === 'card')
      const asked = card?.kind === 'card' ? cardQuestion(card.card) : null
      const clicked = !!asked && asked.options.includes(item.text)
      out.set(pending, clicked ? { answer: item.text, answerIndex: i, open: false } : { open: false })
      pending = null
    } else if (item.kind === 'user') {
      pending = null
    }
  })
  if (pending) out.set(pending, { open: true })
  return out
}

/** Split the chat into the learner's messages and the coach's turns (everything between two learner messages). */
export function coachTurns(items: readonly { kind: string }[]): Array<{ from: number; to: number; user: boolean }> {
  const out: Array<{ from: number; to: number; user: boolean }> = []
  items.forEach((item, i) => {
    const user = item.kind === 'user'
    const last = out.at(-1)
    if (!user && last && !last.user) last.to = i + 1
    else out.push({ from: i, to: i + 1, user })
  })
  return out
}

/** A chat item that is an animation card: the one rule for "this session has an animation". */
export function isAnimationCard(item: ChatItem): item is { kind: 'card'; id: string; card: Extract<Card, { kind: 'animation' }> } {
  return item.kind === 'card' && item.card.kind === 'animation'
}

/** Every animation the coach showed in this session, oldest first, for the Visualize tab. */
export function animationsFromChat(items: readonly ChatItem[]): Array<{ id: string; card: Extract<Card, { kind: 'animation' }> }> {
  return items.filter(isAnimationCard).map((item) => ({ id: item.id, card: item.card }))
}

/**
 * Tabs locked for a session: an idea has no folder, so no Map; Visualize opens once the coach has shown an animation
 * (regression: it stayed greyed out, hiding the session's example animations).
 */
export function lockedSections(isIdea: boolean, items: readonly ChatItem[]): Array<'visualize' | 'map'> {
  if (!isIdea) return []
  return items.some(isAnimationCard) ? ['map'] : ['visualize', 'map']
}
