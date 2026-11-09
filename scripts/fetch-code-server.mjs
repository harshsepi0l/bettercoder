// Downloads code-server (MIT, github.com/coder/code-server): the open-source VS Code that runs in the Code tab.
// Pinned to one release and checked against the SHA-256 GitHub publishes for it, then unpacked into vendor/code-server.
// Run: npm run vscode:fetch
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const VERSION = '4.145.2'
const SHA256 = {
  'darwin-arm64': 'd6699692f1e59d918517c81f9d2a4ef335132128cd45725b22236d5fe09636d4',
  'darwin-x64': '5fb7ac2bd60538400244d942f649559e0ff4fb3d8792979287f504780f357af6',
  'linux-arm64': 'e867a34416e2da4a83496b09580001893e7a4e5bb58a0624c4fcd22819e7d53d',
  'linux-x64': '2f6db6c3e8b733dd6b3aeee83532e148b2bae2e392353ba85452d03572348962'
}
const ASSET = {
  'darwin-arm64': 'macos-arm64',
  'darwin-x64': 'macos-amd64',
  'linux-arm64': 'linux-arm64',
  'linux-x64': 'linux-amd64'
}

const key = `${process.platform}-${process.arch}`
if (!ASSET[key]) {
  console.error(`code-server has no build for ${key}.`)
  process.exit(1)
}

const vendor = resolve(import.meta.dirname, '..', 'vendor')
const dest = join(vendor, 'code-server')
const stamp = join(dest, '.bettercoder-version')
if (existsSync(stamp) && readFileSync(stamp, 'utf8').trim() === VERSION) {
  console.log(`code-server ${VERSION} is already in vendor/code-server.`)
  process.exit(0)
}

const name = `code-server-${VERSION}-${ASSET[key]}`
const url = `https://github.com/coder/code-server/releases/download/v${VERSION}/${name}.tar.gz`
console.log(`Downloading ${url}`)
const res = await fetch(url)
if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`)
const bytes = Buffer.from(await res.arrayBuffer())
const sum = createHash('sha256').update(bytes).digest('hex')
if (sum !== SHA256[key]) throw new Error(`Checksum mismatch for ${name}: got ${sum}`)

mkdirSync(vendor, { recursive: true })
const tgz = join(vendor, `${name}.tar.gz`)
writeFileSync(tgz, bytes)
rmSync(join(vendor, name), { recursive: true, force: true })
execFileSync('tar', ['xzf', tgz, '-C', vendor])
rmSync(tgz)
rmSync(dest, { recursive: true, force: true })
renameSync(join(vendor, name), dest)
writeFileSync(stamp, VERSION + '\n')
console.log(`code-server ${VERSION} is in vendor/code-server.`)
