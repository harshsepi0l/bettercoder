import type { BrowserWindow } from 'electron'
import { isKnownProvider } from '../adapters/providers'
import type { ProviderId } from '../../shared/harness'
import type { IdeHub } from '../services/editor-link'
import type { WorkspaceController } from '../services/workspace'

/** What every IPC area needs: the window, settings loaded, the open workspace and the editor link. */
export interface IpcContext {
  getWindow: () => BrowserWindow | null
  /** Settings are loaded (await before anything that needs a model or the profile). */
  ready: Promise<unknown>
  workspace: WorkspaceController
  ide: IdeHub
}

export function asString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value === '') throw new Error(`${name} required`)
  return value
}

export function asProvider(value: unknown): ProviderId {
  if (typeof value === 'string' && isKnownProvider(value)) return value
  throw new Error('Unknown provider')
}

/** The open session's project, with a folder (Visualize and the Map need files). */
export function needProject(workspace: WorkspaceController) {
  const p = workspace.activeProject()
  if (!p) throw new Error('Open a folder or files first.')
  if (!p.root) throw new Error('Link your project folder first.')
  return p
}
