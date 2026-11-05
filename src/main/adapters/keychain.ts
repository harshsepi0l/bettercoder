import { app, safeStorage } from 'electron'
import { join } from 'node:path'
import { EncryptedCredentialStore } from './credential-store'

/** pi's CredentialStore in the app's data folder, encrypted with the OS keychain (Electron safeStorage, async API). */
export class KeychainCredentialStore extends EncryptedCredentialStore {
  constructor() {
    super(() => join(app.getPath('userData'), 'credentials.bin'), safeStorage)
  }
}
