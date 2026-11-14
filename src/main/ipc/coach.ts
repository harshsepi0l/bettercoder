import { ipcMain } from 'electron'
import { COACH_MODES, HARNESS_IPC } from '../../shared/harness'
import type { IpcContext } from './context'

const INTENTS = ['visualize', 'stuck', 'where', 'next'] as const
const CARD_USES = new Set(['pseudocode_all', 'pseudocode_steps', 'example_full'])

/** Talking to the coach: messages (with a button's intent), stop, and how cards were used. */
export function registerCoachIpc({ workspace }: IpcContext): void {
  ipcMain.handle(HARNESS_IPC.send, async (_e, text: unknown, intent: unknown, mode: unknown) => {
    if (typeof text !== 'string' || text.trim() === '') return
    const chosen = INTENTS.find((k) => k === intent)
    await workspace.send(text.trim().slice(0, 8000), chosen, COACH_MODES.find((m) => m === mode))
  })

  ipcMain.handle(HARNESS_IPC.abort, () => workspace.abort())

  ipcMain.handle(HARNESS_IPC.cardUse, (_e, kind: unknown) => {
    if (typeof kind === 'string' && CARD_USES.has(kind)) workspace.cardUse(kind as never)
  })
}
