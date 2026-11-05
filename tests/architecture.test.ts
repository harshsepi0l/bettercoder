import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

/**
 * The main process is in layers, and imports only point down (or sideways within a layer):
 *
 *   core      pure rules: no Electron, no pi, no files            (imports nothing else in main)
 *   ports     interfaces for the outside world, no code            (what coach and services may depend on)
 *   adapters  the outside world: disk, keychain, providers, socket (implement ports)
 *   engines   map, animator, project scan (implement ports)
 *   coach     the conversation: engine, turn, request, replay, prompts, tools
 *   services  workspace, editor link
 *   ipc       one file per area, wiring it all to the window; ports.ts plugs the real ports in
 *   index.ts  the window
 */
const MAIN = join(import.meta.dirname, '..', 'src', 'main')
const LAYERS = ['core', 'ports', 'adapters', 'engines', 'coach', 'services', 'ipc'] as const

function layerOf(file: string): number {
  const top = relative(MAIN, file).split('/')[0]
  if (top === 'index.ts') return LAYERS.length
  const i = LAYERS.indexOf(top as (typeof LAYERS)[number])
  assert.ok(i >= 0, `${relative(MAIN, file)} is outside the layers (${LAYERS.join(', ')})`)
  return i
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : []
  })
}

function target(from: string, spec: string): string | null {
  const base = resolve(dirname(from), spec)
  for (const p of [base, `${base}.ts`, join(base, 'index.ts')]) {
    try {
      if (statSync(p).isFile()) return p
    } catch {
      // try the next form
    }
  }
  return null
}

test('architecture: main-process imports only point down the layers', () => {
  const wrong: string[] = []
  for (const file of walk(MAIN)) {
    const from = layerOf(file)
    for (const m of readFileSync(file, 'utf8').matchAll(/(?:from|import)\s*\(?\s*'(\.{1,2}\/[^']+)'/g)) {
      const t = target(file, m[1])
      if (!t || !t.startsWith(MAIN)) continue // shared/ and packages are fine
      const to = layerOf(t)
      if (to > from) wrong.push(`${relative(MAIN, file)} (${LAYERS[from] ?? 'index'}) → ${relative(MAIN, t)} (${LAYERS[to] ?? 'index'})`)
    }
  }
  assert.deepEqual(wrong, [], 'an import points up a layer')
})

test('architecture: core is pure (no Electron, no pi, no file access)', () => {
  for (const file of walk(join(MAIN, 'core'))) {
    const src = readFileSync(file, 'utf8')
    assert.doesNotMatch(src, /from '(electron|@earendil-works\/[^']+|node:fs[^']*|node:child_process)'/, `${relative(MAIN, file)} must stay pure`)
  }
})

/**
 * Regression (2026-11-04): `useEffect(() => el.scrollIntoView(...))` returned a promise in new Chromium, React threw
 * "destroy is not a function", and every session with that card crashed. Effects use a block body, so they return
 * nothing (or a clean-up function) on purpose.
 */
test('renderer: effects never return a value by accident', () => {
  const RENDERER = join(import.meta.dirname, '..', 'src', 'renderer', 'src')
  const tsx = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const p = join(dir, n)
      return statSync(p).isDirectory() ? tsx(p) : /\.tsx?$/.test(p) ? [p] : []
    })
  const wrong = tsx(RENDERER).filter((f) => /useEffect\(\(\) => [^{\s]/.test(readFileSync(f, 'utf8')))
  assert.deepEqual(wrong.map((f) => relative(RENDERER, f)), [])
})

/**
 * Clean architecture: the conversation and the services depend on ports, not on what implements them. They never
 * import adapters or engines, and never reach files, processes, sockets or Electron themselves (ipc/ports.ts plugs the
 * real ones in). That keeps them testable with stand-ins and keeps every read of the project behind the one gate.
 */
test('architecture: coach and services use ports only (no adapters, engines, files, processes or Electron)', () => {
  const wrong: string[] = []
  for (const area of ['coach', 'services']) {
    for (const file of walk(join(MAIN, area))) {
      const src = readFileSync(file, 'utf8')
      for (const m of src.matchAll(/from '([^']+)'/g)) {
        const spec = m[1]
        const t = spec.startsWith('.') ? target(file, spec) : null
        const layer = t && t.startsWith(MAIN) ? relative(MAIN, t).split('/')[0] : null
        if (layer === 'adapters' || layer === 'engines') wrong.push(`${relative(MAIN, file)} → ${relative(MAIN, t!)}`)
        if (/^(electron|node:(fs|fs\/promises|os|child_process|net))$/.test(spec)) wrong.push(`${relative(MAIN, file)} → ${spec}`)
      }
    }
  }
  assert.deepEqual(wrong, [], 'use a port (src/main/ports) instead')
})

test('architecture: ports hold interfaces only', () => {
  for (const file of walk(join(MAIN, 'ports'))) {
    const src = readFileSync(file, 'utf8')
    assert.doesNotMatch(src, /^\s*(export\s+)?(const|let|function|class)\s/m, `${relative(MAIN, file)} must hold types only`)
    assert.doesNotMatch(src, /^import (?!type )/m, `${relative(MAIN, file)} may only import types`)
  }
})
