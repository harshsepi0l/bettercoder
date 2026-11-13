import { execFile } from 'node:child_process'
import { dirname, join } from 'node:path'

/** Which Python to use for the Map's analyzer and ▶ Run: the project's own venv first, otherwise the system's. */

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
    for (const candidate of ['python3', 'python']) if (await works(candidate)) return candidate
    return null
  })()
  return pythonPath
}
