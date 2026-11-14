/**
 * Tasks: what the learner is building, one task at a time, started by them or by the coach. A task is done only
 * when their own run prints the coach's answer (sealed: never shown until it matches). They live per session and can
 * be sent to another session.
 */

export const TASKS_IPC = {
  list: 'tasks:list',
  checkStep: 'tasks:check-step',
  changed: 'tasks:changed',
  add: 'tasks:add',
  remove: 'tasks:remove',
  check: 'tasks:check',
  send: 'tasks:send'
} as const

/** The most tasks a session keeps. */
export const MAX_TASKS = 12

import type { RunCheck, StepOfTask, StepRun } from './step-checks'

export type TaskBy = 'coach' | 'you'

/** One step of a task's plan (the coach's set_task steps); passed when its step card's Check passed. */
export interface TaskStep {
  title: string
  passed: boolean
}

/** waiting: the learner added it and the coach has not written its check yet. */
export type TaskStatus = 'waiting' | 'open' | 'done'

/** The last time they pressed Check my answer. */
export interface TaskCheck {
  at: number
  result: 'matched' | 'not_yet' | 'no_run'
  /** One plain-words line ("Your run printed 12."). */
  words: string
}

/** A task as the panel sees it: the coach's answer stays out until it matched. */
export interface TaskView {
  id: string
  title: string
  by: TaskBy
  /** What to run and type, in words ("Run it with 7, 5 and *: it prints the answer"). Empty while waiting. */
  doneWhen: string
  status: TaskStatus
  check: TaskCheck | null
  /** The coach's answer, only once theirs matched (null too for a task checked step by step). */
  answer: string | null
  /** The plan, step by step; the task's bar is the steps passed. */
  steps: TaskStep[]
}

/** Something happened to a task, for a short notification. */
export interface TaskNotice {
  kind: 'added' | 'matched' | 'not_yet' | 'no_run'
  taskId: string
  title: string
  by: TaskBy
  words: string
}

export interface TasksUpdate {
  /** The open session's id (null: none open). */
  sessionId: string | null
  tasks: TaskView[]
  /** The last Check of each checked step card, by stepKey (kept in memory for the session). */
  steps?: Record<string, StepRun>
  notice?: TaskNotice
}

/** Where Send puts the tasks: a new session in the same project, or one it already has. */
export type SendTarget = { kind: 'new' } | { kind: 'session'; sessionId: string }

export interface TasksApi {
  list(): Promise<TasksUpdate>
  onChanged(listener: (update: TasksUpdate) => void): () => void
  /** The learner's own task: it waits until the coach writes its check (send the coach the `task` intent). */
  add(title: string): Promise<void>
  remove(id: string): Promise<void>
  /** Check my answer: their last ▶ Run against the coach's answer. */
  check(id: string): Promise<void>
  /** Copy these tasks (fresh, not done) into another session of this project and open it. */
  send(ids: string[], target: SendTarget): Promise<void>
  /**
   * Check a step card: run their file once per check with its inputs typed in (shown in VS Code's ▶ Check terminal),
   * graded by fixed rules. `path`: the file the step is in (else the one open in the editor, else the last run's).
   */
  checkStep(title: string, checks: RunCheck[], path: string | null, of: StepOfTask | null): Promise<StepRun>
}
