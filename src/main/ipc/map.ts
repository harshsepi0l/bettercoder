import { join } from 'node:path'
import { app, ipcMain } from 'electron'
import { MAP_IPC } from '../../shared/map'
import { buildMap } from '../engines/map/build-map'
import { createDocExamples, editorExample, exampleLanguage } from '../engines/map/doc-examples'
import type { ToIde } from '../../shared/ide'
import { projectStackDocs } from '../engines/map/project-docs'
import { asString, needProject, type IpcContext } from './context'

/**
 * The Map tab and Sources: the code map, the stack's official docs, and word-for-word doc examples (also for the
 * editor's "See the official line").
 */
export function registerMapIpc({ workspace }: IpcContext): { official(url: string, term: string): Promise<ToIde> } {
  ipcMain.handle(MAP_IPC.build, async () => buildMap(needProject(workspace)))

  ipcMain.handle(MAP_IPC.stackDocs, async () => projectStackDocs(workspace.activeProject()))

  const docExamples = createDocExamples(join(app.getPath('userData'), 'doc-examples'))
  const lang = () => {
    const p = workspace.activeProject()
    return exampleLanguage(p?.stacks ?? [], p?.languages.map((l) => l.name) ?? [])
  }
  ipcMain.handle(MAP_IPC.docExample, async (_e, url: unknown, term: unknown) => docExamples(asString(url, 'Link'), asString(term, 'Term'), lang()))

  return {
    // Fetched by the app from the allowlist of official sites, never from the model; only the editor shows it.
    official: async (url, term) => ({ type: 'official', url, term, ...editorExample(await docExamples(url, term, lang())) })
  }
}
