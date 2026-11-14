import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type BetterCoderApi } from '../shared/ipc'
import { HARNESS_IPC, type AuthUiEvent, type HarnessApi, type HarnessEvent } from '../shared/harness'
import { WORKSPACE_IPC, type WorkspaceApi } from '../shared/workspace'
import { MAP_IPC, type MapApi } from '../shared/map'
import { IDE_IPC, type IdeApi, type IdeView } from '../shared/ide'
import { EDITOR_IMPORT_IPC, type EditorImportApi } from '../shared/editor-import'
import { CODE_IPC, type CodeApi } from '../shared/code'
import { TASKS_IPC, type TasksApi, type TasksUpdate } from '../shared/tasks'

const api: BetterCoderApi = {
  platform: process.platform,
  setPinned: (pinned) => ipcRenderer.invoke(IPC.setPinned, pinned),
  setTheme: (theme) => ipcRenderer.invoke(IPC.setTheme, theme)
}

function listen<T>(channel: string, listener: (value: T) => void): () => void {
  const handler = (_e: IpcRendererEvent, value: T) => listener(value)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const harness: HarnessApi = {
  send: (text, intent, mode) => ipcRenderer.invoke(HARNESS_IPC.send, text, intent, mode),
  abort: () => ipcRenderer.invoke(HARNESS_IPC.abort),
  cardUse: (kind) => ipcRenderer.invoke(HARNESS_IPC.cardUse, kind),
  onEvent: (listener) => listen<HarnessEvent>(HARNESS_IPC.event, listener),
  getSettings: () => ipcRenderer.invoke(HARNESS_IPC.getSettings),
  login: (provider, kind) => ipcRenderer.invoke(HARNESS_IPC.login, provider, kind),
  answerPrompt: (id, value) => ipcRenderer.invoke(HARNESS_IPC.answerPrompt, id, value),
  cancelLogin: () => ipcRenderer.invoke(HARNESS_IPC.cancelLogin),
  logout: (provider) => ipcRenderer.invoke(HARNESS_IPC.logout, provider),
  setModel: (provider, id) => ipcRenderer.invoke(HARNESS_IPC.setModel, provider, id),
  setProfile: (profile) => ipcRenderer.invoke(HARNESS_IPC.setProfile, profile),
  setSkill: (language, topic, level) => ipcRenderer.invoke(HARNESS_IPC.setSkill, language, topic, level),
  forgetSkill: (language, topic) => ipcRenderer.invoke(HARNESS_IPC.forgetSkill, language, topic),
  onAuthEvent: (listener) => listen<AuthUiEvent>(HARNESS_IPC.authEvent, listener)
}

const workspace: WorkspaceApi = {
  list: () => ipcRenderer.invoke(WORKSPACE_IPC.list),
  open: (mode) => ipcRenderer.invoke(WORKSPACE_IPC.open, mode),
  startIdea: (idea) => ipcRenderer.invoke(WORKSPACE_IPC.startIdea, idea),
  linkFolder: (projectId) => ipcRenderer.invoke(WORKSPACE_IPC.linkFolder, projectId),
  newSession: (projectId) => ipcRenderer.invoke(WORKSPACE_IPC.newSession, projectId),
  openSession: (sessionId) => ipcRenderer.invoke(WORKSPACE_IPC.openSession, sessionId),
  renameSession: (sessionId, title) => ipcRenderer.invoke(WORKSPACE_IPC.renameSession, sessionId, title),
  clearChat: (sessionId) => ipcRenderer.invoke(WORKSPACE_IPC.clearChat, sessionId),
  deleteSession: (sessionId) => ipcRenderer.invoke(WORKSPACE_IPC.deleteSession, sessionId),
  deleteProject: (projectId) => ipcRenderer.invoke(WORKSPACE_IPC.deleteProject, projectId),
  onChanged: (listener) => listen<void>(WORKSPACE_IPC.changed, () => listener())
}

const codeMap: MapApi = {
  build: () => ipcRenderer.invoke(MAP_IPC.build),
  stackDocs: () => ipcRenderer.invoke(MAP_IPC.stackDocs),
  docExample: (url, term) => ipcRenderer.invoke(MAP_IPC.docExample, url, term)
}

const ide: IdeApi = {
  getState: () => ipcRenderer.invoke(IDE_IPC.getState),
  onState: (listener) => listen<IdeView>(IDE_IPC.state, listener),
  openFolder: () => ipcRenderer.invoke(IDE_IPC.openFolder),
  openInEditor: (path, line) => ipcRenderer.invoke(IDE_IPC.openInEditor, path, line),
  onShowCode: (listener) => listen<void>(IDE_IPC.showCode, () => listener())
}

const tasks: TasksApi = {
  list: () => ipcRenderer.invoke(TASKS_IPC.list),
  onChanged: (listener) => listen<TasksUpdate>(TASKS_IPC.changed, listener),
  add: (title) => ipcRenderer.invoke(TASKS_IPC.add, title),
  remove: (id) => ipcRenderer.invoke(TASKS_IPC.remove, id),
  check: (id) => ipcRenderer.invoke(TASKS_IPC.check, id),
  send: (ids, target) => ipcRenderer.invoke(TASKS_IPC.send, ids, target),
  checkStep: (title, checks, path, of) => ipcRenderer.invoke(TASKS_IPC.checkStep, title, checks, path, of)
}

const code: CodeApi = {
  vscodeUrl: () => ipcRenderer.invoke(CODE_IPC.vscodeUrl)
}

contextBridge.exposeInMainWorld('bettercoder', api)
const editorImport: EditorImportApi = {
  sources: () => ipcRenderer.invoke(EDITOR_IMPORT_IPC.sources),
  plan: (source) => ipcRenderer.invoke(EDITOR_IMPORT_IPC.plan, source),
  run: (source) => ipcRenderer.invoke(EDITOR_IMPORT_IPC.run, source),
  onRestarted: (listener) => listen<void>(EDITOR_IMPORT_IPC.restarted, () => listener())
}

contextBridge.exposeInMainWorld('code', code)
contextBridge.exposeInMainWorld('tasks', tasks)
contextBridge.exposeInMainWorld('editorImport', editorImport)
contextBridge.exposeInMainWorld('ide', ide)
contextBridge.exposeInMainWorld('codeMap', codeMap)
contextBridge.exposeInMainWorld('workspace', workspace)
contextBridge.exposeInMainWorld('harness', harness)
