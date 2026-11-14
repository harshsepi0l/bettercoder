import type { AssistantMessage, Message } from '@earendil-works/pi-ai'
import { StreamGuard } from '../core/guard'
import { REWRITE_REQUEST, TOOL_TEXT_REQUEST, VISUALIZE_NUDGE, type CoachIntent } from './prompts'
import { COACH_MODES, type CoachMode } from '../../shared/harness'

/**
 * Per-turn state, worked out from the stored transcript before every request (restart-safe): the button intent,
 * redo counts, read budget, and whether a reply typed a tool name or contained code.
 */
export const MAX_REWRITES = 2
export const MAX_TOOL_CALLS_PER_MESSAGE = 8
export const MAX_TOOL_RESULT_CHARS = 12000
/** Messages BetterCoder adds to steer the model. Never shown to the learner. */
export const HIDDEN_PREFIX = '[BetterCoder'
export const READ_TOOLS = new Set(['list_files', 'read_file', 'search', 'project_outline'])
export const INTENTS = new Set<CoachIntent>(['visualize', 'stuck', 'where', 'next', 'task'])

/**
 * A button's intent travels with the input as a small machine tag (the learner
 * never sees it). Reading it back is parsing our own markup, not guessing words.
 */
export const INTENT_TAG = /\n?<bc-intent>(\w+)<\/bc-intent>\s*$/
export function withIntent(text: string, intent: CoachIntent): string {
  return `${text}\n<bc-intent>${intent}</bc-intent>`
}
export function readIntent(text: string): CoachIntent | null {
  const m = INTENT_TAG.exec(text)
  return m && INTENTS.has(m[1] as CoachIntent) ? (m[1] as CoachIntent) : null
}
/** The pane's mode travels the same way, before any intent tag: `<bc-mode>map</bc-mode>`. Chat sends none. */
export const MODE_TAG = /\n?<bc-mode>(\w+)<\/bc-mode>\s*$/
export function withMode(text: string, mode: CoachMode | undefined): string {
  return mode && mode !== 'chat' ? `${text}\n<bc-mode>${mode}</bc-mode>` : text
}
export function readMode(text: string): CoachMode | null {
  const m = MODE_TAG.exec(text.replace(INTENT_TAG, ''))
  return m && COACH_MODES.includes(m[1] as CoachMode) ? (m[1] as CoachMode) : null
}
/** The learner's words alone: the intent and mode tags taken off. */
export function stripIntent(text: string): string {
  return text.replace(INTENT_TAG, '').replace(MODE_TAG, '')
}

/** What has happened since the learner's latest message, worked out from the transcript itself. */
export interface TurnState {
  intent: CoachIntent | null
  /** The pane's mode when they sent it (null: Chat). */
  mode: CoachMode | null
  rewrites: number
  /** Hidden redos because a reply typed a tool's name instead of calling it. */
  toolRetries: number
  readCalls: number
  /** A whiteboard was drawn since their message. */
  drew: boolean
  asked: boolean
  nudged: boolean
}

export function turnState(messages: readonly Message[]): TurnState {
  let last = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role === 'user' && !textOf(m.content).startsWith(HIDDEN_PREFIX)) {
      last = i
      break
    }
  }
  const state: TurnState = { intent: null, mode: null, rewrites: 0, toolRetries: 0, readCalls: 0, drew: false, asked: false, nudged: false }
  if (last === -1) return state
  state.intent = readIntent(textOf(messages[last].content))
  state.mode = readMode(textOf(messages[last].content))
  for (const m of messages.slice(last + 1)) {
    if (m.role === 'user') {
      const t = textOf(m.content)
      if (t === REWRITE_REQUEST) state.rewrites++
      if (t === TOOL_TEXT_REQUEST) state.toolRetries++
      if (t === VISUALIZE_NUDGE) state.nudged = true
    } else if (m.role === 'assistant') {
      for (const c of m.content) if (c.type === 'toolCall' && READ_TOOLS.has(c.name)) state.readCalls++
    } else if (m.role === 'toolResult' && !m.isError) {
      if (m.toolName === 'draw_board') state.drew = true
      if (m.toolName === 'ask_question' || (m.toolName === 'show_step' && (m.details as { question?: unknown } | undefined)?.question)) state.asked = true
    }
  }
  return state
}

/** This turn should be drawn: the Visualize button, or any message sent in Visualize mode. */
export function isDrawing(t: TurnState): boolean {
  return t.intent === 'visualize' || t.mode === 'visualize'
}

export function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map((c) => (c && typeof c === 'object' && (c as { type?: string }).type === 'text' ? String((c as { text?: string }).text ?? '') : '')).join('')
}


/**
 * Tool names never belong in reply text; models sometimes type one instead of calling it.
 * Only BetterCoder's own names: read_file or list_files may well be functions in the learner's code.
 */
export const CARD_TOOL_NAMES = ['ask_question', 'show_diagram', 'point_to_code', 'show_step', 'explain_concept', 'show_steps', 'show_pseudocode', 'draw_board', 'animate_code', 'animate_example', 'project_outline', 'note_skill', 'track_progress', 'set_task']
export const TOOL_NAME_WORD = new RegExp(`\\S*(?:${CARD_TOOL_NAMES.join('|')})\\S*`, 'g')
export const MAX_TOOL_RETRIES = 1

/** A reply that typed a tool's name but called no tool. */
export function typedToolName(message: { content: unknown }): boolean {
  const content = Array.isArray(message.content) ? message.content : []
  if (content.some((c) => c && typeof c === 'object' && (c as { type?: string }).type === 'toolCall')) return false
  const text = textOf(message.content)
  return CARD_TOOL_NAMES.some((n) => text.includes(n))
}

/** The reply without any word that contains a tool name ("monask_question"). */
export function withoutToolNames(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(TOOL_NAME_WORD, '').trimEnd())
    .filter((line, i, all) => line.trim() !== '' || (i > 0 && all[i - 1].trim() !== ''))
    .join('\n')
    .trim()
}

export function hasCode(text: string): boolean {
  return StreamGuard.clean(text).removed > 0
}


/** A question card, or a step card that ends with a question: either waits for the learner. */
export function asksQuestion(message: AssistantMessage): boolean {
  return message.content.some(
    (c) => c.type === 'toolCall' && (c.name === 'ask_question' || (c.name === 'show_step' && !!(c.arguments as { question?: unknown })?.question))
  )
}
