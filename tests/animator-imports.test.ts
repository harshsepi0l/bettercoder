/**
 * Regression tests for real animation failures:
 * - backend/app/... files failed with "No module named 'app'" (only the file's own folder was on the path);
 * - "run the whole file" never ran `if __name__ == "__main__":`, so main() was missing from the animation,
 *   and a program reading input() would have crashed with EOFError instead of stopping cleanly;
 * - the trace hook made heavy library imports (torch) ~10x slower, so they hit the timeout.
 * Uses tests/fixtures (read-only; runs happen on a temp copy).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findPython, projectPython, runTrace } from '../src/main/engines/visualize/runner'

const FIX = join(import.meta.dirname, 'fixtures')
const python = await findPython()

test('a file deep in a package imports its package absolutely and relatively', { skip: !python }, async () => {
  const trace = await runTrace({
    root: join(FIX, 'nested-backend'),
    file: 'backend/app/core/scoring.py',
    scenario: [{ call: 'keep', args: [[0.9, 0.2, 0.6]] }]
  })
  assert.equal(trace.stopped, undefined, trace.stopped)
  assert.ok(trace.steps.some((s) => s.func === 'keep'))
  const last = trace.steps.at(-1)!
  assert.ok(last.frames.some((f) => f.locals.some(([k]) => k === 'kept')), 'the function ran to its result')
})

test('whole-file runs execute the __main__ block and stop cleanly at input()', { skip: !python }, async () => {
  const trace = await runTrace({ root: join(FIX, 'todo-app'), file: 'app.py', scenario: [] })
  assert.ok(trace.steps.some((s) => s.func === 'main'), 'main() ran')
  assert.match(trace.stopped ?? '', /input\(\)/)
  assert.doesNotMatch(trace.stopped ?? '', /EOFError/)
})

test("the nearest virtual environment is used, even one inside a subfolder (backend/.venv)", { skip: !python || process.platform === 'win32' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'bc-venv-'))
  try {
    await mkdir(join(root, 'backend', '.venv', 'bin'), { recursive: true })
    const real = (await import('node:child_process')).execFileSync(python!, ['-c', 'import sys; print(sys.executable)']).toString().trim()
    await symlink(real, join(root, 'backend', '.venv', 'bin', 'python'))
    assert.equal(await projectPython(root, 'backend/app/core/scoring.py'), join(root, 'backend', '.venv', 'bin', 'python'))
    assert.equal(await projectPython(root, 'other/x.py'), null, 'a venv in a sibling folder is not used')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('the user-file check is cached per file (a realpath per call made torch imports 10x slower)', async () => {
  const { TRACER_SOURCE } = await import('../src/main/engines/visualize/tracer-source')
  assert.match(TRACER_SOURCE, /_user_files\.get\(name\)/)
})
