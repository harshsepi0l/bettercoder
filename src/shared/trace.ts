/**
 * A recorded run of the learner's own code, step by step, for the animator.
 * Produced by actually running the code (Python first) in a sandbox.
 */

export type TraceValue =
  | { t: 'none' }
  | { t: 'bool'; v: boolean }
  | { t: 'num'; v: number | string }
  | { t: 'str'; v: string }
  | { t: 'list'; kind: 'list' | 'tuple' | 'set'; items: TraceValue[]; more?: number; id: string; label?: string }
  | { t: 'dict'; entries: Array<[TraceValue, TraceValue]>; more?: number; id: string }
  | { t: 'obj'; cls: string; fields: Array<[string, TraceValue]>; id: string }
  | { t: 'func'; name: string }
  | { t: 'repr'; v: string }

export interface TraceFrame {
  /** Function name; "scenario" for the variables the scenario created; "top level" for a script's or notebook's globals. */
  func: string
  locals: Array<[string, TraceValue]>
}

export interface TraceStep {
  event: 'line' | 'call' | 'return' | 'exception'
  /** File relative to the project root. */
  file: string
  line: number
  func: string
  /** Innermost frame last. The first frame is the scenario's own variables. */
  frames: TraceFrame[]
  /** Everything printed so far. */
  output: string
  returnValue?: TraceValue
  exception?: string
  /** Which scenario step (0-based) this belongs to. */
  scenarioStep: number
}

/** One call in a scenario: built and run by BetterCoder, never written as code by the coach. */
export interface ScenarioCall {
  /** A name from the learner's file, optionally dotted: "TodoList", "todos.add", "remove_item". */
  call: string
  /** Plain JSON values only. */
  args: unknown[]
  /** Keep the result under this name for later calls ("todos"). */
  assign?: string
}

export interface Trace {
  language: 'python'
  /** The file being shown, relative to the project root. */
  file: string
  /** Its source lines (the learner's own code, read from disk). */
  source: string[]
  /** Each scenario call in plain words. */
  scenario: string[]
  steps: TraceStep[]
  /** An example the coach wrote to show an idea: its code is never sent to the window (`source` is empty). */
  example?: true
  /** Set when the run stopped early: step limit, timeout, or an error outside the steps. */
  stopped?: string
}
