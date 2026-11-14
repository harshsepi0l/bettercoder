import { Type } from 'typebox'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import { isCodeLine } from '../../core/guard'

export const TASK_TOOL = 'set_task'

/** What set_task hands the session's tasks (services/tasks.ts). Throws when the task can't be saved. */
export type SetTask = (task: { id?: string; title: string; doneWhen: string; answer: string; steps?: string[] }) => { id: string }

/**
 * Tasks: the coach adds one of the learner's tasks, or writes the check for one they added. A task is done only when
 * their own run prints the coach's answer, which the app compares itself (core/task-check.ts). Hidden from the chat;
 * the panel draws the tasks.
 */
export function createTaskTool(setTask: SetTask): AgentTool<any> {
  const Params = Type.Object({
    id: Type.Optional(Type.String({ maxLength: 8, description: 'An existing task\'s id ("t3") to write or change its check; leave out to add a new task' })),
    title: Type.String({ minLength: 2, maxLength: 60, description: 'Short, in plain words: "Multiply too", "Say no to dividing by 0"' }),
    steps: Type.Optional(
      Type.Array(Type.String({ minLength: 2, maxLength: 60 }), {
        minItems: 2,
        maxItems: 6,
        description:
          'The plan, in 2-6 small steps, short and in plain words ("Try to turn the text into a number", "Act on whether it worked"). Each becomes a show_step card with task_id, step_number and checks; the task is done when every step\'s Check passes. Prefer steps.'
      })
    ),
    done_when: Type.Optional(
      Type.String({
        minLength: 5,
        maxLength: 160,
        description: 'Without steps: in plain words, what they run and type: "Run it with 7, 5 and *: it prints the answer". Never code, never the answer.'
      })
    ),
    answer: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 80,
        description: 'Without steps: YOUR answer, the exact number their run must print for those inputs ("35"). Sealed: the learner sees it only once their run prints it.'
      })
    )
  })
  const tool: AgentTool<typeof Params> = {
    name: TASK_TOOL,
    label: 'Task',
    description:
      "Add one of the learner's tasks, or (with id) write the plan or check for a task they added (marked WAITING). Give its steps (the plan); then teach one step at a time with show_step (task_id, step_number, checks). A small task with no steps needs done_when and answer: the inputs to type, and the number it must then print. Every task must be checkable by running their program. Never reveal an answer. Never mention this tool; call it alongside your reply.",
    parameters: Params,
    execute: async (_id, p) => {
      for (const [name, text] of [['title', p.title], ['done_when', p.done_when ?? ''], ...(p.steps ?? []).map((s) => ['a step', s] as const)] as const) {
        if (isCodeLine(text)) throw new Error(`${name} looks like code. Say it in plain words.`)
      }
      if (!p.steps?.length && (!p.done_when || !p.answer)) throw new Error('Give the task its steps, or done_when and answer.')
      const saved = setTask({ ...(p.id ? { id: p.id.trim() } : {}), title: p.title, doneWhen: p.done_when ?? '', answer: p.answer ?? '', ...(p.steps?.length ? { steps: p.steps } : {}) })
      return { content: [{ type: 'text' as const, text: `Saved as ${saved.id}.` }], details: undefined, terminate: true }
    }
  }
  return tool as AgentTool<any>
}
