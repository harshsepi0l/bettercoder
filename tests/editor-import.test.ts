// "Bring your VS Code": the learner's own editor setup copied into BetterCoder's VS Code, with AI always left out.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseJsonc } from '../src/main/core/jsonc'
import { FORCED_SETTINGS, importKeybindings, importSettings, mergedSettings, planExtensions, toInstall, withAvailableTheme } from '../src/main/core/editor-import'
import { EditorImporter, findSources, sourceExtensions } from '../src/main/adapters/editor-import'
import type { CodeServer } from '../src/main/adapters/code-server'

const SETUP = resolve(import.meta.dirname, 'fixtures', 'editor-setup')
const PATHS = { home: join(SETUP, 'home'), appData: join(SETUP, 'appData') }
const ON_OPEN_VSX = new Set(['ms-python.python', 'wesbos.theme-cobalt2', 'detachhead.basedpyright', 'muhammad-sammy.csharp'])

test('JSONC: comments and trailing commas are removed, strings are left alone', () => {
  assert.deepEqual(parseJsonc('{ // a\n "a": "x // not a comment", /* b */ "b": [1, 2,], }'), { a: 'x // not a comment', b: [1, 2] })
  assert.deepEqual(parseJsonc('{"url": "http://x/*y*/", "q": "say \\"hi\\", }"}'), { url: 'http://x/*y*/', q: 'say "hi", }' })
  assert.equal(parseJsonc('{ nope'), null)
  assert.equal(parseJsonc(''), null)
})

test('import: their extensions are installed, swapped for open ones, or left out with a reason', async () => {
  const theirs = await sourceExtensions(join(PATHS.home, '.vscode', 'extensions'))
  assert.ok(!theirs.some((e) => e.id === 'old.removed'), 'one they removed is not brought back')
  const plan = planExtensions(theirs, (id) => ON_OPEN_VSX.has(id))
  const by = Object.fromEntries(plan.map((f) => [f.id, f]))
  assert.equal(by['github.copilot'].kind, 'blocked')
  assert.equal(by['someone.chat-buddy'].kind, 'blocked', 'AI by its category, not only by name')
  assert.deepEqual(by['ms-python.vscode-pylance'], { kind: 'swap', id: 'ms-python.vscode-pylance', to: 'detachhead.basedpyright', why: 'Pylance is Microsoft-only; basedpyright does the same' })
  assert.equal(by['ms-dotnettools.csdevkit'].kind, 'swap')
  assert.equal(by['ms-vscode-remote.remote-ssh'].kind, 'missing')
  assert.equal(by['bettercoder.bettercoder-ide'].kind, 'missing')
  assert.deepEqual(by['private.only-mine'], { kind: 'missing', id: 'private.only-mine', why: 'Not on Open VSX' })
  assert.equal(by['ms-python.python'].kind, 'install')
  // Two Microsoft C# extensions, one open C# extension, installed once.
  assert.deepEqual(toInstall(plan).sort(), ['detachhead.basedpyright', 'ms-python.python', 'muhammad-sammy.csharp', 'wesbos.theme-cobalt2'])
})

test('import: settings keep their look and habits, never AI, secrets or what BetterCoder sets', () => {
  const { kept, dropped } = importSettings(readFileSync(join(PATHS.appData, 'Code', 'User', 'settings.json'), 'utf8'))
  assert.equal(kept['workbench.colorTheme'], 'Cobalt2')
  assert.equal(kept['editor.fontSize'], 14)
  assert.equal(kept['editor.formatOnSave'], true)
  assert.deepEqual(kept['[python]'], { 'editor.defaultFormatter': 'charliermarsh.ruff' })
  for (const k of ['github.copilot.enable', 'editor.inlineSuggest.enabled', 'chat.agent.enabled', 'claude-code.selectedModel', 'extensions.autoUpdate', 'telemetry.telemetryLevel', 'gitlens.apiToken']) {
    assert.ok(!(k in kept), k)
    assert.ok(dropped.includes(k), k)
  }
  assert.ok(dropped.includes('[python] editor.inlineSuggest.enabled'))
  // The rules that always win, over anything of theirs.
  const merged = mergedSettings({ 'workbench.colorTheme': 'BetterCoder Dark' }, { ...kept, 'chat.disableAIFeatures': false })
  assert.equal(merged['workbench.colorTheme'], 'Cobalt2')
  for (const [k, v] of Object.entries(FORCED_SETTINGS)) assert.deepEqual(merged[k], v, k)
})

