import type { TerminalEvent } from './code'

/**
 * BetterCoder ↔ its built-in VS Code. The BetterCoder extension inside it connects to the app over a local socket
 * and reports where the learner is; the app sends back where to write (a marker) and the step's pseudocode, which the
 * editor shows as faded text that is never written into their file, plus ▶ Run's terminal and problems.
 */

export const IDE_IPC = {
  state: 'ide:state',
  getState: 'ide:get-state',
  openFolder: 'ide:open-folder',
  openInEditor: 'ide:open-in-editor',
  /** main → renderer: show the Code tab. */
  showCode: 'ide:show-code'
} as const

/** How the learner seems to be doing, read from editor activity (never from what they type to the coach). */
export type Mood = 'stuck' | 'ok' | 'flowing'

/** One task of what they are building, as the coach judged it from their code. */
export interface TaskProgress {
  title: string
  /** 0-100. */
  percent: number
}

/** What the panel shows about the editor link. */
export interface IdeView {
  /** An editor is connected. */
  linked: boolean
  /** Its name ("VS Code", "Cursor"). */
  ide: string | null
  /** The editor's folder, when it is not inside the open project (the panel offers to open it). */
  otherFolder: string | null
  /** The open file, relative to the project, when it is inside it. */
  file: string | null
  line: number | null
  mood: Mood | null
  /** Why, in a few words ("Same error for 2 min"). */
  why: string
  tasks: TaskProgress[]
  /** The learner typed a line for every pseudocode line of the current step. */
  stepDone: boolean
  /** How many pseudocode lines of the current step they have typed so far. */
  typed: number
}

export const NO_IDE: IdeView = { linked: false, ide: null, otherFolder: null, file: null, line: null, mood: null, why: '', tasks: [], stepDone: false, typed: 0 }

export interface IdeApi {
  getState(): Promise<IdeView>
  onState(listener: (view: IdeView) => void): () => void
  /** Open the editor's folder as a project (when it is not the open one). */
  openFolder(): Promise<void>
  /**
   * Open a file of the open project (relative path, optional line) in the Code tab's VS Code, and show the Code tab.
   * Only opens; nothing is written.
   */
  openInEditor(path: string, line?: number): Promise<void>
  /** The app wants the Code tab in front (after "Open in editor"). */
  onShowCode(listener: () => void): () => void
}

export interface IdeDiagnostic {
  line: number
  col: number
  severity: 'error' | 'warning'
  code?: string
  message: string
}

/** Messages from the editor extension: one JSON object per line. */
export type FromIde =
  | { type: 'hello'; ide: string; folders: string[] }
  | { type: 'editor'; file: string | null; line: number; col: number }
  | { type: 'doc'; file: string; text: string }
  | { type: 'diagnostics'; file: string; items: IdeDiagnostic[] }
  | { type: 'step_done'; stepId: string }
  /** How many pseudocode lines of the marked step they have typed so far (sent as it changes). */
  | { type: 'step_typed'; stepId: string; n: number }
  // ▶ Run from the editor (the learner pressed it there): the app runs the file in its own terminal and streams it
  // back. Only the learner's keystrokes in that terminal come this way; the coach has no part in it.
  | { type: 'run'; file: string; cols: number; rows: number }
  | { type: 'term_input'; id: string; data: string }
  | { type: 'term_resize'; id: string; cols: number; rows: number }
  | { type: 'term_stop'; id: string }

/** The run and terminal messages from the editor: commands for the Code area, not part of the editor's snapshot. */
export type IdeCommand = Extract<FromIde, { type: 'run' | 'term_input' | 'term_resize' | 'term_stop' }>

/** Messages to the editor extension. */
export type ToIde =
  /** Where to write: a marker on `line` of `file` (absolute), and the step's pseudocode shown faded, one line at a time. */
  | { type: 'anchor'; stepId: string; file: string; line: number; ghost: string[] }
  | { type: 'clear' }
  | { type: 'status'; text: string; tooltip: string }
  /** A run started from the editor: its output, its end (with the plain-words line), or why it could not start. */
  | { type: 'term'; event: TerminalEvent }
  | { type: 'run_error'; file: string; message: string; install?: { name: string; url: string } }
  /** "Open in editor" (from the Map or a step card): show this file at this line (absolute; a notebook's line is in the coach's view). */
  | { type: 'open'; file: string; line: number | null }
  /** Problems the last run found, to underline (file absolute; empty items clear them). */
  | { type: 'problems'; file: string; items: IdeDiagnostic[] }
