/**
 * "Bring your VS Code": the learner's own editor setup (VS Code, Cursor, Windsurf, VSCodium) copied into BetterCoder's
 * built-in VS Code: settings, keyboard shortcuts, snippets and extensions (from Open VSX). AI extensions and AI
 * settings are always left out: the only AI here is the coach, and it never writes code.
 */

export type EditorSourceId = 'vscode' | 'insiders' | 'cursor' | 'windsurf' | 'vscodium'

/** An editor found on this computer. */
export interface EditorSource {
  id: EditorSourceId
  name: string
  extensions: number
  hasSettings: boolean
}

/** What happens to one of their extensions. */
export type ExtensionFate =
  /** Installed from Open VSX (or already here). */
  | { kind: 'install'; id: string }
  /** Microsoft-only (or the editor's own): an open one that does the same is installed instead. */
  | { kind: 'swap'; id: string; to: string; why: string }
  /** AI that writes code: never installed. */
  | { kind: 'blocked'; id: string; why: string }
  /** Not on Open VSX, or something BetterCoder's VS Code can't use (remote, Live Share). */
  | { kind: 'missing'; id: string; why: string }

export interface ImportPlan {
  source: EditorSource
  /** Their theme, font and tab size, for the summary line. */
  look: { theme: string | null; font: string | null; fontSize: number | null; tabSize: number | null }
  /** How many of their settings come over, and which were left out (AI, or things BetterCoder manages). */
  settings: { kept: number; dropped: string[] }
  keybindings: number
  snippets: number
  extensions: ExtensionFate[]
}

export interface ImportResult {
  installed: string[]
  failed: string[]
}

export interface EditorImportApi {
  /** Whether the built-in VS Code is on, and the editors found on this computer. */
  sources(): Promise<{ enabled: boolean; sources: EditorSource[] }>
  plan(source: EditorSourceId): Promise<ImportPlan>
  /** Copy it over (VS Code restarts if it is open). */
  run(source: EditorSourceId): Promise<ImportResult>
  /** The built-in VS Code restarted (after an import): the Code tab reloads it. */
  onRestarted(listener: () => void): () => void
}

export const EDITOR_IMPORT_IPC = {
  sources: 'editor-import:sources',
  plan: 'editor-import:plan',
  run: 'editor-import:run',
  restarted: 'editor-import:restarted'
} as const