test('import: shortcuts come over, except the ones for AI', () => {
  const kept = importKeybindings(readFileSync(join(PATHS.appData, 'Code', 'User', 'keybindings.json'), 'utf8')) as Array<{ command: string }>
  assert.deepEqual(kept.map((k) => k.command), ['workbench.action.selectTheme', '-editor.action.copyLinesDownAction'])
})

test('import: finds the editors with something to bring, and copies it all into BetterCoder’s VS Code', async () => {
  const sources = await findSources(PATHS)
  assert.deepEqual(sources.map((s) => [s.id, s.hasSettings]), [['vscode', true]])
  assert.equal(sources[0].extensions, 10)

  const userData = mkdtempSync(join(tmpdir(), 'bc-import-'))
  const installs: string[][] = []
  const server = { userDataDir: userData, install: async (ids: string[]) => (installs.push([...ids]), { installed: ids.filter((i) => i !== 'wesbos.theme-cobalt2'), failed: ['wesbos.theme-cobalt2'] }) }
  const importer = new EditorImporter(server as unknown as CodeServer, PATHS, async (id) => ON_OPEN_VSX.has(id))

  const plan = await importer.plan('vscode')
  assert.equal(plan.look.theme, 'Cobalt2')
  assert.equal(plan.look.font, 'JetBrains Mono')
  assert.equal(plan.keybindings, 2)
  assert.equal(plan.snippets, 1)

  const result = await importer.run('vscode')
  assert.deepEqual(result.failed, ['wesbos.theme-cobalt2'])
  assert.ok(!installs[0].includes('github.copilot'))
  const user = join(userData, 'User')
  const settings = JSON.parse(readFileSync(join(user, 'settings.json'), 'utf8'))
  assert.equal(settings['editor.fontSize'], 14)
  assert.equal(settings['chat.disableAIFeatures'], true)
  assert.equal(settings['editor.inlineSuggest.enabled'], false)
  assert.ok(!('gitlens.apiToken' in settings))
  assert.equal(JSON.parse(readFileSync(join(user, 'keybindings.json'), 'utf8')).length, 2)
  assert.deepEqual(readdirSync(join(user, 'snippets')), ['python.json'])
  assert.equal(JSON.parse(readFileSync(join(user, 'snippets', 'python.json'), 'utf8')).main.prefix, 'ifmain')
})

// Regression: a theme from an extension that isn't on Open VSX came over as a name only, so VS Code fell back to its
// plain default instead of BetterCoder Dark.
test('import: a theme whose extension stays behind is not brought over; built-in and installed ones are', async () => {
  const theirs = await sourceExtensions(join(PATHS.home, '.vscode', 'extensions'))
  const without = planExtensions(theirs, (id) => ON_OPEN_VSX.has(id) && id !== 'wesbos.theme-cobalt2')
  const left = withAvailableTheme({ 'workbench.colorTheme': 'Cobalt2', 'editor.fontSize': 14 }, theirs, without)
  assert.deepEqual(left, { kept: { 'editor.fontSize': 14 }, themeLeft: 'Cobalt2' })

  const withIt = planExtensions(theirs, (id) => ON_OPEN_VSX.has(id))
  assert.equal(withAvailableTheme({ 'workbench.colorTheme': 'Cobalt2' }, theirs, withIt).themeLeft, null)
  assert.equal(withAvailableTheme({ 'workbench.colorTheme': 'Default Dark Modern' }, theirs, without).themeLeft, null, 'built in to VS Code')

  const userData = mkdtempSync(join(tmpdir(), 'bc-theme-'))
  const server = { userDataDir: userData, install: async (ids: string[]) => ({ installed: ids, failed: [] }) }
  const importer = new EditorImporter(server as unknown as CodeServer, PATHS, async (id) => ON_OPEN_VSX.has(id) && id !== 'wesbos.theme-cobalt2')
  const plan = await importer.plan('vscode')
  assert.equal(plan.look.theme, 'BetterCoder Dark (Cobalt2 isn’t on Open VSX)')
  await importer.run('vscode')
  const settings = JSON.parse(readFileSync(join(userData, 'User', 'settings.json'), 'utf8'))
  assert.equal(settings['workbench.colorTheme'], 'BetterCoder Dark')
})
