import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EncryptedCredentialStore, type Encryptor } from '../src/main/adapters/credential-store'

/** A stand-in for the OS keychain: "encrypts" by reversing bytes, and can report a rotated key. */
function fakeKeychain(rotated = false) {
  const calls = { encrypt: 0 }
  const crypto: Encryptor = {
    isAsyncEncryptionAvailable: async () => true,
    encryptStringAsync: async (s: string) => (calls.encrypt++, Buffer.from(s, 'utf8').reverse()),
    decryptStringAsync: async (b: Buffer) => ({ result: Buffer.from(b).reverse().toString('utf8'), shouldReEncrypt: rotated })
  }
  return { crypto, calls }
}

/** Regression (2026-11-04): the sync safeStorage calls are deprecated in Electron 45 and warned on every start. */
test('keychain: keys are stored and read with the async OS encryption, never as plain text', async () => {
  const file = join(await mkdtemp(join(tmpdir(), 'bc-keys-')), 'credentials.bin')
  const { crypto } = fakeKeychain()
  const store = new EncryptedCredentialStore(() => file, crypto)
  await store.modify('xai', async () => ({ type: 'api_key', key: 'xai-secret' }) as never)
  assert.doesNotMatch(await readFile(file, 'utf8'), /xai-secret/, 'not plain text on disk')
  const again = new EncryptedCredentialStore(() => file, crypto)
  assert.equal(((await again.read('xai')) as { key?: string })?.key, 'xai-secret')
})

test('keychain: a rotated OS key re-encrypts the file on read', async () => {
  const file = join(await mkdtemp(join(tmpdir(), 'bc-keys-')), 'credentials.bin')
  await new EncryptedCredentialStore(() => file, fakeKeychain().crypto).modify('xai', async () => ({ type: 'api_key', key: 'k' }) as never)
  const rotated = fakeKeychain(true)
  assert.equal(((await new EncryptedCredentialStore(() => file, rotated.crypto).read('xai')) as { key?: string })?.key, 'k')
  assert.equal(rotated.calls.encrypt, 1)
})
