import type { BetterCoderApi } from '../shared/ipc'
import type { HarnessApi } from '../shared/harness'
import type { WorkspaceApi } from '../shared/workspace'
import type { VisualizeApi } from '../shared/visualize'
import type { MapApi } from '../shared/map'
import type { IdeApi } from '../shared/ide'
import type { CodeApi } from '../shared/code'
import type { EditorImportApi } from '../shared/editor-import'

declare global {
  interface Window {
    bettercoder: BetterCoderApi
    harness: HarnessApi
    workspace: WorkspaceApi
    visualize: VisualizeApi
    codeMap: MapApi
    ide: IdeApi
    code: CodeApi
    editorImport: EditorImportApi
  }
}
