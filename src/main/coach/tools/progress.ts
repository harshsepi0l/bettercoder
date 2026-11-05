import { Type } from 'typebox'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import type { EntryRecord } from '@earendil-works/pi-durable'
import type { TaskProgress } from '../../../shared/ide'

export const PROGRESS_TOOL = 'track_progress'
export const MAX_TASKS = 6

/**
 * The progress meter: the coach records the learner's tasks and how far their code is on each. Hidden from the
 * chat; the panel draws it as a meter. Stored as the tool result, so the meter is rebuilt from the transcript.
 */
export function createProgressTool(onProgress: (tasks: TaskProgress[]) => void): AgentTool<any> {
  const Params = Type.Object({
    tasks: Type.Array(
      Type.Object({
        title: Type.String({ minLength: 2, maxLength: 50, description: 'A short name: "Read two numbers", "Print the result"' }),
        percent: Type.Integer({ minimum: 0, maximum: 100, description: 'How far THEIR code is on it, judged from the code you saw' })
      }),
      { minItems: 1, maxItems: MAX_TASKS }
    )
  })
  const tool: AgentTool<typeof Params> = {
    name: PROGRESS_TOOL,
    label: 'Progress',
    description:
      "Update the learner's progress meter: their tasks, in order, and how far their own code is on each (0-100). Call it when you first learn their tasks (from their message, an assignment file or their code), and again when their code shows progress. Judge only from code you saw. Never mention it; call it alongside your reply.",
    parameters: Params,
    execute: async (_id, p) => {
      const tasks = p.tasks.map((t) => ({ title: t.title.trim(), percent: Math.max(0, Math.min(100, Math.round(t.percent))) }))
      onProgress(tasks)
      return { content: [{ type: 'text' as const, text: 'Noted.' }], details: { tasks }, terminate: true }
    }
  }
  return tool as AgentTool<any>
}

/** The latest progress in a stored transcript (restart-safe). */
export function progressFromEntries(entries: readonly EntryRecord[]): TaskProgress[] {
  for (let i = entries.length - 1; i >= 0; i--) {
    const m = entries[i].model?.[0] as { role?: string; toolName?: string; isError?: boolean; details?: { tasks?: TaskProgress[] } } | undefined
    if (m?.role === 'toolResult' && m.toolName === PROGRESS_TOOL && !m.isError && Array.isArray(m.details?.tasks)) return m.details.tasks
  }
  return []
}
