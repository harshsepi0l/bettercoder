// node-pty's macOS prebuilds ship `spawn-helper` without the execute bit, so every terminal fails with
// "posix_spawnp failed". Runs after npm install. node-pty is N-API, so the same binary loads in Node (tests) and
// Electron: no Electron rebuild is needed.
import { chmodSync, existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const prebuilds = resolve(import.meta.dirname, '..', 'node_modules', 'node-pty', 'prebuilds')
if (existsSync(prebuilds)) {
  for (const dir of readdirSync(prebuilds)) {
    const helper = join(prebuilds, dir, 'spawn-helper')
    if (existsSync(helper)) chmodSync(helper, 0o755)
  }
}
