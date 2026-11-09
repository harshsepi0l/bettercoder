import { app, type BrowserWindow } from 'electron'
import { HARNESS_IPC, type HarnessEvent } from '../../shared/harness'
import { IDE_IPC } from '../../shared/ide'
import { WORKSPACE_IPC } from '../../shared/workspace'
import { IdeBridge } from '../adapters/ide-socket'
import { currentModel, getProfile, loadSettings, models, noteSkill } from '../adapters/providers'
import { WorkspaceStore } from '../adapters/store'
import { codeSkills } from '../engines/map/code-skills'
import { buildMap } from '../engines/map/build-map'
import { IdeHub } from '../services/editor-link'
import { WorkspaceController } from '../services/workspace'
import { registerRuns } from './code'
import { registerCoachIpc } from './coach'
import { realPorts } from './ports'
import type { IpcContext } from './context'
import { registerEditorIpc } from './editor'
import { registerMapIpc } from './map'
import { registerSettingsIpc } from './settings'
import { registerVisualizeIpc } from './visualize'
import { registerVscodeIpc } from './vscode'
import { registerWorkspaceIpc } from './workspace'

/**
 * Builds the app's parts and wires them to the window: the workspace (projects and sessions, each with its live
 * coach), the editor link, and one IPC file per area. The only file that knows about all of them.
 */
export function registerHarness(getWindow: () => BrowserWindow | null): { flush(): Promise<void> } {
  const emit = (event: HarnessEvent) => getWindow()?.webContents.send(HARNESS_IPC.event, event)
  const ready = loadSettings()

  // The editor link: a local socket the BetterCoder extension inside the Code tab's VS Code connects to.
  const hubBox: { hub?: IdeHub } = {}
  const bridge = new IdeBridge(() => hubBox.hub?.changed())
  const ide = new IdeHub(bridge, (view) => getWindow()?.webContents.send(IDE_IPC.state, view))
  hubBox.hub = ide
  void bridge
    .listen()
    .then(() => ide.start())
    .catch((err) => console.warn('[bettercoder] editor link unavailable:', err instanceof Error ? err.message : err))

  const codeBox: { code?: ReturnType<typeof registerRuns> } = {}
  const workspace = new WorkspaceController(new WorkspaceStore(app.getPath('userData')), {
    ports: realPorts(),
    emit,
    changed: () => getWindow()?.webContents.send(WORKSPACE_IPC.changed),
    models,
    resolveModel: currentModel,
    profile: getProfile,
    noteSkill: (skill) => void noteSkill(skill),
    // What their code shows (classes, interfaces, tests): read from the Map in the background.
    opened: (project) =>
      void buildMap(project)
        .then(async (map) => {
          for (const skill of codeSkills(map)) await noteSkill(skill)
        })
        .catch(() => undefined),
    ide,
    // A session's terminals end with it, so no program keeps running unseen.
    closed: (sessionId) => codeBox.code?.sessionClosed(sessionId)
  })

  const context: IpcContext = { getWindow, ready, workspace, ide }
  registerCoachIpc(context)
  registerWorkspaceIpc(context)
  registerEditorIpc(context)
  codeBox.code = registerRuns(context, bridge)
  registerVisualizeIpc(context)
  registerMapIpc(context)
  registerSettingsIpc(context)
  const vscode = registerVscodeIpc(context)

  return {
    flush: async () => {
      codeBox.code?.shutdown()
      vscode.shutdown()
      ide.stop()
      await workspace.shutdown()
      await bridge.close()
    }
  }
}
