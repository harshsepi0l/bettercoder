import { execFile, spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, extname, join, relative } from 'node:path'
import type { Trace, TraceStep, TraceValue } from '../../../shared/trace'
import type { Animator, RunRequest } from '../../ports'
export { plainValue, summarizeTrace } from '../../core/trace-summary'
import { SKIP_DIRS } from '../../core/paths'
import { resolveInside } from '../../adapters/fs-readonly'
import { isSecretPath } from '../../core/paths'
import { TRACER_SOURCE } from './tracer-source'
import { notebookToPython, viewLines } from '../../core/text-view'
import { ScenarioError, describeScenario, validateScenario } from './scenario'

/**
 * Runs the learner's Python for the animator, safely:
 *  - on a temporary COPY of the project's .py files (the real folder is never run in or written to),
 *  - with a timeout and a step limit,
 *  - on macOS inside sandbox-exec: no network, no writes outside the temp folder.
 */

/**
 * Hard stop for the whole process. Runaway loops in the learner's code end much sooner, at the
 * tracer's step cap; this mainly leaves room for heavy libraries (torch, models) to load.
 */
const TIMEOUT_MS = 30000
/** The first run with matplotlib also builds its font cache. */
const FIRST_RUN_TIMEOUT_MS = 45000
const MAX_COPY_FILES = 300
const MAX_COPY_BYTES = 4 * 1024 * 1024

const MAC_PROFILE = (tmp: string, cache: string) => `(version 1)
(allow default)
(deny network*)
(deny file-write*)
(allow file-write* (subpath "${tmp}"))
(allow file-write* (subpath "${cache}"))
(allow file-write* (literal "/dev/null"))
(allow file-write* (literal "/dev/dtracehelper"))`

/** Hugging Face models already on this computer, readable offline inside the sandbox. */
async function modelCacheEnv(): Promise<Record<string, string>> {
  const home = process.env.HOME
  if (!home) return {}
  const hf = join(home, '.cache', 'huggingface')
  const exists = await stat(hf).then((s) => s.isDirectory()).catch(() => false)
  return exists ? { HF_HOME: hf, HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', HF_HUB_DISABLE_TELEMETRY: '1' } : {}
}

let pythonPath: Promise<string | null> | null = null

function works(candidate: string): Promise<boolean> {
  return new Promise<boolean>((done) =>
    execFile(candidate, ['-c', 'import sys; print(sys.version_info[0])'], { timeout: 4000 }, (err, out) => done(!err && out.trim() === '3'))
  )
}

/**
 * The project's own virtual environment, if it has one (so its packages are available):
 * the nearest one from the file's folder up to the project root (e.g. backend/.venv).
 */
export async function projectPython(root: string, fileRel = ''): Promise<string | null> {
  const dirs: string[] = []
  for (let d = dirname(fileRel); ; d = dirname(d)) {
    dirs.push(d === '.' ? root : join(root, d))
    if (d === '.' || d === '/' || d === '') break
  }
  for (const base of dirs) {
    for (const dir of ['.venv', 'venv', 'env']) {
      const candidate = join(base, dir, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
      if (await works(candidate)) return candidate
    }
  }
  return null
}

/** The first working Python 3 on this machine, or null. */
export function findPython(): Promise<string | null> {
  pythonPath ??= (async () => {
    for (const candidate of ['python3', 'python']) {
      const ok = await new Promise<boolean>((done) =>
        execFile(candidate, ['-c', 'import sys; print(sys.version_info[0])'], { timeout: 4000 }, (err, out) =>
          done(!err && out.trim() === '3')
        )
      )
      if (ok) return candidate
    }
    return null
  })()
  return pythonPath
}

async function copyPythonFiles(root: string, dest: string, only?: string[]): Promise<void> {
  let count = 0
  let bytes = 0
  const copyOne = async (rel: string) => {
    if (isSecretPath(rel) || !['.py', '.csv', '.txt', '.json'].includes(extname(rel).toLowerCase())) return
    const info = await stat(join(root, rel))
    if (count >= MAX_COPY_FILES || bytes + info.size > MAX_COPY_BYTES) return
    count++
    bytes += info.size
    await mkdir(dirname(join(dest, rel)), { recursive: true })
    await cp(join(root, rel), join(dest, rel))
  }
  if (only) {
    for (const rel of only) await copyOne(rel)
    return
  }
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 6) return
    for (const e of await readdir(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue
      const full = join(dir, e.name)
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) await walk(full, depth + 1)
      } else if (e.isFile()) {
        await copyOne(relative(root, full))
      }
    }
  }
  await walk(root, 0)
}

export type { RunRequest }

