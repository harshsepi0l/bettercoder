import type { ToolResultMessage } from '@earendil-works/pi-ai'
import { type EntryRecord } from '@earendil-works/pi-durable'
import type { Card } from '../../shared/cards'
import type { ChatItem } from '../../shared/chat'
import type { TurnUsage } from '../../shared/harness'
import { TOOL_TEXT_REQUEST } from './prompts'
import { VISUAL_TOOL_NAMES } from './tools/cards'
import { HIDDEN_PREFIX, READ_TOOLS, stripIntent, textOf, withoutToolNames, hasCode } from './turn'

/**
 * Rebuilding what the learner saw from the stored transcript: the chat items, usage, and the last marked step.
 * Used when a session is reopened.
 */
export function describeTool(name: string, args: Record<string, unknown> | undefined): { label: string; detail: string } {
  switch (name) {
    case 'read_file':
      return { label: 'Read', detail: String(args?.path ?? '') }
    case 'list_files':
      return { label: 'Listed', detail: String(args?.path ?? '.') }
    case 'search':
      return { label: 'Searched', detail: `"${String(args?.query ?? '')}"` }
    case 'animate_code':
      return { label: 'Running', detail: String(args?.file ?? '') }
    case 'animate_example':
      return { label: 'Running', detail: 'an example' }
    case 'project_outline':
      return { label: 'Outlined', detail: 'project' }
    default:
      return { label: name, detail: '' }
  }
}

/** Shows as a tool line in the chat (cards appear as cards instead). */
export function isToolLine(name: string): boolean {
  return READ_TOOLS.has(name) || name === 'animate_code' || name === 'animate_example'
}

/** The chat as the learner saw it, rebuilt from the stored transcript. */
export function itemsFromEntries(entries: readonly EntryRecord[]): ChatItem[] {
  const items: ChatItem[] = []
  const toolLines = new Map<string, number>()
  // As live: a headline repeated in the same turn is shown once.
  let lastText = ''
  // Replies that were redone because they typed a tool's name stay hidden, as they were live.
  const redone = new Set<number>()
  entries.forEach((entry, i) => {
    const m = entry.model?.[0]
    if (m?.role === 'user' && textOf(m.content) === TOOL_TEXT_REQUEST) {
      for (let j = i - 1; j >= 0; j--) {
        if (entries[j].model?.[0]?.role === 'assistant') {
          redone.add(j)
          break
        }
      }
    }
  })
  for (const [index, entry] of entries.entries()) {
    const msg = entry.model?.[0]
    if (entry.kind === 'bc.card') {
      items.push({ kind: 'card', id: String(entry.id), card: entry.data as unknown as Card })
      continue
    }
    if (entry.kind === 'bc.notice') {
      items.push({ kind: 'assistant', id: String(entry.id), text: String((entry.data as { text?: string } | undefined)?.text ?? '') })
      continue
    }
    if (!msg) continue
    if (msg.role === 'user') {
      const text = stripIntent(textOf(msg.content))
      if (text && !text.startsWith(HIDDEN_PREFIX)) {
        items.push({ kind: 'user', id: String(entry.id), text })
        lastText = ''
      }
    } else if (msg.role === 'assistant') {
      const text = withoutToolNames(textOf(msg.content).trim())
      if (text && !redone.has(index) && !hasCode(text) && text !== lastText) {
        items.push({ kind: 'assistant', id: String(entry.id), text })
        lastText = text
      }
      for (const c of msg.content) {
        if (c.type === 'toolCall' && isToolLine(c.name)) {
          const { label, detail } = describeTool(c.name, c.arguments as Record<string, unknown>)
          toolLines.set(c.id, items.length)
          items.push({ kind: 'tool', id: c.id, label, detail, status: 'done' })
        }
      }
    } else if (msg.role === 'toolResult') {
      const r = msg as ToolResultMessage
      const at = toolLines.get(r.toolCallId)
      if (at !== undefined && r.isError) items[at] = { ...(items[at] as Extract<ChatItem, { kind: 'tool' }>), status: 'error' }
      if (VISUAL_TOOL_NAMES.has(r.toolName) && !r.isError && r.details) {
        items.push({ kind: 'card', id: `card-${r.toolCallId}`, card: r.details as unknown as Card })
      }
    }
  }
  return items
}

export function sumUsage(state: { models: Record<string, { input: number; output: number; cacheRead: number; totalTokens: number }> }): TurnUsage {
  const out: TurnUsage = { input: 0, output: 0, cacheRead: 0, total: 0 }
  for (const u of Object.values(state.models ?? {})) {
    out.input += u.input
    out.output += u.output
    out.cacheRead += u.cacheRead
    out.total += u.totalTokens
  }
  return out
}

/** A step with a place in their file: the editor marks the line and shows the pseudocode there, faded. */
export interface AnchoredStep {
  id: string
  path: string
  line: number
  ghost: string[]
}

export function anchoredStep(id: string, card: Card | undefined): AnchoredStep | null {
  if (card?.kind !== 'step' || !card.anchor || card.lines.length === 0) return null
  return { id, path: card.anchor.path, line: card.anchor.line, ghost: card.lines.map((l) => l.text) }
}

/** The newest step card in a stored transcript, if it has a place (restart-safe: the marker comes back). */
export function lastStepFromEntries(entries: readonly EntryRecord[]): AnchoredStep | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const m = entries[i].model?.[0] as ToolResultMessage | undefined
    if (m?.role === 'toolResult' && m.toolName === 'show_step' && !m.isError && m.details) {
      return anchoredStep(`card-${m.toolCallId}`, m.details as unknown as Card)
    }
  }
  return null
}
