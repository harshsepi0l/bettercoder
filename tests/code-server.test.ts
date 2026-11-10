import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { CONFIG_YAML, CodeServer, SESSION_COOKIE, STARTING_SETTINGS, hideOtherRunButtons, registerExtension, removeAiExtensions, withCookie, withStartingSettings } from '../src/main/adapters/code-server'
import { FORCED_SETTINGS } from '../src/main/core/editor-import'
import { mkdirSync } from 'node:fs'

// A stand-in for code-server: serves /healthz on the --bind-addr it is given and records its arguments.
function fakeBin(dir: string): string {
  const bin = join(dir, 'fake-code-server')
  writeFileSync(
    bin,
    `#!/usr/bin/env node
const http = require('node:http')
const fs = require('node:fs')
const args = process.argv.slice(2)
fs.writeFileSync(${JSON.stringify(join(dir, 'args.json'))}, JSON.stringify(args))
fs.writeFileSync(${JSON.stringify(join(dir, 'env.json'))}, JSON.stringify({ HASHED_PASSWORD: process.env.HASHED_PASSWORD, PASSWORD: process.env.PASSWORD, BETTERCODER_EMBEDDED: process.env.BETTERCODER_EMBEDDED }))
const [host, port] = args[args.indexOf('--bind-addr') + 1].split(':')
http.createServer((req, res) => { res.statusCode = req.url === '/healthz' ? 200 : 404; res.end('{}') }).listen(Number(port), host)
`
  )
  chmodSync(bin, 0o755)
  return bin
}

test('code-server: starts on 127.0.0.1, opens the folder, links the extension, writes no-AI settings once', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bc-cs-'))
  const extension = resolve(import.meta.dirname, '..', 'ide', 'vscode')
  const server = new CodeServer({ bin: fakeBin(dir), dataDir: join(dir, 'data'), extension })
  try {
    const url = await server.urlFor('/Users/me/my project')
    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/\?folder=%2FUsers%2Fme%2Fmy%20project$/)

    const args: string[] = JSON.parse(readFileSync(join(dir, 'args.json'), 'utf8'))
    assert.equal(args[args.indexOf('--extensions-dir') + 1], join(dir, 'data', 'extensions'))
    assert.equal(args[args.indexOf('--user-data-dir') + 1], join(dir, 'data', 'user-data'))
    assert.ok(args.includes('--disable-telemetry'))
    assert.match(args[args.indexOf('--bind-addr') + 1], /^127\.0\.0\.1:\d+$/)

    // Locked: password auth, and the only accepted session cookie is this start's random secret.
    assert.equal(args[args.indexOf('--auth') + 1], 'password')
    const env = JSON.parse(readFileSync(join(dir, 'env.json'), 'utf8'))
    assert.match(env.HASHED_PASSWORD, /^[0-9a-f]{64}$/)
    assert.equal(env.PASSWORD, undefined)
    assert.equal(env.BETTERCODER_EMBEDDED, '1', 'the extension knows it runs inside BetterCoder')
    assert.deepEqual(server.cookie, { name: SESSION_COOKIE, value: env.HASHED_PASSWORD })

    assert.equal(readlinkSync(join(dir, 'data', 'extensions', 'bettercoder.bettercoder-ide-0.1.0')), extension)
    const settingsPath = join(dir, 'data', 'user-data', 'User', 'settings.json')
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'))
    assert.equal(settings['chat.disableAIFeatures'], true)
    assert.equal(settings['editor.inlineSuggest.enabled'], false)
    assert.equal(settings['editor.inlayHints.enabled'], 'off')

    // A second start keeps the learner's own changes to settings, and makes a new secret.
    const first = server.cookie.value
    server.stop()
    const port = new URL(await server.start()).port
    server.stop()
    writeFileSync(settingsPath, JSON.stringify({ ...STARTING_SETTINGS, ...FORCED_SETTINGS, 'editor.fontSize': 16 }))
    await server.urlFor('/tmp')
    assert.equal(JSON.parse(readFileSync(settingsPath, 'utf8'))['editor.fontSize'], 16)
    assert.notEqual(server.cookie.value, first)
    // The same port again, so VS Code keeps its window state (stored per address).
    assert.equal(new URL(await server.start()).port, port)
  } finally {
    server.stop()
  }
})

test('code-server: says how to get it when it is not downloaded', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bc-cs-'))
  const server = new CodeServer({ bin: join(dir, 'missing'), dataDir: dir, extension: dir })
  assert.equal(server.available(), false)
  await assert.rejects(server.urlFor('/tmp'), /npm run vscode:fetch/)
})

