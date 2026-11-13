import type { BetterCoderApi } from '../shared/ipc'
import type { HarnessApi } from '../shared/harness'
import type { WorkspaceApi } from '../shared/workspace'
import type { MapApi } from '../shared/map'
import type { IdeApi } from '../shared/ide'
import type { CodeApi } from '../shared/code'
import type { EditorImportApi } from '../shared/editor-import'
import type { TasksApi } from '../shared/tasks'

declare global {
  interface Window {
    bettercoder: BetterCoderApi
    harness: HarnessApi
    workspace: WorkspaceApi
    codeMap: MapApi
    ide: IdeApi
    code: CodeApi
    editorImport: EditorImportApi
    tasks: TasksApi
  }
}
