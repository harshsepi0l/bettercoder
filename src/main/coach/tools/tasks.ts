import { Type } from 'typebox'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import { isCodeLine } from '../../core/guard'

export const TASK_TOOL = 'set_task'

/** What set_task hands the session's tasks (services/tasks.ts). Throws when the task can't be saved. */
export type SetTask = (task: { id?: string; title: string; doneWhen: string; answer: string }) => { id: string }

/**
 * Tasks: the coach adds one of the learner's tasks, or writes the check for one they added. A task is done only when
 * their own run prints the coach's answer, which the app compares itself (core/task-check.ts). Hidden from the chat;
 * the panel draws the tasks.
 */
export function createTaskTool(setTask: SetTask): AgentTool<any> {
  const Params = Type.Object({
    id: Type.Optional(Type.String({ maxLength: 8, description: 'An existing task\'s id ("t3") to write or change its check; leave out to add a new task' })),
    title: Type.String({ minLength: 2, maxLength: 60, description: 'Short, in plain words: "Multiply too", "Say no to dividing by 0"' }),
    done_when: Type.String({
      minLength: 5,
      maxLength: 160,
      description: 'In plain words, what they run and type: "Run it with 7, 5 and *: it prints the answer". Never code, never the answer.'
    }),
    answer: Type.String({
      minLength: 1,
      maxLength: 80,
      description: 'YOUR answer: the exact number or short text their run must print for those inputs ("35", "Cannot divide by 0"). Sealed: the learner sees it only once their run prints it.'
    })
  })
  const tool: AgentTool<typeof Params> = {
    name: TASK_TOOL,
    label: 'Task',
    description:
      "Add one of the learner's tasks, or (with id) write the check for a task they added (marked WAITING). Every task must be checkable by running their program: done_when names the inputs to type, answer is what it must then print. Work the answer out carefully; pick inputs whose answer differs from every input. If no run could show a task (\"make it cleaner\"), give it a title and check that a run can show. Never reveal the answer. Never mention this tool; call it alongside your reply.",
    parameters: Params,
    execute: async (_id, p) => {
      for (const [name, text] of [['title', p.title], ['done_when', p.done_when]] as const) {
        if (isCodeLine(text)) throw new Error(`${name} looks like code. Say it in plain words.`)
      }
      const saved = setTask({ ...(p.id ? { id: p.id.trim() } : {}), title: p.title, doneWhen: p.done_when, answer: p.answer })
      return { content: [{ type: 'text' as const, text: `Saved as ${saved.id}.` }], details: undefined, terminate: true }
    }
  }
  return tool as AgentTool<any>
}