// Regression: a folder that is only linked into the extensions folder is "marked as removed" by VS Code, so the
// coach extension never loaded. It has to be listed in extensions.json (and taken out of .obsolete).
test('code-server: the coach extension is listed in extensions.json and un-marked as removed', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bc-ext-'))
  const extension = resolve(import.meta.dirname, '..', 'ide', 'vscode')
  const other = { identifier: { id: 'ms-python.python' }, version: '2026.4.0', relativeLocation: 'ms-python.python-2026.4.0-universal' }
  writeFileSync(join(dir, 'extensions.json'), JSON.stringify([other, { identifier: { id: 'bettercoder.bettercoder-ide' }, version: '0.0.1' }]))
  writeFileSync(join(dir, '.obsolete'), JSON.stringify({ 'bettercoder.bettercoder-ide-0.1.0': true, 'old.thing-1.0.0': true }))

  assert.equal(await registerExtension(dir, extension), 'bettercoder.bettercoder-ide')
  await registerExtension(dir, extension) // twice is the same as once

  const list = JSON.parse(readFileSync(join(dir, 'extensions.json'), 'utf8'))
  assert.deepEqual(list[0], other)
  const ours = list.filter((e: { identifier: { id: string } }) => e.identifier.id === 'bettercoder.bettercoder-ide')
  assert.equal(ours.length, 1)
  assert.equal(ours[0].version, '0.1.0')
  assert.equal(ours[0].relativeLocation, 'bettercoder.bettercoder-ide-0.1.0')
  assert.equal(ours[0].location.path, join(dir, 'bettercoder.bettercoder-ide-0.1.0'))
  assert.equal(readlinkSync(join(dir, 'bettercoder.bettercoder-ide-0.1.0')), extension)
  assert.deepEqual(JSON.parse(readFileSync(join(dir, '.obsolete'), 'utf8')), { 'old.thing-1.0.0': true })
})

test('code-server: starting settings fill gaps, and the no-AI rules are put back whatever the file says', () => {
  const fresh = JSON.parse(withStartingSettings(null)!)
  assert.deepEqual(fresh, { ...STARTING_SETTINGS, ...FORCED_SETTINGS })
  assert.equal(fresh['workbench.colorTheme'], 'BetterCoder Dark')

  // Their own choice wins for a starting setting; a forced one is put back.
  const theirs = JSON.parse(withStartingSettings(JSON.stringify({ 'workbench.colorTheme': 'Solarized Light', 'editor.fontSize': 15, 'editor.inlineSuggest.enabled': true }))!)
  assert.equal(theirs['workbench.colorTheme'], 'Solarized Light')
  assert.equal(theirs['editor.fontSize'], 15)
  assert.equal(theirs['editor.inlineSuggest.enabled'], false)
  assert.equal(theirs['chat.disableAIFeatures'], true)

  // Nothing to change: untouched, comments and all.
  const commented = `{\n  // my font\n  "editor.fontSize": 15,\n${Object.entries({ ...STARTING_SETTINGS, ...FORCED_SETTINGS }).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join('\n')}\n}`
  assert.equal(withStartingSettings(commented), null)
  // A commented file that turned AI back on is read and fixed.
  const fixed = JSON.parse(withStartingSettings('{\n  // mine\n  "editor.fontSize": 15,\n  "chat.disableAIFeatures": false,\n}')!)
  assert.equal(fixed['chat.disableAIFeatures'], true)
  assert.equal(fixed['editor.fontSize'], 15)
  // Not settings at all: replaced, so the rules hold.
  assert.deepEqual(JSON.parse(withStartingSettings('[]')!), { ...STARTING_SETTINGS, ...FORCED_SETTINGS })
})

