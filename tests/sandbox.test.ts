import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveInside } from '../src/main/adapters/fs-readonly'
import { SandboxError, isSecretPath, redactSecrets } from '../src/main/core/paths'

async function makeProject() {
  const root = await mkdtemp(join(tmpdir(), 'wp-sandbox-'))
  await mkdir(join(root, 'src'))
  await writeFile(join(root, 'src', 'main.py'), 'print("hi")\n')
  await writeFile(join(root, '.env'), 'API_KEY=abc123\n')
  const outside = await mkdtemp(join(tmpdir(), 'wp-outside-'))
  await writeFile(join(outside, 'private.txt'), 'nope')
  await symlink(join(outside, 'private.txt'), join(root, 'sneaky.txt'))
  return { root, outside }
}

test('paths inside the project resolve', async () => {
  const { root } = await makeProject()
  const r = await resolveInside(root, 'src/main.py')
  assert.equal(r.rel, join('src', 'main.py'))
})

test('escaping the project is refused, including via symlink and ..', async () => {
  const { root, outside } = await makeProject()
  await assert.rejects(resolveInside(root, '../'), SandboxError)
  await assert.rejects(resolveInside(root, join(outside, 'private.txt')), SandboxError)
  await assert.rejects(resolveInside(root, 'sneaky.txt'), SandboxError)
  await assert.rejects(resolveInside(root, '/etc/hosts'), SandboxError)
})

test('secret files are refused', async () => {
  const { root } = await makeProject()
  await assert.rejects(resolveInside(root, '.env'), /secrets/)
  for (const p of ['.env.local', 'config/secrets.json', 'keys/server.pem', 'id_ed25519', 'credentials.yml']) {
    assert.ok(isSecretPath(p), p)
  }
  for (const p of ['src/env.py', 'environment.md', 'Program.cs', 'keyboard.ts']) {
    assert.ok(!isSecretPath(p), p)
  }
})

test('credential-looking values are redacted', () => {
  const out = redactSecrets('password = "hunter22"\nOPENAI=sk-abcdefghijklmnopqrstuvwxyz\nAKIAABCDEFGHIJKLMNOP\nname = "orders"')
  assert.ok(!out.includes('hunter22'))
  assert.ok(!out.includes('sk-abcdefghijklmnopqrstuvwxyz'))
  assert.ok(!out.includes('AKIAABCDEFGHIJKLMNOP'))
  assert.ok(out.includes('name = "orders"'))
})
