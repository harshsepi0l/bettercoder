import type { EditorSource, ExtensionFate, ImportPlan } from '../../shared/editor-import'
import { isAiExtension, isAiSetting, type ExtensionManifest } from './ai-extensions'
import { parseJsonc } from './jsonc'

/**
 * "Bring your VS Code", as pure rules: what of the learner's own editor setup comes into BetterCoder's VS Code, what is
 * swapped for an open equivalent, and what is left out. Reading their files and installing is adapters/editor-import.ts.
 */

/**
 * Settings BetterCoder always sets, whatever they had (put back on every start, and by the extension the moment one
 * changes): no AI, nothing the editor types in for them (names-only autocomplete), no telemetry, the app's layout.
 */
export const FORCED_SETTINGS: Record<string, unknown> = {
  'chat.disableAIFeatures': true,
  'chat.commandCenter.enabled': false,
  'editor.inlineSuggest.enabled': false,
  // Type hints drawn inline (basedpyright, C#) go into the file on a double-click: the editor would write code.
  'editor.inlayHints.enabled': 'off',
  // Autocomplete offers names only: no snippets (a `for` template is code written for them), nothing on Tab.
  'editor.snippetSuggestions': 'none',
  'editor.suggest.showSnippets': false,
  'editor.tabCompletion': 'off',
  'editor.suggest.preview': false,
  'emmet.showExpandedAbbreviation': 'never',
  'emmet.triggerExpansionOnTab': false,
  'python.analysis.completeFunctionParens': false,
  'telemetry.telemetryLevel': 'off',
  'extensions.ignoreRecommendations': true,
  'update.mode': 'none',
  'security.workspace.trust.enabled': false,
  // The app has its own tabs and title bar.
  'window.commandCenter': false,
  'workbench.layoutControl.enabled': false,
  'workbench.navigationControl.enabled': false,
  'workbench.secondarySideBar.defaultVisibility': 'hidden'
}

/** Settings sections BetterCoder manages itself (or that make no sense inside it): not brought over. */
const MANAGED = ['extensions', 'update', 'telemetry', 'remote', 'security.workspace', 'settingssync', 'sync', 'workbench.startupeditor', 'window.title', 'window.titlebarstyle', 'window.menubarvisibility']
/** Keys that look like secrets (tokens, keys, passwords) never come over. */
const SECRET = /(token|api[_-]?key|apikey|secret|password|passwd|credential)/i

/** Microsoft-only extensions (and the editors' own forks of them) → an open one on Open VSX that does the same. */
export const SWAPS: Record<string, { to: string; why: string }> = {
  'ms-python.vscode-pylance': { to: 'detachhead.basedpyright', why: 'Pylance is Microsoft-only; basedpyright does the same' },
  'anysphere.cursorpyright': { to: 'detachhead.basedpyright', why: 'Cursor’s own; basedpyright does the same' },
  'ms-dotnettools.csdevkit': { to: 'muhammad-sammy.csharp', why: 'C# Dev Kit is Microsoft-only; the open C# extension instead' },
  'ms-dotnettools.csharp': { to: 'muhammad-sammy.csharp', why: 'Microsoft’s build is Microsoft-only; the open C# extension instead' },
  'anysphere.csharp': { to: 'muhammad-sammy.csharp', why: 'Cursor’s own; the open C# extension instead' },
  'ms-vscode.cpptools': { to: 'llvm-vs-code-extensions.vscode-clangd', why: 'Microsoft-only; clangd does the same' },
  'ms-vscode.cpptools-extension-pack': { to: 'llvm-vs-code-extensions.vscode-clangd', why: 'Microsoft-only; clangd does the same' },
  'anysphere.cpptools': { to: 'llvm-vs-code-extensions.vscode-clangd', why: 'Cursor’s own; clangd does the same' }
}

/** Extensions that can't work inside BetterCoder's VS Code, whatever the gallery has. */
function unusable(id: string): string | null {
  if (id === 'bettercoder.bettercoder-ide') return 'Already built in'
  if (/^(ms-vscode-remote|anysphere\.remote|ms-vscode\.remote)/.test(id)) return 'Remote development isn’t available here'
  if (id.startsWith('ms-vsliveshare.')) return 'Live Share is Microsoft-only'
  if (id === 'ms-vscode.vscode-speech') return 'Voice for chat, which is off here'
  return null
}

export interface SourceExtension {
  id: string
  manifest?: ExtensionManifest | null
}

/**
 * What happens to each of their extensions. `onOpenVsx(id)` says whether Open VSX has it (null: unknown, try anyway).
 * A swap target is listed once, however many of theirs it replaces.
 */
export function planExtensions(theirs: readonly SourceExtension[], onOpenVsx: (id: string) => boolean | null): ExtensionFate[] {
  const out: ExtensionFate[] = []
  const swapTargets = new Set<string>()
  for (const { id: raw, manifest } of theirs) {
    const id = raw.toLowerCase()
    if (isAiExtension(id, manifest)) {
      out.push({ kind: 'blocked', id, why: 'It writes code for you. Here, you write it.' })
      continue
    }
    const skip = unusable(id)
    if (skip) {
      out.push({ kind: 'missing', id, why: skip })
      continue
    }
    const swap = SWAPS[id]
    if (swap) {
      out.push({ kind: 'swap', id, to: swap.to, why: swap.why })
      swapTargets.add(swap.to)
      continue
    }
    out.push(onOpenVsx(id) === false ? { kind: 'missing', id, why: 'Not on Open VSX' } : { kind: 'install', id })
  }
  // A swap target they already had is installed once, by the swap.
  return out.filter((f) => !(f.kind === 'install' && swapTargets.has(f.id)))
}

