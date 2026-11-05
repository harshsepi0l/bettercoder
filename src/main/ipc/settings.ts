import { randomUUID } from 'node:crypto'
import { ipcMain, shell } from 'electron'
import { HARNESS_IPC, type AuthUiEvent } from '../../shared/harness'
import {
  BLOCKED_SIGN_IN,
  ensureDefaultModel,
  forgetSkill,
  getSettings,
  models,
  noteSkill,
  setProfile,
  setSelectedModel
} from '../adapters/providers'
import { asProvider, asString, type IpcContext } from './context'

/** Settings: the learner profile and skills, provider sign-in (keys and accounts), and the model. */
export function registerSettingsIpc({ getWindow, ready }: IpcContext): void {
  let login: AbortController | null = null
  const emitAuth = (event: AuthUiEvent) => getWindow()?.webContents.send(HARNESS_IPC.authEvent, event)

  ipcMain.handle(HARNESS_IPC.getSettings, async () => {
    await ready
    return getSettings()
  })

  ipcMain.handle(HARNESS_IPC.setSkill, async (_e, language: unknown, topic: unknown, level: unknown) => {
    await ready
    if (level !== 'new' && level !== 'basics' && level !== 'pro') throw new Error('Unknown level')
    await noteSkill({ language: asString(language, 'Language'), topic: asString(topic, 'Topic'), level, evidence: 'you set this', by: 'you' })
    return getSettings()
  })

  ipcMain.handle(HARNESS_IPC.forgetSkill, async (_e, language: unknown, topic: unknown) => {
    await ready
    await forgetSkill(asString(language, 'Language'), asString(topic, 'Topic'))
    return getSettings()
  })

  ipcMain.handle(HARNESS_IPC.setProfile, async (_e, profile: unknown) => {
    await ready
    await setProfile(profile)
    return getSettings()
  })

  /** Questions a provider's connect flow is waiting on, answered from the panel. */
  const prompts = new Map<string, { resolve: (v: string) => void; reject: (e: Error) => void }>()

  ipcMain.handle(HARNESS_IPC.answerPrompt, (_e, id: unknown, value: unknown) => {
    const pending = typeof id === 'string' ? prompts.get(id) : undefined
    if (!pending) return
    prompts.delete(id as string)
    if (typeof value === 'string') pending.resolve(value)
    else pending.reject(new Error('Cancelled.'))
  })

  ipcMain.handle(HARNESS_IPC.login, async (_e, provider: unknown, kind: unknown) => {
    const id = asProvider(provider)
    const type = kind === 'oauth' ? 'oauth' : 'api_key'
    if (type === 'oauth' && BLOCKED_SIGN_IN[id]) throw new Error(BLOCKED_SIGN_IN[id])
    login?.abort()
    const controller = new AbortController()
    login = controller
    try {
      await models.login(id, type, {
        signal: controller.signal,
        notify: (event) => {
          if (event.type === 'device_code') {
            emitAuth({ type: 'device_code', userCode: event.userCode, verificationUri: event.verificationUri })
            if (event.verificationUri.startsWith('https://')) void shell.openExternal(event.verificationUri)
          } else if (event.type === 'auth_url') {
            if (event.url.startsWith('https://')) void shell.openExternal(event.url)
            emitAuth({ type: 'auth_url', url: event.url, instructions: event.instructions })
          } else if (event.type === 'progress' || event.type === 'info') {
            emitAuth({ type: event.type, message: event.message })
          }
        },
        // Whatever the provider asks (a key, a region, an account choice, a pasted code) is asked in the panel.
        prompt: (p) =>
          new Promise<string>((resolve, reject) => {
            const promptId = randomUUID()
            prompts.set(promptId, { resolve, reject })
            const onAbort = () => {
              prompts.delete(promptId)
              reject(new Error('Cancelled.'))
            }
            ;(p.signal ?? controller.signal).addEventListener('abort', onAbort, { once: true })
            emitAuth({
              type: 'prompt',
              id: promptId,
              provider: id,
              prompt:
                p.type === 'select'
                  ? { type: 'select', message: p.message, options: p.options.map((o) => ({ ...o })) }
                  : { type: p.type, message: p.message, placeholder: p.placeholder }
            })
          })
      })
      await ensureDefaultModel(id)
      emitAuth({ type: 'done' })
    } catch (err) {
      const message = controller.signal.aborted ? 'Cancelled.' : err instanceof Error ? err.message : String(err)
      emitAuth({ type: 'error', message })
    } finally {
      if (login === controller) login = null
    }
    return getSettings()
  })

  ipcMain.handle(HARNESS_IPC.cancelLogin, () => login?.abort())

  ipcMain.handle(HARNESS_IPC.logout, async (_e, provider: unknown) => {
    await models.logout(asProvider(provider))
    return getSettings()
  })

  ipcMain.handle(HARNESS_IPC.setModel, async (_e, provider: unknown, id: unknown) => {
    if (typeof id !== 'string') throw new Error('Model id required')
    await setSelectedModel(asProvider(provider), id)
    return getSettings()
  })
}
