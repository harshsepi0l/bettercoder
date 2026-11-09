import { extname, posix } from 'node:path'

/**
 * ▶ Run for every language the app reads: which command runs a file, what it needs installed, and where to get that.
 * Pure: the adapter (adapters/toolchain.ts) says which tools are installed and finds project files; this decides. The
 * learner's Run runs for real in their project folder; anything a compiler builds goes to a temp folder, never into
 * their project.
 */

export type RunLanguage = 'python' | 'node' | 'dotnet' | 'java' | 'kotlin' | 'swift' | 'c' | 'cpp'

const BY_EXTENSION: Record<string, RunLanguage> = {
  '.py': 'python',
  '.js': 'node',
  '.mjs': 'node',
  '.cjs': 'node',
  '.ts': 'node',
  '.mts': 'node',
  '.cts': 'node',
  '.cs': 'dotnet',
  '.java': 'java',
  '.kt': 'kotlin',
  '.swift': 'swift',
  '.c': 'c',
  '.cc': 'cpp',
  '.cpp': 'cpp',
  '.cxx': 'cpp'
}

/** The file extensions ▶ Run handles (notebooks run in their own kernel instead). */
export const RUNNABLE_EXTENSIONS = Object.keys(BY_EXTENSION)

export function languageOf(path: string): RunLanguage | null {
  return BY_EXTENSION[extname(path).toLowerCase()] ?? null
}

export type Tool = 'python' | 'node' | 'dotnet' | 'java' | 'kotlinc' | 'swift' | 'clang' | 'clang++'

/** Where to get each tool: the official page. */
export const INSTALL: Record<Tool, { name: string; url: string }> = {
  python: { name: 'Python', url: 'https://www.python.org/downloads/' },
  node: { name: 'Node.js', url: 'https://nodejs.org/en/download' },
  dotnet: { name: 'the .NET SDK', url: 'https://dotnet.microsoft.com/download' },
  java: { name: 'a Java JDK', url: 'https://adoptium.net/temurin/releases/' },
  kotlinc: { name: 'the Kotlin compiler', url: 'https://kotlinlang.org/docs/command-line.html' },
  swift: { name: 'Swift', url: 'https://www.swift.org/install/' },
  clang: { name: 'a C compiler (Xcode Command Line Tools)', url: 'https://developer.apple.com/xcode/resources/' },
  'clang++': { name: 'a C++ compiler (Xcode Command Line Tools)', url: 'https://developer.apple.com/xcode/resources/' }
}

/** What is installed: each tool's command (or null when missing) and, where it matters, its major version. */
export interface Toolbox {
  command(tool: Tool): string | null
  major(tool: Tool): number | null
}

export interface RunInput {
  /** Project-relative, with / separators. */
  path: string
  /** The project's Python (its venv) or the system one, found by the adapter. */
  python: string | null
  /** The nearest .csproj from the file up to the project root (project-relative), if any. */
  csproj: string | null
  /** The folder of the nearest Package.swift from the file up to the root (project-relative; '' is the root). */
  swiftPackage: string | null
  /** A temp folder for build output (never inside their project). */
  buildDir: string
}

export type RunPlan =
  | { kind: 'run'; lang: RunLanguage; command: string; args: string[]; cwd: '' | string }
  | { kind: 'missing'; lang: RunLanguage; message: string; install: { name: string; url: string } }
  | { kind: 'unsupported'; message: string }

/** ▶ Run can't start because a tool is missing: the message, and the official page to get it. */
export class ToolMissingError extends Error {
  constructor(
    message: string,
    readonly install: { name: string; url: string }
  ) {
    super(message)
    this.name = 'ToolMissingError'
  }
}

/** A string as one shell word. */
export function shellWord(s: string): string {
  return /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`
}

const missing = (lang: RunLanguage, tool: Tool, why?: string): RunPlan => ({
  kind: 'missing',
  lang,
  message: why ?? `${INSTALL[tool].name[0].toUpperCase()}${INSTALL[tool].name.slice(1)} isn't installed, so this file can't run yet.`,
  install: INSTALL[tool]
})

/** How ▶ Run runs this file, or why it can't yet. `cwd` is project-relative ('' = the project folder). */
export function planRun(input: RunInput, tools: Toolbox): RunPlan {
  const { path } = input
  if (/\.ipynb$/i.test(path)) return { kind: 'unsupported', message: 'A notebook runs in its kernel: use Run All at the top of the notebook.' }
  const lang = languageOf(path)
  if (!lang) return { kind: 'unsupported', message: `Run doesn't know ${extname(path) || 'this kind of file'} yet. Use the terminal.` }
  const out = (name: string) => posix.join(input.buildDir.split('\\').join('/'), name)
  const sh = (line: string): RunPlan => ({ kind: 'run', lang, command: '/bin/sh', args: ['-c', line], cwd: '' })

  switch (lang) {
    case 'python':
      return input.python ? { kind: 'run', lang, command: input.python, args: ['-u', path], cwd: '' } : missing(lang, 'python')
    case 'node': {
      const node = tools.command('node')
      if (!node) return missing(lang, 'node')
      // TypeScript runs as it is on Node 22.18 and newer (types are stripped); older Node can't.
      if (/\.[mc]?ts$/i.test(path) && (tools.major('node') ?? 0) < 22) return missing(lang, 'node', 'Running TypeScript needs Node 22 or newer.')
      return { kind: 'run', lang, command: node, args: [path], cwd: '' }
    }
    case 'dotnet': {
      const dotnet = tools.command('dotnet')
      if (!dotnet) return missing(lang, 'dotnet')
      if (input.csproj) return { kind: 'run', lang, command: dotnet, args: ['run', '--project', input.csproj, '--artifacts-path', out('dotnet')], cwd: '' }
      if ((tools.major('dotnet') ?? 0) >= 10) return { kind: 'run', lang, command: dotnet, args: ['run', path], cwd: '' }
      return { kind: 'unsupported', message: 'C# needs a project file (.csproj) in this folder, or .NET 10 to run a single file.' }
    }
    case 'java': {
      const java = tools.command('java')
      return java ? { kind: 'run', lang, command: java, args: [path], cwd: '' } : missing(lang, 'java')
    }
    case 'kotlin': {
      const kotlinc = tools.command('kotlinc')
      const java = tools.command('java')
      if (!kotlinc) return missing(lang, 'kotlinc')
      if (!java) return missing(lang, 'java')
      const jar = out('program.jar')
      return sh(`${shellWord(kotlinc)} ${shellWord(path)} -include-runtime -d ${shellWord(jar)} && ${shellWord(java)} -jar ${shellWord(jar)}`)
    }
    case 'swift': {
      const swift = tools.command('swift')
      if (!swift) return missing(lang, 'swift')
      if (input.swiftPackage !== null) return { kind: 'run', lang, command: swift, args: ['run', '--scratch-path', out('swift-build')], cwd: input.swiftPackage }
      return { kind: 'run', lang, command: swift, args: [path], cwd: '' }
    }
    case 'c':
    case 'cpp': {
      const tool: Tool = lang === 'c' ? 'clang' : 'clang++'
      const cc = tools.command(tool)
      if (!cc) return missing(lang, tool)
      const exe = out('program')
      const std = lang === 'cpp' ? ' -std=c++20' : ''
      return sh(`${shellWord(cc)}${std} -g ${shellWord(path)} -o ${shellWord(exe)} && ${shellWord(exe)}`)
    }
  }
}