/** The extension ids to install for a plan (swap targets included, each once). */
export function toInstall(plan: readonly ExtensionFate[]): string[] {
  const ids = plan.flatMap((f) => (f.kind === 'install' ? [f.id] : f.kind === 'swap' ? [f.to] : []))
  return [...new Set(ids)]
}

/** Their settings as BetterCoder keeps them: AI, secrets and things it manages left out. */
export function importSettings(text: string | null): { kept: Record<string, unknown>; dropped: string[] } {
  const parsed = text ? parseJsonc(text) : null
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { kept: {}, dropped: [] }
  const kept: Record<string, unknown> = {}
  const dropped: string[] = []
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    const k = key.toLowerCase()
    // Language blocks ("[python]": {...}) are kept, with the same rules inside.
    if (/^\[.+\]$/.test(key) && value && typeof value === 'object' && !Array.isArray(value)) {
      const inner = importSettings(JSON.stringify(value))
      if (Object.keys(inner.kept).length) kept[key] = inner.kept
      dropped.push(...inner.dropped.map((d) => `${key} ${d}`))
      continue
    }
    if (isAiSetting(key) || SECRET.test(key) || MANAGED.some((m) => k === m || k.startsWith(`${m}.`)) || key in FORCED_SETTINGS) {
      dropped.push(key)
      continue
    }
    kept[key] = value
  }
  return { kept, dropped }
}

/** Their keyboard shortcuts, minus the ones for AI commands. */
export function importKeybindings(text: string | null): unknown[] {
  const parsed = text ? parseJsonc(text) : null
  if (!Array.isArray(parsed)) return []
  return parsed.filter((b) => {
    if (!b || typeof b !== 'object') return false
    const command = String((b as Record<string, unknown>).command ?? '').replace(/^-/, '').toLowerCase()
    return command !== '' && !/^(github\.copilot|copilot|inlinechat|workbench\.action\.chat|chat\.|editor\.action\.inlinesuggest|claude-code|continue\.|codeium\.|cody\.)/.test(command)
  })
}

/** The settings file BetterCoder's VS Code starts from: its defaults, then theirs, then the rules that always win. */
export function mergedSettings(defaults: Record<string, unknown>, theirs: Record<string, unknown>): Record<string, unknown> {
  return { ...defaults, ...theirs, ...FORCED_SETTINGS }
}

/**
 * Their colour theme, if it can come too: built in to VS Code, or from one of their extensions that is installed. A
 * theme whose extension stays behind is dropped (BetterCoder Dark stays), else VS Code would fall back to its plain
 * default. Returns the settings to keep and the theme left behind, if any.
 */
export function withAvailableTheme(
  kept: Record<string, unknown>,
  theirs: readonly SourceExtension[],
  extensions: readonly ExtensionFate[]
): { kept: Record<string, unknown>; themeLeft: string | null } {
  const theme = kept['workbench.colorTheme']
  if (typeof theme !== 'string') return { kept, themeLeft: null }
  const from = theirs.find((e) => {
    const themes = (e.manifest?.contributes as { themes?: Array<{ id?: string; label?: string }> } | undefined)?.themes
    return Array.isArray(themes) && themes.some((t) => t.label === theme || t.id === theme)
  })
  if (!from) return { kept, themeLeft: null } // built in to VS Code
  const fate = extensions.find((f) => f.id === from.id)
  if (fate?.kind === 'install') return { kept, themeLeft: null }
  const { ['workbench.colorTheme']: _theme, ...rest } = kept
  return { kept: rest, themeLeft: theme }
}

export function planImport(
  source: EditorSource,
  files: { settings: string | null; keybindings: string | null; snippets: number },
  extensions: ExtensionFate[],
  theirs: readonly SourceExtension[] = []
): ImportPlan {
  const read = importSettings(files.settings)
  const { kept, themeLeft } = withAvailableTheme(read.kept, theirs, extensions)
  const dropped = themeLeft ? [...read.dropped, 'workbench.colorTheme'] : read.dropped
  const str = (k: string) => (typeof kept[k] === 'string' ? (kept[k] as string) : null)
  const num = (k: string) => (typeof kept[k] === 'number' ? (kept[k] as number) : null)
  return {
    source,
    look: { theme: str('workbench.colorTheme') ?? (themeLeft ? `BetterCoder Dark (${themeLeft} isn’t on Open VSX)` : null), font: str('editor.fontFamily')?.split(',')[0].replace(/['"]/g, '').trim() || null, fontSize: num('editor.fontSize'), tabSize: num('editor.tabSize') },
    settings: { kept: Object.keys(kept).length, dropped },
    keybindings: importKeybindings(files.keybindings).length,
    snippets: files.snippets,
    extensions
  }
}
