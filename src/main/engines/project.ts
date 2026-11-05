import { readdir, readFile } from 'node:fs/promises'
import { basename, dirname, extname, join, relative, sep } from 'node:path'
import type { ProjectInfo } from '../../shared/ipc'
import type { ProjectScanner } from '../ports'
import { SKIP_DIRS } from '../core/paths'
import { stat } from 'node:fs/promises'

/**
 * Looks at a project folder WITHOUT changing it: only readdir and readFile.
 * BetterCoder never writes inside the user's project. Any folder works: a git
 * repo, a project with manifests, or just a few loose source files.
 */

/** Manifest files at the top level, and the languages each one implies. */
const MANIFESTS: Array<{ test: (file: string) => boolean; stack: string; covers: string[] }> = [
  { test: (f) => /\.(sln|slnx|csproj|fsproj)$/.test(f), stack: 'C# / .NET', covers: ['C#', 'F#'] },
  { test: (f) => f === 'package.json', stack: 'JavaScript / TypeScript', covers: ['JavaScript', 'TypeScript'] },
  { test: (f) => f === 'Cargo.toml', stack: 'Rust', covers: ['Rust'] },
  { test: (f) => f === 'go.mod', stack: 'Go', covers: ['Go'] },
  {
    test: (f) => ['pyproject.toml', 'requirements.txt', 'setup.py', 'setup.cfg', 'Pipfile', 'environment.yml'].includes(f),
    stack: 'Python',
    covers: ['Python']
  },
  { test: (f) => f === 'pom.xml' || f.startsWith('build.gradle'), stack: 'Java / Kotlin', covers: ['Java', 'Kotlin'] },
  { test: (f) => f === 'Package.swift', stack: 'Swift', covers: ['Swift'] },
  { test: (f) => f.endsWith('.xcodeproj') || f.endsWith('.xcworkspace'), stack: 'Xcode project', covers: [] },
  { test: (f) => f === 'CMakeLists.txt' || f === 'Makefile', stack: 'C / C++', covers: ['C', 'C++'] },
  { test: (f) => f === 'Gemfile', stack: 'Ruby', covers: ['Ruby'] },
  { test: (f) => f === 'composer.json', stack: 'PHP', covers: ['PHP'] }
]

/** Source file extensions, so a plain folder of .py (or any) files is recognised. */
export const EXTENSIONS: Record<string, string> = {
  '.py': 'Python', '.ipynb': 'Python',
  '.js': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript', '.jsx': 'JavaScript',
  '.ts': 'TypeScript', '.tsx': 'TypeScript', '.mts': 'TypeScript', '.cts': 'TypeScript',
  '.cs': 'C#', '.fs': 'F#',
  '.java': 'Java', '.kt': 'Kotlin', '.kts': 'Kotlin',
  '.go': 'Go', '.rs': 'Rust', '.swift': 'Swift',
  '.c': 'C', '.cpp': 'C++', '.cc': 'C++', '.cxx': 'C++', '.hpp': 'C++', '.hh': 'C++',
  '.rb': 'Ruby', '.php': 'PHP', '.lua': 'Lua', '.dart': 'Dart', '.scala': 'Scala',
  '.r': 'R', '.jl': 'Julia', '.ex': 'Elixir', '.exs': 'Elixir', '.hs': 'Haskell',
  '.html': 'HTML / CSS', '.css': 'HTML / CSS', '.scss': 'HTML / CSS',
  '.sql': 'SQL', '.sh': 'Shell', '.zsh': 'Shell', '.ps1': 'PowerShell'
}

const MAX_DEPTH = 4
const MAX_FILES = 5000

async function countLanguages(root: string): Promise<{ counts: Map<string, number>; files: number }> {
  const counts = new Map<string, number>()
  let files = 0
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH || files >= MAX_FILES) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return // unreadable folder: skip it
    }
    for (const entry of entries) {
      if (files >= MAX_FILES) return
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) await walk(join(dir, entry.name), depth + 1)
      } else if (entry.isFile()) {
        files++
        const lang = EXTENSIONS[extname(entry.name).toLowerCase()]
        if (lang) counts.set(lang, (counts.get(lang) ?? 0) + 1)
      }
    }
  }
  await walk(root, 0)
  return { counts, files }
}

async function readGitBranch(root: string): Promise<ProjectInfo['git']> {
  try {
    const head = (await readFile(join(root, '.git', 'HEAD'), 'utf8')).trim()
    const match = /^ref: refs\/heads\/(.+)$/.exec(head)
    return { branch: match ? match[1] : null }
  } catch {
    return null // not a git repo: that's fine
  }
}

export async function detectProject(root: string): Promise<ProjectInfo> {
  const [entries, { counts, files }, git] = await Promise.all([readdir(root), countLanguages(root), readGitBranch(root)])

  // Languages actually present, most files first; ignore stray one-offs in bigger projects.
  const languages = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .filter(([, n], i) => i === 0 || n >= 2)
    .map(([name, n]) => ({ name, files: n }))
  const found = new Set(languages.map((l) => l.name))

  const manifests: string[] = []
  const stacks: string[] = []
  for (const file of entries) {
    const hit = MANIFESTS.find((m) => m.test(file))
    if (!hit) continue
    manifests.push(file)
    // A manifest names the stack; only add it if the files didn't already show that language.
    if (!stacks.includes(hit.stack) && (hit.covers.length === 0 || !hit.covers.some((c) => found.has(c)))) {
      stacks.push(hit.stack)
    }
  }
  for (const { name } of languages) if (!stacks.includes(name)) stacks.push(name)

  return { root, name: basename(root), stacks, manifests, languages, fileCount: files, git }
}

/** The deepest folder that contains every one of these paths. */
export function commonParent(paths: string[]): string {
  const split = paths.map((p) => dirname(p).split(sep))
  const first = split[0]
  let n = first.length
  for (const parts of split.slice(1)) {
    let i = 0
    while (i < n && i < parts.length && parts[i] === first[i]) i++
    n = i
  }
  return first.slice(0, n).join(sep) || sep
}

/** A "project" made of individually chosen files. Read-only, like everything else. */
export async function detectFiles(paths: string[]): Promise<ProjectInfo> {
  const root = commonParent(paths)
  const files = [...new Set(paths.map((p) => relative(root, p)))].sort()
  const counts = new Map<string, number>()
  for (const f of files) {
    const lang = EXTENSIONS[extname(f).toLowerCase()]
    if (lang) counts.set(lang, (counts.get(lang) ?? 0) + 1)
  }
  const languages = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, files: n }))
  const name = files.length === 1 ? basename(files[0]) : `${basename(files[0])} + ${files.length - 1} more`
  return {
    root,
    name,
    stacks: languages.map((l) => l.name),
    manifests: [],
    languages,
    fileCount: files.length,
    git: await readGitBranch(root),
    files
  }
}

/** The project scan, as the workspace sees it (ports.ProjectScanner). */
export const projectScanner: ProjectScanner = {
  scanFolder: detectProject,
  scanFiles: detectFiles,
  kindOf: async (path) => {
    try {
      return (await stat(path)).isDirectory() ? 'dir' : 'file'
    } catch {
      return 'missing'
    }
  }
}
