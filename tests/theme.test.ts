// The app's look (2026-11-14): dark (black with red), light (the same look in daylight), or the system's.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanProfile } from '../src/shared/profile'
import { EDITOR_THEMES, withEditorTheme } from '../src/main/adapters/code-server'
import { resolveTheme } from '../src/renderer/src/features/settings/theme'
import { BOARD_THEMES, boardSkeletons } from '../src/renderer/src/features/visualize/board-elements'
import { boardScene, type Board } from '../src/shared/board'

const ROOT = join(import.meta.dirname, '..')

test('the theme is kept with the profile; anything else is dropped; unset means the system', () => {
  assert.equal(cleanProfile({ theme: 'light' }).theme, 'light')
  assert.equal(cleanProfile({ theme: 'neon' }).theme, undefined)
  assert.equal(resolveTheme(undefined, true), 'light')
  assert.equal(resolveTheme('system', false), 'dark')
  assert.equal(resolveTheme('dark', true), 'dark', 'their pick wins over the system')
})

test('the editor follows the app only while it is on one of our themes', () => {
  const on = (theme: unknown) => JSON.stringify({ 'workbench.colorTheme': theme, 'editor.fontSize': 14 })
  const next = withEditorTheme(on(EDITOR_THEMES.dark), 'light')
  assert.equal(JSON.parse(next!)['workbench.colorTheme'], 'BetterCoder Light')
  assert.equal(JSON.parse(next!)['editor.fontSize'], 14, 'their other settings stay')
  assert.equal(withEditorTheme(on(EDITOR_THEMES.light), 'light'), null, 'already right: nothing written')
  assert.equal(withEditorTheme(on('Solarized Dark'), 'light'), null, 'a theme they picked or brought is theirs')
  assert.equal(JSON.parse(withEditorTheme(null, 'light')!)['workbench.colorTheme'], 'BetterCoder Light')
})

test('both editor themes ship with the extension, and both app themes define every colour', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'ide/vscode/package.json'), 'utf8'))
  const themes = pkg.contributes.themes as Array<{ label: string; uiTheme: string; path: string }>
  assert.deepEqual(themes.map((t) => [t.label, t.uiTheme]), [['BetterCoder Dark', 'vs-dark'], ['BetterCoder Light', 'vs']])
  for (const t of themes) assert.equal(JSON.parse(readFileSync(join(ROOT, 'ide/vscode', t.path), 'utf8')).name, t.label)
  // globals.css: every colour token of the dark theme has a light value too (a missing one would show dark on light).
  const css = readFileSync(join(ROOT, 'src/renderer/src/styles/globals.css'), 'utf8')
  const block = (start: string) => css.slice(css.indexOf(start), css.indexOf('}', css.indexOf(start)))
  const names = (b: string) => [...b.matchAll(/--([\w-]+):\s*#/g)].map((m) => m[1]).sort()
  assert.deepEqual(names(block(':root[data-theme="light"] {')), names(block(':root {')))
})

test('the whiteboard draws in the theme’s colours', () => {
  const board: Board = { steps: [{ say: 'x', add: [{ type: 'box', id: 'n', label: 'number', text: '23' }], change: [], remove: [], focus: [] }] }
  const drawn = boardScene(board, 0)
  const fill = (theme: 'dark' | 'light') => boardSkeletons(drawn, 1, theme).find((e) => e.id === 'n')?.backgroundColor
  assert.equal(fill('dark'), BOARD_THEMES.dark.litFill)
  assert.equal(fill('light'), BOARD_THEMES.light.litFill)
  assert.notEqual(fill('dark'), fill('light'))
})
