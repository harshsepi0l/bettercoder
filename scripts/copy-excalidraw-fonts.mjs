// The whiteboard (Excalidraw) loads its hand-drawn fonts at run time, from a CDN by default. The window's CSP allows
// fonts from the app only, so they are copied next to the renderer (src/renderer/public/fonts, not in git).
// Runs after npm install. Xiaolai (Chinese/Japanese/Korean, 9 MB) is left out.
import { cpSync, existsSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'

const from = resolve(import.meta.dirname, '..', 'node_modules', '@excalidraw', 'excalidraw', 'dist', 'prod', 'fonts')
const to = resolve(import.meta.dirname, '..', 'src', 'renderer', 'public', 'fonts')
if (existsSync(from)) {
  rmSync(to, { recursive: true, force: true })
  cpSync(from, to, { recursive: true, filter: (src) => !src.startsWith(join(from, 'Xiaolai')) })
}
