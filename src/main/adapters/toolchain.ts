import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { accessSync, constants } from 'node:fs'
import { mkdir, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join, relative, sep } from 'node:path'
import { languageOf, planRun, type RunLanguage, type RunPlan, type Tool, type Toolbox } from '../core/runners'

/**
 * What ▶ Run needs from the computer: which compilers and runtimes are really installed (macOS has stand-ins for
 * java, clang and swift in /usr/bin that only offer to install the real thing), their versions, the project files
 * near the file (.csproj, Package.swift), and a temp folder for build output. The decisions are core/runners.ts.
 */

const NEEDS: Record<RunLanguage, Tool[]> = {
  python: [],
  node: ['node'],
  dotnet: ['dotnet'],
  java: ['java'],
  kotlin: ['kotlinc', 'java'],
  swift: ['swift'],
  c: ['clang'],
  cpp: ['clang++']
}
const COMMAND: Record<Tool, string> = { python: 'python3', node: 'node', dotnet: 'dotnet', java: 'java', kotlinc: 'kotlinc', swift: 'swift', clang: 'clang', 'clang++': 'clang++' }

function run(command: string, args: string[], env: Record<string, string>): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    execFile(command, args, { env, timeout: 8000 }, (err, stdout, stderr) => resolve({ ok: !err, out: `${stdout}${stderr}` }))
  })
}

/** The first executable called `name` on this PATH. */
export function onPath(name: string, path: string): string | null {
  for (const dir of path.split(delimiter)) {
    if (!dir) continue
    const file = join(dir, name)
    try {
      accessSync(file, constants.X_OK)
      return file
    } catch {
      // not here
    }
  }
  return null
}

const cache = new Map<string, { at: number; command: string | null; major: number | null }>()
const TTL = 60_000

/** Is the tool really there (not a macOS stand-in), and its major version where Run cares. */
async function probe(tool: Tool, env: Record<string, string>): Promise<{ command: string | null; major: number | null }> {
  const key = `${tool}\0${env.PATH ?? ''}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL) return hit
  let command = onPath(COMMAND[tool], env.PATH ?? '')
  let major: number | null = null
  if (command && process.platform === 'darwin' && dirname(command) === '/usr/bin') {
    // The stand-ins: real only when a JDK or the developer tools are installed.
    const real = tool === 'java' ? await run('/usr/libexec/java_home', [], env) : ['clang', 'clang++', 'swift'].includes(tool) ? await run('/usr/bin/xcode-select', ['-p'], env) : { ok: true, out: '' }
    if (!real.ok) command = null
  }
  if (command && (tool === 'node' || tool === 'dotnet')) {
    const v = await run(command, ['--version'], env)
    const m = /(\d+)\./.exec(v.out)
    major = v.ok && m ? Number(m[1]) : null
    if (!v.ok) command = null
  }
  const entry = { at: Date.now(), command, major }
  cache.set(key, entry)
  return entry
}

async function toolbox(tools: Tool[], env: Record<string, string>): Promise<Toolbox> {
  const found = new Map<Tool, { command: string | null; major: number | null }>()
  for (const t of tools) found.set(t, await probe(t, env))
  return { command: (t) => found.get(t)?.command ?? null, major: (t) => found.get(t)?.major ?? null }
}

/** The nearest folder, from the file's own up to the project root, that has an entry `pick` likes. */
async function nearestUp(root: string, rel: string, pick: (names: string[]) => string | null): Promise<{ dir: string; name: string } | null> {
  let dir = dirname(join(root, rel))
  for (;;) {
    const name = pick(await readdir(dir).catch(() => [] as string[]))
    if (name) return { dir, name }
    if (dir === root || !dir.startsWith(root) || dirname(dir) === dir) return null
    dir = dirname(dir)
  }
}

const posixRel = (root: string, abs: string) => relative(root, abs).split(sep).join('/')

/** How ▶ Run runs this file here, or why it can't yet. */
export async function planForFile(root: string, rel: string, env: Record<string, string>, python: () => Promise<string | null>): Promise<RunPlan> {
  const lang = languageOf(rel)
  const buildDir = join(tmpdir(), 'bettercoder-run', createHash('sha256').update(root).digest('hex').slice(0, 12))
  await mkdir(buildDir, { recursive: true })
  const csproj = lang === 'dotnet' ? await nearestUp(root, rel, (names) => names.find((n) => n.endsWith('.csproj')) ?? null) : null
  const swiftPackage = lang === 'swift' ? await nearestUp(root, rel, (names) => (names.includes('Package.swift') ? 'Package.swift' : null)) : null
  return planRun(
    {
      path: rel,
      python: lang === 'python' ? await python() : null,
      csproj: csproj ? posixRel(root, join(csproj.dir, csproj.name)) : null,
      swiftPackage: swiftPackage ? posixRel(root, swiftPackage.dir) : null,
      buildDir
    },
    await toolbox(lang ? NEEDS[lang] : [], env)
  )
}
