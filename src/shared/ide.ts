/**
 * BetterCoder ↔ IDE. A small extension in the learner's editor (VS Code, Cursor, Windsurf) connects to the app
 * over a local socket and reports where they are; the app sends back where to write (a marker) and the step's
 * pseudocode, which the editor shows as faded text that is never written into their file.
 */

export const IDE_IPC = {
  state: 'ide:state',
  getState: 'ide:get-state',
  openFolder: 'ide:open-folder',
  openInEditor: 'ide:open-in-editor'
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
}

export const NO_IDE: IdeView = { linked: false, ide: null, otherFolder: null, file: null, line: null, mood: null, why: '', tasks: [], stepDone: false }

export interface IdeApi {
  getState(): Promise<IdeView>
  onState(listener: (view: IdeView) => void): () => void
  /** Open the editor's folder as a project (when it is not the open one). */
  openFolder(): Promise<void>
  /**
   * Open a file of the open project (relative path, optional line), or the project itself (no path), in the
   * learner's editor. Only opens; nothing is written.
   */
  openInEditor(path?: string, line?: number): Promise<void>
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

/** Messages to the editor extension. */
export type ToIde =
  /** Where to write: a marker on `line` of `file` (absolute), and the step's pseudocode shown faded, one line at a time. */
  | { type: 'anchor'; stepId: string; file: string; line: number; ghost: string[] }
  | { type: 'clear' }
  | { type: 'status'; text: string; tooltip: string }