test('code-server: AI extensions are taken out on every start, whatever installed them', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bc-ai-'))
  const ext = (folder: string, manifest: object) => {
    mkdirSync(join(dir, folder), { recursive: true })
    writeFileSync(join(dir, folder, 'package.json'), JSON.stringify(manifest))
    return { identifier: { id: folder.replace(/-\d.*$/, '') }, relativeLocation: folder }
  }
  const list = [
    ext('ms-python.python-2026.4.0', { categories: ['Programming Languages'] }),
    ext('github.copilot-1.2.3', {}),
    ext('someone.helper-0.1.0', { categories: ['Other'], contributes: { languageModels: [{ vendor: 'x' }] } }),
    ext('ms-toolsai.jupyter-2025.9.1', { categories: ['Notebooks'], contributes: { languageModelTools: [{ name: 't' }] } }),
    ext('esbenp.prettier-vscode-11.0.0', { categories: ['Formatters'] })
  ]
  writeFileSync(join(dir, 'extensions.json'), JSON.stringify(list))
  assert.deepEqual(await removeAiExtensions(dir), ['github.copilot', 'someone.helper'])
  const left = JSON.parse(readFileSync(join(dir, 'extensions.json'), 'utf8')).map((e: { identifier: { id: string } }) => e.identifier.id)
  assert.deepEqual(left, ['ms-python.python', 'ms-toolsai.jupyter', 'esbenp.prettier-vscode'])
  assert.deepEqual(JSON.parse(readFileSync(join(dir, '.obsolete'), 'utf8')), { 'github.copilot-1.2.3': true, 'someone.helper-0.1.0': true })
  assert.deepEqual(await removeAiExtensions(dir), [], 'nothing left to remove')
})

test("code-server: Python's own title-bar Run buttons are hidden, so ▶ Run is the one Run there", async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bc-run-'))
  const folder = join(dir, 'ms-python.python-2026.4.0-universal')
  mkdirSync(folder, { recursive: true })
  const menus = {
    'editor/title/run': [
      { command: 'python.execInTerminal-icon', when: 'resourceLangId == python' },
      { command: 'python.execInDedicatedTerminal', when: 'resourceLangId == python' },
      { command: 'python.debugInTerminal', when: 'resourceLangId == python' }
    ],
    'editor/context': [{ command: 'python.execInTerminal-icon' }]
  }
  writeFileSync(join(folder, 'package.json'), JSON.stringify({ name: 'python', contributes: { menus } }))
  assert.equal(await hideOtherRunButtons(dir), 1)
  const after = JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8')).contributes.menus
  assert.deepEqual(after['editor/title/run'], [{ command: 'python.debugInTerminal', when: 'resourceLangId == python' }])
  assert.deepEqual(after['editor/context'], menus['editor/context'], 'other menus keep their entries')
  assert.equal(await hideOtherRunButtons(dir), 0, 'already done: untouched')

  // Jupyter's interactive-window Run goes too; a folder that only starts with the same name is not touched.
  const jupyter = join(dir, 'ms-toolsai.jupyter-2025.9.1-universal')
  const keymap = join(dir, 'ms-toolsai.jupyter-keymap-1.1.2-universal')
  for (const f of [jupyter, keymap]) {
    mkdirSync(f, { recursive: true })
    writeFileSync(join(f, 'package.json'), JSON.stringify({ contributes: { menus: { 'editor/title/run': [{ command: 'jupyter.runFileInteractive' }] } } }))
  }
  assert.equal(await hideOtherRunButtons(dir), 1)
  assert.deepEqual(JSON.parse(readFileSync(join(jupyter, 'package.json'), 'utf8')).contributes.menus['editor/title/run'], [])
  assert.equal(JSON.parse(readFileSync(join(keymap, 'package.json'), 'utf8')).contributes.menus['editor/title/run'].length, 1)
})

test('code-server: the session cookie is added to the Cookie header, replacing an old one', () => {
  assert.equal(withCookie(undefined, 'code-server-session', 's1'), 'code-server-session=s1')
  assert.equal(withCookie('a=1; code-server-session=old; b=2', 'code-server-session', 's2'), 'a=1; b=2; code-server-session=s2')
})

// Regression: a config.yaml of only comments is "an empty document" to code-server, which then exits at once
// ("expected a document, but the input is empty"), so VS Code never opened on a fresh install.
test('code-server: its config file always holds a setting, even over an old comments-only file', async () => {
  assert.ok(CONFIG_YAML.split('\n').some((l) => /^[a-z-]+:\s*\S/.test(l)), 'config.yaml must have a setting line')
  const dir = mkdtempSync(join(tmpdir(), 'bc-cfg-'))
  const data = join(dir, 'data')
  const { mkdirSync } = await import('node:fs')
  mkdirSync(data, { recursive: true })
  writeFileSync(join(data, 'config.yaml'), '# only a comment\n')
  const server = new CodeServer({ bin: fakeBin(dir), dataDir: data, extension: resolve(import.meta.dirname, '..', 'ide', 'vscode') })
  try {
    await server.urlFor('/tmp')
    assert.equal(readFileSync(join(data, 'config.yaml'), 'utf8'), CONFIG_YAML)
  } finally {
    server.stop()
  }
})
