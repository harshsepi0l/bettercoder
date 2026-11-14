/** Channel names and payloads shared by main, preload and renderer. */
export const IPC = {
  setPinned: 'window:set-pinned',
  setTheme: 'window:set-theme'
} as const

export interface ProjectInfo {
  root: string
  name: string
  /** Stacks and languages found, most relevant first, e.g. ["Python"] or ["C# / .NET"]. */
  stacks: string[]
  /** Manifest files found at the top level, e.g. "OrderApi.sln". */
  manifests: string[]
  /** Languages counted from file extensions (dependency and build folders skipped). */
  languages: Array<{ name: string; files: number }>
  /** Files looked at (capped for very large folders). */
  fileCount: number
  git: { branch: string | null } | null
  /**
   * Set when the learner opened individual files instead of a folder: paths
   * relative to root (their common parent). The coach can see only these.
   */
  files?: string[]
  /**
   * What the learner set out to build, for projects started from an idea. While no
   * folder is linked yet, root is '' and the coach has no file tools.
   */
  idea?: string
}

export interface BetterCoderApi {
  /** Same values as Node's process.platform. */
  platform: 'aix' | 'android' | 'darwin' | 'freebsd' | 'haiku' | 'linux' | 'openbsd' | 'sunos' | 'win32' | 'cygwin' | 'netbsd'
  setPinned(pinned: boolean): Promise<boolean>
  /** The theme on screen changed: the window's own colours and VS Code's theme follow. */
  setTheme(theme: 'dark' | 'light'): Promise<void>
}
