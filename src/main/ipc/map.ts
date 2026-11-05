import { join } from 'node:path'
import { app, ipcMain } from 'electron'
import { MAP_IPC } from '../../shared/map'
import { buildMap } from '../engines/map/build-map'
import { createDocExamples, exampleLanguage } from '../engines/map/doc-examples'
import { projectStackDocs } from '../engines/map/project-docs'
import { asString, needProject, type IpcContext } from './context'

/** The Map tab and Sources: the code map, the stack's official docs, and word-for-word doc examples. */
export function registerMapIpc({ workspace }: IpcContext): void {
  ipcMain.handle(MAP_IPC.build, async () => buildMap(needProject(workspace)))

  ipcMain.handle(MAP_IPC.stackDocs, async () => projectStackDocs(workspace.activeProject()))

  const docExamples = createDocExamples(join(app.getPath('userData'), 'doc-examples'))
  ipcMain.handle(MAP_IPC.docExample, async (_e, url: unknown, term: unknown) => {
    const p = workspace.activeProject()
    return docExamples(asString(url, 'Link'), asString(term, 'Term'), exampleLanguage(p?.stacks ?? [], p?.languages.map((l) => l.name) ?? []))
  })
}
