import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { EditorSource, EditorSourceId, ImportPlan, ImportResult } from '../../shared/editor-import'
import type { ExtensionManifest } from '../core/ai-extensions'
import { importKeybindings, importSettings, mergedSettings, planExtensions, planImport, toInstall, withAvailableTheme, type SourceExtension } from '../core/editor-import'
import { parseJsonc } from '../core/jsonc'
import { STARTING_SETTINGS, type CodeServer } from './code-server'

/**
 * "Bring your VS Code": reads the learner's own editor setup (only their settings, shortcuts, snippets and the list of
 * extensions; never their projects or the editor's stored state) and copies it into BetterCoder's VS Code. The rules
 * for what comes over are core/editor-import.ts. The coach never sees any of it.
 */

const EDITORS: Array<{ id: EditorSourceId; name: string; folder: string; extensions: string }> = [
  { id: 'vscode', name: 'VS Code', folder: 'Code', extensions: '.vscode' },
  { id: 'cursor', name: 'Cursor', folder: 'Cursor', extensions: '.cursor' },
  { id: 'windsurf', name: 'Windsurf', folder: 'Windsurf', extensions: '.windsurf' },
  { id: 'vscodium', name: 'VSCodium', folder: 'VSCodium', extensions: '.vscode-oss' },
  { id: 'insiders', name: 'VS Code Insiders', folder: 'Code - Insiders', extensions: '.vscode-insiders' }
]

export interface EditorPaths {
  home: string
  /** Where editors keep their settings: ~/Library/Application Support (macOS), %APPDATA% (Windows), ~/.config (Linux). */
  appData: string
}

export function defaultPaths(): EditorPaths {
  const home = homedir()
  const appData =
    process.platform === 'darwin'
      ? join(home, 'Library', 'Application Support')
      : process.platform === 'win32'
        ? (process.env.APPDATA ?? join(home, 'AppData', 'Roaming'))
        : (process.env.XDG_CONFIG_HOME ?? join(home, '.config'))
  return { home, appData }
}

const userDir = (p: EditorPaths, e: (typeof EDITORS)[number]) => join(p.appData, e.folder, 'User')
const extDir = (p: EditorPaths, e: (typeof EDITORS)[number]) => join(p.home, e.extensions, 'extensions')

async function readText(path: string): Promise<string | null> {
  return readFile(path, 'utf8').catch(() => null)
}

/** Their extensions: VS Code's own list (minus ones marked removed), or the folders when there is no list. */
export async function sourceExtensions(dir: string): Promise<SourceExtension[]> {
  const list = parseJsonc((await readText(join(dir, 'extensions.json'))) ?? 'null')
  const obsolete = (parseJsonc((await readText(join(dir, '.obsolete'))) ?? '{}') ?? {}) as Record<string, unknown>
  const entries: Array<{ id: string; folder: string }> = []
  if (Array.isArray(list)) {
    for (const e of list as Array<{ identifier?: { id?: string }; relativeLocation?: string; location?: { path?: string } }>) {
      const id = e.identifier?.id
      if (!id || (e.relativeLocation && obsolete[e.relativeLocation])) continue
      entries.push({ id, folder: e.location?.path ?? join(dir, e.relativeLocation ?? '') })
    }
  } else {
    for (const name of await readdir(dir).catch(() => [] as string[])) {
      const m = /^([\w-]+\.[\w-]+?)-\d+\.\d+/.exec(name)
      if (m && !obsolete[name]) entries.push({ id: m[1], folder: join(dir, name) })
    }
  }
  const seen = new Set<string>()
  const out: SourceExtension[] = []
  for (const { id, folder } of entries) {
    const key = id.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    const manifest = parseJsonc((await readText(join(folder, 'package.json'))) ?? 'null') as ExtensionManifest | null
    out.push({ id: key, manifest })
  }
  return out.sort((a, b) => a.id.localeCompare(b.id))
}

/** The editors on this computer that have something to bring. */
export async function findSources(paths: EditorPaths = defaultPaths()): Promise<EditorSource[]> {
  const out: EditorSource[] = []
  for (const e of EDITORS) {
    const hasSettings = existsSync(join(userDir(paths, e), 'settings.json'))
    const extensions = (await sourceExtensions(extDir(paths, e))).length
    if (hasSettings || extensions > 0) out.push({ id: e.id, name: e.name, extensions, hasSettings })
  }
  return out
}

