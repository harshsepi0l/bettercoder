// Installs the BetterCoder editor extension for development: links ide/vscode into each editor's extensions folder
// that exists (VS Code, Cursor, Windsurf, VSCodium). Restart the editor afterwards. Run again any time; it is idempotent.
import { existsSync, lstatSync, readlinkSync, rmSync, symlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const source = resolve(import.meta.dirname, '..', 'ide', 'vscode')
const name = 'bettercoder.bettercoder-ide-0.1.0'
const editors = { 'VS Code': '.vscode', Cursor: '.cursor', Windsurf: '.windsurf', VSCodium: '.vscode-oss' }

let linked = 0
for (const [editor, dir] of Object.entries(editors)) {
  const extensions = join(homedir(), dir, 'extensions')
  if (!existsSync(extensions)) continue
  const target = join(extensions, name)
  let current = null
  try {
    current = lstatSync(target).isSymbolicLink() ? readlinkSync(target) : 'not a link'
  } catch {}
  if (current === source) {
    console.log(`${editor}: already linked`)
  } else {
    if (current === 'not a link') {
      console.log(`${editor}: ${target} exists and is not a link; leaving it alone`)
      continue
    }
    if (current) rmSync(target)
    symlinkSync(source, target, 'dir')
    console.log(`${editor}: linked`)
  }
  linked++
}
console.log(linked ? 'Restart your editor to load BetterCoder.' : 'No VS Code, Cursor, Windsurf or VSCodium extensions folder found.')
