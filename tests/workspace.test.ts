import { test } from 'node:test'
import assert from 'node:assert/strict'
import { access, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai'
import type { HarnessEvent } from '../src/shared/harness'
import { WorkspaceController } from '../src/main/services/workspace'
import { WorkspaceStore } from '../src/main/adapters/store'
import { track } from './helpers'
import { realPorts } from '../src/main/ipc/ports'

async function setup() {
  const dataDir = await mkdtemp(join(tmpdir(), 'wp-data-'))
  const projectDir = await mkdtemp(join(tmpdir(), 'wp-proj-'))
  await writeFile(join(projectDir, 'app.py'), 'print("hi")\n')
  const faux = fauxProvider()
  const models = createModels()
  models.setProvider(faux.provider)
  const make = () => {
    const events: HarnessEvent[] = []
    const controller = new WorkspaceController(new WorkspaceStore(dataDir), {
      ports: realPorts(),
      emit: (e) => events.push(e),
      changed: () => {},
      models,
      resolveModel: async () => faux.getModel()
    })
    track({ close: () => controller.shutdown() })
    return { controller, events }
  }
  return { faux, projectDir, make }
}

async function idle(events: HarnessEvent[]): Promise<void> {
  for (let i = 0; i < 1000; i++) {
    const busy = events.filter((e) => e.type === 'busy')
    if (busy.length > 0 && busy.at(-1)?.type === 'busy' && !(busy.at(-1) as { busy: boolean }).busy) return
    await new Promise((r) => setTimeout(r, 5))
  }
  throw new Error('never went idle')
}

test('sessions are grouped under their project; a folder is one project', async () => {
  const { projectDir, make } = await setup()
  const { controller } = make()
  const a = await controller.openPaths([projectDir])
  const b = await controller.newSession(a.project.id)
  const again = await controller.openFolder(projectDir)
  assert.equal(b.project.id, a.project.id)
  assert.equal(again.project.id, a.project.id)
  const list = await controller.list()
  assert.equal(list.length, 1)
  assert.equal(list[0].sessions.length, 3)
})

test('a session is saved and resumes with its chat and transcript', async () => {
  const { faux, projectDir, make } = await setup()
  const first = make()
  const opened = await first.controller.openFolder(projectDir)
  faux.setResponses([fauxAssistantMessage('What did you expect remove(1) to do?')])
  await first.controller.send('my remove is broken')
  await idle(first.events)
  await first.controller.shutdown() // as when quitting the app: one process owns a session's file at a time

  // A fresh controller, as after restarting the app.
  const second = make()
  const resumed = await second.controller.openSession(opened.session.id)
  assert.equal(resumed.session.title, 'my remove is broken')
  assert.deepEqual(
    resumed.session.items.map((i) => i.kind),
    ['user', 'assistant']
  )

  let sawHistory = false
  faux.setResponses([
    (context) => {
      sawHistory = context.messages.some(
        (m) => m.role === 'user' && JSON.stringify(m.content).includes('my remove is broken')
      )
      return fauxAssistantMessage('Good. Now, which number does the list start from?')
    }
  ])
  await second.controller.send('it deletes the wrong item')
  await idle(second.events)
  assert.ok(sawHistory, 'the resumed coach should remember the earlier conversation')
})

test('events from a session you switched away from do not leak into the open one', async () => {
  const { faux, projectDir, make } = await setup()
  const { controller, events } = make()
  const one = await controller.openFolder(projectDir)
  faux.setResponses([fauxAssistantMessage('slow reply')])
  void controller.send('hello')
  const two = await controller.newSession(one.project.id)
  await new Promise((r) => setTimeout(r, 50))
  const afterSwitch = events.slice(events.findIndex((e) => e.type === 'session_opened' && e.open.session.id === two.session.id))
  assert.ok(!afterSwitch.some((e) => e.type === 'text' && e.delta.includes('slow reply')))
})

test('opening individual files: the coach can see only those files', async () => {
  const { faux, projectDir, make } = await setup()
  await writeFile(join(projectDir, 'other.py'), 'SECRET_PLAN = "nope"\n')
  const { controller, events } = make()
  const opened = await controller.openPaths([join(projectDir, 'app.py')])
  assert.deepEqual(opened.project.files, ['app.py'])
  assert.equal(opened.project.name, 'app.py')

  const results: string[] = []
  faux.setResponses([
    fauxAssistantMessage(
      [
        fauxToolCall('read_file', { path: 'app.py' }),
        fauxToolCall('read_file', { path: 'other.py' }),
        fauxToolCall('search', { query: 'SECRET_PLAN' }),
        fauxToolCall('list_files', {})
      ],
      { stopReason: 'toolUse' }
    ),
    (context) => {
      for (const m of context.messages) {
        if (m.role === 'toolResult') for (const c of m.content) if (c.type === 'text') results.push(c.text)
      }
      return fauxAssistantMessage('Looked.')
    }
  ])
  await controller.send('what does my file do?')
  await idle(events)
  const all = results.join('\n')
  assert.ok(all.includes('print("hi")'), 'the opened file is readable')
  assert.ok(all.includes('only see the files you opened'), 'other files are refused')
  assert.ok(!all.includes('SECRET_PLAN = "nope"'), 'other files never leak, even via search')
  assert.ok(all.includes('opened on these files only'), 'list_files shows only the opened files')

  const list = await controller.list()
  assert.equal(list.find((p) => p.id === opened.project.id)?.kind, 'files')
})

test('a folder and files cannot be opened together', async () => {
  const { projectDir, make } = await setup()
  const { controller } = make()
  await assert.rejects(controller.openPaths([projectDir, join(projectDir, 'app.py')]), /not both/)
})

test('deleting the open session closes it and removes it from the list', async () => {
  const { projectDir, make } = await setup()
  const { controller, events } = make()
  const keep = await controller.openPaths([projectDir])
  const drop = await controller.newSession(keep.project.id)
  await controller.deleteSession(drop.session.id)
  assert.equal(events.at(-1)?.type, 'session_closed')
  const sessions = (await controller.list())[0].sessions.map((s) => s.id)
  assert.deepEqual(sessions, [keep.session.id])
  await assert.rejects(controller.openSession(drop.session.id), /could not be found/)
})

test('deleting a project removes all its sessions but never touches the folder on disk', async () => {
  const { projectDir, make } = await setup()
  const { controller } = make()
  const one = await controller.openPaths([projectDir])
  await controller.newSession(one.project.id)
  await controller.deleteProject(one.project.id)
  assert.deepEqual(await controller.list(), [])
  await access(join(projectDir, 'app.py')) // still there
})

/** Regression (2026-11-04): leaving a session stamped it "updated now", so clicking around reshuffled the sidebar. */
test('opening and leaving sessions keeps their order; only sending a message moves one up', async () => {
  const { faux, projectDir, make } = await setup()
  const { controller, events } = make()
  const a = await controller.openFolder(projectDir)
  await new Promise((r) => setTimeout(r, 5))
  const b = await controller.newSession(a.project.id)
  await new Promise((r) => setTimeout(r, 5))
  const c = await controller.newSession(a.project.id)
  const order = async () => (await controller.list())[0].sessions.map((s) => s.id)
  const before = await order()
  assert.deepEqual(before, [c.session.id, b.session.id, a.session.id], 'newest first')

  await controller.openSession(a.session.id)
  await controller.openSession(b.session.id)
  await controller.openSession(c.session.id)
  assert.deepEqual(await order(), before, 'clicking through sessions changes nothing')

  await controller.openSession(a.session.id)
  faux.setResponses([fauxAssistantMessage('**Hi**')])
  await new Promise((r) => setTimeout(r, 5))
  await controller.send('hello')
  await idle(events)
  assert.equal((await order())[0], a.session.id, 'a message moves it to the top')
})

/** Regression (2026-11-04): opening a project's session sent the project to the top of the sidebar. */
test('opening a project does not reorder projects; a message in it does', async () => {
  const { faux, make } = await setup()
  const { controller, events } = make()
  const dirs = await Promise.all([0, 1].map(async () => {
    const d = await mkdtemp(join(tmpdir(), 'wp-proj-'))
    await writeFile(join(d, 'app.py'), 'print("hi")\n')
    return d
  }))
  const first = await controller.openFolder(dirs[0])
  await new Promise((r) => setTimeout(r, 5))
  const second = await controller.openFolder(dirs[1])
  const order = async () => (await controller.list()).map((p) => p.id)
  assert.deepEqual(await order(), [second.project.id, first.project.id])

  await new Promise((r) => setTimeout(r, 5))
  await controller.openSession(first.session.id)
  assert.deepEqual(await order(), [second.project.id, first.project.id], 'opening changes nothing')

  faux.setResponses([fauxAssistantMessage('**Hi**')])
  await new Promise((r) => setTimeout(r, 5))
  await controller.send('hello')
  await idle(events)
  assert.equal((await order())[0], first.project.id, 'a message moves its project up')
})
