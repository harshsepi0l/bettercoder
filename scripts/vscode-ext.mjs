// Installs (or lists) extensions in the app's built-in VS Code, from Open VSX, always with the app's own folders and
// config, so nothing lands in ~/.config/code-server or the learner's own VS Code.
// Run: npm run vscode:ext -- ms-python.python charliermarsh.ruff     (no names: lists what is installed)
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const userData =
  process.platform === 'darwin'
    ? join(homedir(), 'Library', 'Application Support', 'BetterCoder')
    : process.platform === 'win32'
      ? join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'BetterCoder')
      : join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'BetterCoder')
const data = join(userData, 'vscode')
const bin = resolve(import.meta.dirname, '..', 'vendor', 'code-server', 'bin', 'code-server')
if (!existsSync(bin)) {
  console.error('VS Code is not downloaded yet. Run: npm run vscode:fetch')
  process.exit(1)
}
mkdirSync(data, { recursive: true })
const config = join(data, 'config.yaml')
// At least one setting: a file of only comments is "an empty document" and code-server refuses to start.
writeFileSync(config, '# BetterCoder starts code-server with its own flags and a new secret each time.\nauth: password\ncert: false\n')

const names = process.argv.slice(2)
const args = ['--config', config, '--user-data-dir', join(data, 'user-data'), '--extensions-dir', join(data, 'extensions')]
if (names.length === 0) args.push('--list-extensions', '--show-versions')
else for (const n of names) args.push('--install-extension', n)
const env = { ...process.env }
delete env.NODE_OPTIONS
const r = spawnSync(bin, args, { stdio: 'inherit', env })
process.exit(r.status ?? 1)
