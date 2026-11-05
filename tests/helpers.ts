import { after } from 'node:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createModels, fauxProvider } from '@earendil-works/pi-ai'
import type { HarnessEvent } from '../src/shared/harness'
import type { ProjectInfo } from '../src/shared/ipc'
import { Coach } from '../src/main/coach/coach'
import { realPorts } from '../src/main/ipc/ports'

const open: Array<{ close(): Promise<void> }> = []
after(async () => {
  for (const c of open) await c.close().catch(() => undefined)
})

/** Something that must be closed when the test file ends (pi-durable keeps timers alive). */
export function track<T extends { close(): Promise<void> }>(c: T): T {
  open.push(c)
  return c
}

/** A coach on pi-durable with pi's faux model, on a fresh SQLite file. */
export async function openCoach(project: ProjectInfo) {
  const faux = fauxProvider()
  const models = createModels()
  models.setProvider(faux.provider)
  const events: HarnessEvent[] = []
  const dir = await mkdtemp(join(tmpdir(), 'bc-coach-'))
  const session = track(
    await Coach.open(join(dir, 'session.sqlite'), project, (e) => events.push(e), {
      ports: realPorts(),
      models,
      resolveModel: async () => faux.getModel()
    })
  )
  return { faux, session, events, models }
}

/** Open a coach on a given session file with a given faux provider (to reopen a session, as after a restart). */
export async function openCoachAt(file: string, project: ProjectInfo, faux: ReturnType<typeof fauxProvider>) {
  const models = createModels()
  models.setProvider(faux.provider)
  const events: HarnessEvent[] = []
  const session = await Coach.open(file, project, (e) => events.push(e), {
    ports: realPorts(),
    models,
    resolveModel: async () => faux.getModel()
  })
  return { session: track(session), events }
}
