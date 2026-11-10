/**
 * The Code tab (the built-in VS Code) and ▶ Run: types shared by main and the renderer. The learner writes their own
 * code in VS Code; the coach never writes. ▶ Run (pressed in VS Code) runs in the app's own terminal so the coach sees
 * the last run; it streams back into VS Code (see main/ipc/editor-runs.ts).
 */

/** IPC channels for the Code tab. */
export const CODE_IPC = {
  /** The address of the built-in VS Code for the open project (see VscodeFrame). */
  vscodeUrl: 'code:vscode-url'
} as const

/**
 * The built-in VS Code for the open project: `no-folder` for a project without a folder yet (an idea); `problem` when
 * it cannot open (not downloaded, did not start).
 */
export type VscodeFrame = { kind: 'ready'; url: string } | { kind: 'no-folder' } | { kind: 'problem'; message: string }

/** Problems a run found in one file, to underline (replaces what was there). */
export interface FileProblems {
  path: string
  items: Array<{ line: number; col: number; severity: 'error' | 'warning'; code?: string; message: string; source: 'run' }>
}

/** A finished (or still running) ▶ Run. */
export interface RunSummary {
  /** Its terminal. */
  id: string
  /** The file it ran, relative to the project. */
  path: string
  startedAt: number
  endedAt: number | null
  exitCode: number | null
  /** The learner stopped it. */
  stopped: boolean
  /** Everything it printed, word for word (colour codes removed), at most the last 1 MB. */
  output: string
  /** The error it ended with, if any (any language ▶ Run handles). */
  error: { type: string; message: string; path: string | null; line: number | null } | null
  /** One plain-words line about that error (never code). */
  words: string | null
}

/** A run's terminal, as it streams to VS Code's "▶ Run" terminal. */
export type TerminalEvent =
  | { type: 'data'; id: string; data: string }
  | { type: 'exit'; id: string; exitCode: number | null }
  | { type: 'run'; run: RunSummary }

/** What the renderer can do with the Code tab (window.code). */
export interface CodeApi {
  /** The built-in VS Code for the open project. */
  vscodeUrl(): Promise<VscodeFrame>
}