/** Their snippet files, as JSON (comments removed); files that don't parse are skipped. */
async function sourceSnippets(dir: string): Promise<Array<{ name: string; json: unknown }>> {
  const out: Array<{ name: string; json: unknown }> = []
  for (const name of await readdir(dir).catch(() => [] as string[])) {
    if (!/\.(json|code-snippets)$/i.test(name) || name.includes('/') || name.startsWith('.')) continue
    const json = parseJsonc((await readText(join(dir, name))) ?? '')
    if (json && typeof json === 'object' && !Array.isArray(json)) out.push({ name, json })
  }
  return out
}

/** Does Open VSX have this extension? Null when it can't be told (offline): the install then tries anyway. */
export type GalleryCheck = (id: string) => Promise<boolean | null>

export const openVsxHas: GalleryCheck = async (id) => {
  const [ns, name] = id.split('.')
  if (!ns || !name) return false
  try {
    const res = await fetch(`https://open-vsx.org/api/${encodeURIComponent(ns)}/${encodeURIComponent(name)}`, { signal: AbortSignal.timeout(8000) })
    if (res.status === 404) return false
    if (!res.ok) return null
    const body = (await res.json()) as { error?: string }
    return !body.error
  } catch {
    return null
  }
}

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i])
      }
    })
  )
  return out
}

export class EditorImporter {
  private gallery = new Map<string, boolean | null>()

  constructor(
    private readonly server: CodeServer,
    private readonly paths: EditorPaths = defaultPaths(),
    private readonly check: GalleryCheck = openVsxHas
  ) {}

  sources(): Promise<EditorSource[]> {
    return findSources(this.paths)
  }

  private editor(id: EditorSourceId) {
    const e = EDITORS.find((x) => x.id === id)
    if (!e) throw new Error('Unknown editor')
    return e
  }

  async plan(id: EditorSourceId): Promise<ImportPlan> {
    const e = this.editor(id)
    const source = (await this.sources()).find((s) => s.id === id)
    if (!source) throw new Error(`${e.name} has nothing to bring over.`)
    const theirs = await sourceExtensions(extDir(this.paths, e))
    // Ask the gallery about the ones that could be installed (not AI, not swapped), a few at a time, remembered.
    const first = planExtensions(theirs, () => null)
    const ask = first.flatMap((f) => (f.kind === 'install' ? [f.id] : f.kind === 'swap' ? [f.to] : [])).filter((x) => !this.gallery.has(x))
    const answers = await mapLimit(ask, 6, (x) => this.check(x))
    ask.forEach((x, i) => this.gallery.set(x, answers[i]))
    const extensions = planExtensions(theirs, (x) => this.gallery.get(x) ?? null)
    const dir = userDir(this.paths, e)
    return planImport(
      source,
      {
        settings: await readText(join(dir, 'settings.json')),
        keybindings: await readText(join(dir, 'keybindings.json')),
        snippets: (await sourceSnippets(join(dir, 'snippets'))).length
      },
      extensions,
      theirs
    )
  }

  /** Copy it over: settings, shortcuts and snippets into BetterCoder's VS Code, then the extensions (it restarts). */
  async run(id: EditorSourceId): Promise<ImportResult> {
    const e = this.editor(id)
    const plan = await this.plan(id)
    const theirs = await sourceExtensions(extDir(this.paths, e))
    const dir = userDir(this.paths, e)
    const result = await this.server.install(toInstall(plan.extensions))
    const target = join(this.server.userDataDir, 'User')
    await mkdir(join(target, 'snippets'), { recursive: true })
    const { kept } = withAvailableTheme(importSettings(await readText(join(dir, 'settings.json'))).kept, theirs, plan.extensions)
    await writeFile(join(target, 'settings.json'), JSON.stringify(mergedSettings(STARTING_SETTINGS, kept), null, 2) + '\n')
    await writeFile(join(target, 'keybindings.json'), JSON.stringify(importKeybindings(await readText(join(dir, 'keybindings.json'))), null, 2) + '\n')
    for (const s of await sourceSnippets(join(dir, 'snippets'))) await writeFile(join(target, 'snippets', s.name), JSON.stringify(s.json, null, 2) + '\n')
    return result
  }
}
