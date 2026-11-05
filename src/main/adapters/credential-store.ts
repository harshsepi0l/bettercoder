import { readFile, rename, writeFile } from 'node:fs/promises'
import type { Credential, CredentialInfo, CredentialStore } from '@earendil-works/pi-ai'

/**
 * pi's CredentialStore, kept in one encrypted file. Keys and sign-in tokens never leave the main process.
 * `keychain.ts` wires it to the OS keychain (Electron safeStorage) and the app's data folder.
 */
/** The part of Electron's safeStorage used here (the async API; the sync one is deprecated). No Electron import, so it is testable. */
export interface Encryptor {
  isAsyncEncryptionAvailable(): Promise<boolean>
  encryptStringAsync(plainText: string): Promise<Buffer>
  decryptStringAsync(encrypted: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }>
}

export class EncryptedCredentialStore implements CredentialStore {
  constructor(
    private readonly locate: () => string,
    private readonly crypto: Encryptor
  ) {}

  private get file(): string {
    return this.locate()
  }
  private cache: Record<string, Credential> | null = null
  /** Serialises writes so concurrent refreshes cannot interleave. */
  private chain: Promise<unknown> = Promise.resolve()

  private async load(): Promise<Record<string, Credential>> {
    if (this.cache) return this.cache
    try {
      const raw = await readFile(this.file)
      if (await this.crypto.isAsyncEncryptionAvailable()) {
        const { result, shouldReEncrypt } = await this.crypto.decryptStringAsync(raw)
        this.cache = JSON.parse(result) as Record<string, Credential>
        // The OS key was rotated: store it again under the new key (best effort; the keys already read still work).
        if (shouldReEncrypt) await this.save(this.cache).catch(() => undefined)
      } else {
        this.cache = JSON.parse(raw.toString('utf8')) as Record<string, Credential>
      }
    } catch {
      this.cache = {}
    }
    return this.cache
  }

  private async save(all: Record<string, Credential>): Promise<void> {
    if (!(await this.crypto.isAsyncEncryptionAvailable())) {
      throw new Error('The OS keychain is not available, so BetterCoder will not store credentials.')
    }
    const tmp = `${this.file}.tmp`
    await writeFile(tmp, await this.crypto.encryptStringAsync(JSON.stringify(all)), { mode: 0o600 })
    await rename(tmp, this.file)
    this.cache = all
  }

  async read(providerId: string): Promise<Credential | undefined> {
    return (await this.load())[providerId]
  }

  async list(): Promise<readonly CredentialInfo[]> {
    return Object.entries(await this.load()).map(([providerId, c]) => ({ providerId, type: c.type }))
  }

  modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>
  ): Promise<Credential | undefined> {
    const run = this.chain.then(async () => {
      const all = { ...(await this.load()) }
      const next = await fn(all[providerId])
      if (next) all[providerId] = next
      else delete all[providerId]
      await this.save(all)
      return next
    })
    this.chain = run.catch(() => undefined)
    return run
  }

  async delete(providerId: string): Promise<void> {
    await this.modify(providerId, async () => undefined)
  }
}
