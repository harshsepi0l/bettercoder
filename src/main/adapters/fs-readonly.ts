import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { isSecretPath, SandboxError } from '../core/paths'
import type { ProjectFiles } from '../ports'

/**
 * The only way into the learner's project: paths must stay inside the project folder (symlinks included), files
 * that usually hold secrets are refused, and nothing here can write. The rules live in core/paths.ts.
 */

/**
 * Resolve a user/model-supplied path to an absolute path inside root, or throw.
 * With `allowed` (a session opened on individual files), only those files resolve.
 */
export async function resolveInside(
  root: string,
  input: string,
  allowed?: ReadonlySet<string>
): Promise<{ abs: string; rel: string }> {
  const realRoot = await realpath(root)
  const candidate = isAbsolute(input) ? input : resolve(realRoot, input)
  let real: string
  try {
    real = await realpath(candidate)
  } catch {
    throw new SandboxError(`Not found: ${input}`)
  }
  const rel = relative(realRoot, real)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new SandboxError('That path is outside the project folder.')
  }
  if (isSecretPath(rel)) {
    throw new SandboxError('That file usually holds secrets, so BetterCoder does not read it.')
  }
  if (allowed && !allowed.has(rel)) {
    throw new SandboxError('This session can only see the files you opened.')
  }
  return { abs: real, rel: rel === '' ? '.' : rel }
}

/** Read-only project access for the coach's tools (ports.ProjectFiles): the gate above, then plain reads. */
export const projectFiles: ProjectFiles = {
  resolve: resolveInside,
  list: async (abs) => (await readdir(abs, { withFileTypes: true })).map((e) => ({ name: e.name, isDir: e.isDirectory(), isFile: e.isFile() })),
  info: async (abs) => {
    const s = await stat(abs)
    return { isFile: s.isFile(), size: s.size }
  },
  read: (abs) => readFile(abs)
}