/** Run a scenario against the learner's file and record every step. */
export async function runTrace(req: RunRequest): Promise<Trace> {
  const ext = extname(req.file).toLowerCase()
  if (ext !== '.py' && ext !== '.ipynb') throw new ScenarioError('Only Python files and notebooks can be animated so far.')
  const allowed = req.files ? new Set(req.files) : undefined
  const { abs, rel } = await resolveInside(req.root, req.file, allowed)
  const raw = await readFile(abs, 'utf8')
  // A notebook runs as its code cells in one module; lines are mapped back to the cells shown.
  const notebook = ext === '.ipynb' ? notebookToPython(raw) : null
  if (ext === '.ipynb' && !notebook) throw new ScenarioError('That notebook could not be read.')
  const source = notebook ? notebook.code : raw
  const scenario = validateScenario(req.scenario, source)
  const moduleRel = notebook ? rel.replace(/\.ipynb$/i, '__notebook.py') : rel

  const python = (await projectPython(req.root, rel)) ?? (await findPython())
  if (!python) throw new ScenarioError('Python 3 was not found on this computer, so the code cannot be run.')

  // Real path: on macOS the temp folder sits behind a symlink, and the sandbox rules need the real one.
  const tmp = await realpath(await mkdtemp(join(tmpdir(), 'bettercoder-run-')))
  const work = join(tmp, 'project')
  try {
    const cacheDir = await realpath(await mkdir(join(tmpdir(), 'bettercoder-cache', 'matplotlib'), { recursive: true }).then(() => join(tmpdir(), 'bettercoder-cache', 'matplotlib')))
    await copyPythonFiles(req.root, work, req.files)
    if (notebook) {
      await mkdir(dirname(join(work, moduleRel)), { recursive: true })
      await writeFile(join(work, moduleRel), notebook.code)
    }
    // matplotlib builds a font cache the first time (about 10 s); allow for that once.
    const usesMatplotlib = /\bmatplotlib\b/.test(source)
    const cacheReady = (await readdir(cacheDir).catch(() => [] as string[])).some((f) => f.startsWith('fontlist'))
    const limit = usesMatplotlib && !cacheReady ? FIRST_RUN_TIMEOUT_MS : TIMEOUT_MS
    const tracerFile = join(tmp, 'tracer.py')
    await writeFile(tracerFile, TRACER_SOURCE)
    const env = {
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      HOME: tmp,
      TMPDIR: tmp,
      PYTHONDONTWRITEBYTECODE: '1',
      PYTHONIOENCODING: 'utf-8',
      // Plots render off-screen: no windows, no waiting on plt.show().
      MPLBACKEND: 'Agg',
      // Kept between runs, so matplotlib builds its font cache once, not every time.
      MPLCONFIGDIR: cacheDir,
      // Downloaded models are read from the learner's own cache, offline (the sandbox blocks network and writes).
      ...(await modelCacheEnv())
    }
    // -E: ignore PYTHON* variables from the environment (user-installed packages still load).
    const args = ['-E', tracerFile]
    const [cmd, cmdArgs] =
      process.platform === 'darwin'
        ? ['/usr/bin/sandbox-exec', ['-p', MAC_PROFILE(tmp, cacheDir), python, ...args]]
        : [python, args]
    const out = await new Promise<string>((done, fail) => {
      const child = spawn(cmd, cmdArgs, { cwd: work, env, stdio: ['pipe', 'pipe', 'pipe'] })
      let stdout = ''
      let err = ''
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        fail(new ScenarioError(`The run took more than ${limit / 1000} seconds, so it was stopped. Something it loads or runs is too slow to animate.`))
      }, limit)
      child.stdout.on('data', (d) => (stdout += d))
      child.stderr.on('data', (d) => (err += d))
      child.on('error', (e) => {
        clearTimeout(timer)
        fail(e)
      })
      child.on('close', () => {
        clearTimeout(timer)
        if (stdout.trim()) done(stdout)
        else fail(new ScenarioError(`The run failed before it started. ${err.trim().split('\n').slice(-2).join(' ')}`.trim()))
      })
      child.stdin.end(
        JSON.stringify({
          root: work,
          module: moduleRel,
          scenario,
          usesMatplotlib,
          timeLimit: limit / 1000 - 3,
          ...(notebook ? { cells: notebook.cells } : {})
        })
      )
    })
    const parsed = JSON.parse(out) as { steps: TraceStep[]; stopped?: string }
    if (notebook) {
      // Map module lines back to the notebook's cell view.
      for (const step of parsed.steps) {
        if (step.file === moduleRel) {
          step.file = rel
          step.line = notebook.viewLineOf[step.line - 1] ?? step.line
        }
      }
    }
    return {
      language: 'python',
      file: rel,
      source: notebook ? viewLines(rel, raw) : source.split('\n'),
      scenario: describeScenario(scenario),
      steps: parsed.steps,
      ...(parsed.stopped ? { stopped: parsed.stopped } : {})
    }
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
}

/** The Python files and notebooks the animator can run (tests and secret files left out), for the Visualize picker. */
export async function pythonFiles(p: { root: string; files?: string[] }): Promise<string[]> {
  if (p.files) return p.files.filter((f) => /\.(py|ipynb)$/i.test(f))
  const out: string[] = []
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 5 || out.length >= 200) return
    for (const e of await readdir(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue
      const full = join(dir, e.name)
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) await walk(full, depth + 1)
      } else if (e.isFile() && /\.(py|ipynb)$/i.test(e.name)) {
        const rel = relative(p.root, full)
        if (!isSecretPath(rel) && !/^test_|_test\.py$/.test(e.name)) out.push(rel)
      }
    }
  }
  await walk(p.root, 0)
  return out.sort()
}

/** Run a small Python example the coach wrote, in its own temp folder (same sandbox). Only the trace comes back. */
export async function runExample(python: string): Promise<Trace> {
  const dir = await mkdtemp(join(tmpdir(), 'bc-example-'))
  try {
    await writeFile(join(dir, 'example.py'), python, 'utf8')
    return await runTrace({ root: dir, file: 'example.py', scenario: [] })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** The animator, as the coach sees it (ports.Animator). */
export const animator: Animator = { run: runTrace, runExample }
