import { join } from 'node:path'
import type { Api, Model, Models } from '@earendil-works/pi-ai'
import { titleFrom } from '../../shared/chat'
import type { CardUse, CoachIntent, HarnessEvent } from '../../shared/harness'
import type { OpenSession, ProjectSummary } from '../../shared/workspace'
import type { ProjectInfo } from '../../shared/ipc'
import type { LearnerProfile, Skill } from '../../shared/profile'
import { Coach } from '../coach/coach'
import type { CoachPorts, ProjectScanner, SessionRecord, SessionStore } from '../ports'
import type { IdeHub } from './editor-link'
import { SessionTasks } from './tasks'
import type { RunSummary } from '../../shared/code'
import type { SendTarget, TaskCheck, TasksUpdate } from '../../shared/tasks'

/** A short project name from an idea: its first few words. */
export function ideaName(idea: string): string {
  const words = idea.replace(/[^\p{L}\p{N}\s'-]/gu, ' ').split(/\s+/).filter(Boolean).slice(0, 5)
  const name = words.join(' ')
  return name.length > 40 ? `${name.slice(0, 40).trimEnd()}…` : name || 'New project'
}

/**
 * Owns the open session: which project and session are open and the live
 * coach for it. The conversation itself lives in the session's pi-durable
 * SQLite file; this keeps only titles and timestamps.
 */
export class WorkspaceController {
  private active: { record: SessionRecord; coach: Coach; open: OpenSession; tasks: SessionTasks } | null = null
  /** Serialises opening/closing, so two quick clicks can't open two harnesses on one file. */
  private chain: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly store: SessionStore,
    private readonly deps: {
      /** The outside world, as ports (ipc/ports.ts plugs in the real ones). */
      ports: CoachPorts & { scanner: ProjectScanner }
      emit: (e: HarnessEvent) => void
      changed: () => void
      models: Models
      resolveModel: () => Promise<Model<Api> | null>
      profile?: () => LearnerProfile
      /** Evidence of the learner's level from the coach. */
      noteSkill?: (skill: Omit<Skill, 'at'>) => void
      /** A session opened on this project: read what their code shows (in the background). */
      opened?: (project: ProjectInfo) => void
      /** The learner's editor, when the link is running. */
      ide?: IdeHub
      /** A session closed (or another one opened): end what belonged to it, such as its terminals. */
      closed?: (sessionId: string) => void
      /** The open session's tasks changed (or another session opened). */
      tasksChanged?: (update: TasksUpdate) => void
    }
  ) {}

  /** Card actions in each session, as evidence for the coach. Kept in memory: a weak, per-session signal. */
  private cardUses = new Map<string, Record<CardUse, number>>()

  cardUse(kind: CardUse): void {
    const id = this.active?.record.id
    if (!id) return
    const counts = this.cardUses.get(id) ?? { pseudocode_all: 0, pseudocode_steps: 0, example_full: 0 }
    counts[kind]++
    this.cardUses.set(id, counts)
  }

  private describeCardUse(sessionId: string): string {
    const c = this.cardUses.get(sessionId)
    if (!c) return ''
    return [
      c.pseudocode_all ? `revealed pseudocode all at once ${c.pseudocode_all}×` : '',
      c.pseudocode_steps ? `stepped through pseudocode line by line ${c.pseudocode_steps}×` : '',
      c.example_full ? `opened a full official example ${c.example_full}×` : ''
    ]
      .filter(Boolean)
      .join('; ')
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn)
    this.chain = run.catch(() => undefined)
    return run
  }

  /** The open session's project, if any. */
  activeProject(): OpenSession['project'] | null {
    return this.active?.open.project ?? null
  }

  /** The open session's id, or null. */
  activeSessionId(): string | null {
    return this.active?.record.id ?? null
  }

  list(): Promise<ProjectSummary[]> {
    return this.store.list()
  }

  /**
   * Open what the learner picked: one folder, or one or more files. Registers
   * the project (or reuses it) and starts a new session in it.
   */
  async openPaths(paths: string[]): Promise<OpenSession> {
    if (paths.length === 0) throw new Error('Nothing was picked.')
    const kinds = await Promise.all(paths.map((p) => this.deps.ports.scanner.kindOf(p)))
    const gone = paths.find((_, i) => kinds[i] === 'missing')
    if (gone) throw new Error(`${gone} is missing.`)
    if (paths.length === 1 && kinds[0] === 'dir') return this.openFolder(paths[0])
    if (kinds.some((k) => k === 'dir')) throw new Error('Pick one folder, or one or more files (not both).')
    const info = await this.deps.ports.scanner.scanFiles(paths)
    const project = await this.store.upsertProject(info.root, info.name, info.files)
    const record = await this.store.createSession(project.id)
    return this.activate(record)
  }

  /** Open a folder: register its project (or reuse it) and start a new session in it. */
  async openFolder(root: string): Promise<OpenSession> {
    const info = await this.deps.ports.scanner.scanFolder(root)
    const project = await this.store.upsertProject(info.root, info.name)
    const record = await this.store.createSession(project.id)
    return this.activate(record)
  }

  /** Start from nothing: a project that is only an idea until a folder is linked. */
  async startIdea(idea: string): Promise<OpenSession> {
    const clean = idea.replace(/\r/g, '').trim().slice(0, 2000)
    if (!clean) throw new Error('Describe what you want to build first.')
    const project = await this.store.createIdeaProject(ideaName(clean), clean)
    const record = await this.store.createSession(project.id)
    record.title = titleFrom(clean)
    await this.store.saveSession(record)
    return this.activate(record)
  }

  /** The learner made the project folder: link it, and reopen the session so the coach can see it. */
  async linkFolder(projectId: string, root: string): Promise<OpenSession | null> {
    if ((await this.deps.ports.scanner.kindOf(root)) !== 'dir') throw new Error('Pick a folder.')
    await this.store.linkFolder(projectId, root)
    this.deps.changed()
    const active = this.active
    if (active?.record.projectId === projectId) return this.activate(active.record)
    return null
  }

  async newSession(projectId: string): Promise<OpenSession> {
    const project = await this.store.getProject(projectId)
    if (!project) throw new Error('That project is no longer known.')
    const record = await this.store.createSession(project.id)
    return this.activate(record)
  }

  async openSession(sessionId: string): Promise<OpenSession> {
    if (this.active?.record.id === sessionId) return this.active.open
    const record = await this.store.getSession(sessionId)
    if (!record) throw new Error('That session could not be found.')
    return this.activate(record)
  }

  async renameSession(sessionId: string, title: string): Promise<void> {
    const clean = title.replace(/\s+/g, ' ').trim().slice(0, 80)
    if (!clean) return
    const record = this.active?.record.id === sessionId ? this.active.record : await this.store.getSession(sessionId)
    if (!record) return
    record.title = clean
    await this.store.saveSession(record)
    this.deps.changed()
  }

  deleteSession(sessionId: string): Promise<void> {
    return this.serial(async () => {
      if (this.active?.record.id === sessionId) await this.closeActive(true)
      await this.store.deleteSession(sessionId)
      this.deps.changed()
    })
  }

  deleteProject(projectId: string): Promise<void> {
    return this.serial(async () => {
      if (this.active?.record.projectId === projectId) await this.closeActive(true)
      await this.store.deleteProject(projectId)
      this.deps.changed()
    })
  }

  /** The open session's tasks, as the panel sees them. */
  tasks(): TasksUpdate {
    const a = this.active
    return a ? { sessionId: a.record.id, tasks: a.tasks.view() } : { sessionId: null, tasks: [] }
  }

  /** The learner adds a task: it waits until the coach writes how to check it (the panel then asks the coach). */
  addTask(title: string): void {
    const a = this.active
    if (!a) throw new Error('Open a session first.')
    a.tasks.addMine(title)
  }

  removeTask(id: string): void {
    this.active?.tasks.remove(id)
  }

  /** Check my answer: their last ▶ Run against the coach's answer. */
  checkTask(id: string, run: RunSummary | null): TaskCheck {
    const a = this.active
    if (!a) throw new Error('Open a session first.')
    return a.tasks.check(id, run)
  }

  /** Copy tasks (fresh, not done) into a new or existing session of this project, then open it. */
  async sendTasks(ids: readonly string[], target: SendTarget): Promise<OpenSession> {
    const a = this.active
    if (!a) throw new Error('Open a session first.')
    const copies = a.tasks.copies(ids)
    if (copies.length === 0) throw new Error('Pick at least one task.')
    let record: SessionRecord | null
    if (target.kind === 'new') {
      record = await this.store.createSession(a.record.projectId)
    } else {
      record = await this.store.getSession(target.sessionId)
      if (!record || record.projectId !== a.record.projectId) throw new Error('Pick a session of this project.')
      if (record.id === a.record.id) throw new Error('These tasks are already in this session.')
    }
    const there = new SessionTasks((await this.store.loadTasks(record)) ?? [], () => undefined, () => undefined)
    there.append(copies)
    await this.store.saveTasks(record, there.all())
    return this.activate(record)
  }

  async send(text: string, intent?: CoachIntent): Promise<void> {
    const active = this.active
    if (!active) {
      this.deps.emit({ type: 'error', message: 'Open a folder or files first.' })
      return
    }
    // Only a message moves a session up its project's list (opening or leaving it must not reorder the sidebar).
    active.record.updatedAt = Date.now()
    if (active.record.title === 'New session') active.record.title = titleFrom(text)
    await this.store.saveSession(active.record)
    this.deps.changed()
    await active.coach.send(text, intent)
  }

  abort(): void {
    void this.active?.coach.abort()
  }

  /** Close the app cleanly: pending work resumes next time the session opens. */
  shutdown(): Promise<void> {
    return this.serial(() => this.closeActive(false))
  }

  private async closeActive(deleting: boolean): Promise<void> {
    if (!this.active) return
    const { coach, record } = this.active
    // The record is saved wherever it changes (send, rename); the timestamp moves only on send, so leaving a
    // session never reorders the sidebar.
    if (deleting) await coach.abort().catch(() => undefined)
    this.active = null
    this.deps.ide?.setSession(null)
    this.deps.tasksChanged?.({ sessionId: null, tasks: [] })
    this.deps.closed?.(record.id)
    await coach.close().catch(() => undefined)
    if (deleting) this.deps.emit({ type: 'session_closed' })
  }

  private activate(record: SessionRecord): Promise<OpenSession> {
    return this.serial(async () => {
      const project = await this.store.getProject(record.projectId)
      if (!project) throw new Error('That project is no longer known.')
      const mustExist = !project.root ? [] : project.files ? project.files.map((f) => join(project.root, f)) : [project.root]
      for (const path of mustExist) {
        if ((await this.deps.ports.scanner.kindOf(path)) === 'missing') throw new Error(`${path} is missing. Was it moved or deleted?`)
      }
      await this.closeActive(false)
      const detected: ProjectInfo = !project.root
        ? { root: '', name: project.name, stacks: [], manifests: [], languages: [], fileCount: 0, git: null }
        : project.files
          ? await this.deps.ports.scanner.scanFiles(project.files.map((f) => join(project.root, f)))
          : await this.deps.ports.scanner.scanFolder(project.root)
      const info: ProjectInfo = project.idea ? { ...detected, idea: project.idea } : detected
      // The session's tasks: saved one after another (never two writes racing), shown and put on the status line.
      let saving: Promise<unknown> = Promise.resolve()
      const stored = await this.store.loadTasks(record)
      const tasks: SessionTasks = new SessionTasks(
        stored ?? [],
        (list) => {
          const copy = [...list]
          saving = saving.then(() => this.store.saveTasks(record, copy)).catch(() => undefined)
        },
        (notice) => {
          if (this.active?.record.id !== record.id) return
          this.deps.ide?.setTaskLine(tasks.statusLine())
          this.deps.tasksChanged?.({ sessionId: record.id, tasks: tasks.view(), ...(notice ? { notice } : {}) })
        }
      )
      const coach = await Coach.open(
        this.store.sessionDbFile(record),
        info,
        (e) => this.forward(record.id, e),
        {
          models: this.deps.models,
          resolveModel: this.deps.resolveModel,
          ports: this.deps.ports,
          profile: this.deps.profile,
          noteSkill: this.deps.noteSkill,
          cardUse: () => this.describeCardUse(record.id),
          editorContext: () => (this.active?.record.id === record.id ? (this.deps.ide?.context() ?? '') : ''),
          onStep: (step) => {
            if (this.active?.record.id === record.id) this.deps.ide?.setStep(step)
          },
          setTask: (task) => tasks.coachSet(task),
          tasksContext: () => tasks.forCoach()
        }
      )
      // A session from before Tasks: its old progress meter's tasks come over once, for the coach to write checks.
      if (stored === null && coach.legacyTasks.length > 0) tasks.importLegacy(coach.legacyTasks)
      // Sessions from before pi-durable keep their old chat on screen (read-only history).
      const items = coach.initialItems.length > 0 ? coach.initialItems : (record.items ?? [])
      const open: OpenSession = {
        project: { ...info, id: project.id },
        session: {
          id: record.id,
          projectId: record.projectId,
          title: record.title,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
          items,
          usage: coach.initialUsage
        }
      }
      this.active = { record, coach, open, tasks }
      this.deps.ide?.setSession(info.root ? { root: info.root, files: info.files } : null, tasks.statusLine(), coach.initialStep)
      this.deps.tasksChanged?.({ sessionId: record.id, tasks: tasks.view() })
      this.deps.emit({ type: 'session_opened', open })
      if (info.root) this.deps.opened?.(info)
      // session_opened resets the panel to idle; a run resumed on open must still show as busy.
      if (coach.isBusy) this.deps.emit({ type: 'busy', busy: true })
      this.deps.changed()
      return open
    })
  }

  /** Events from a session's coach go to the panel only while it is the open one. */
  private forward(sessionId: string, e: HarnessEvent): void {
    const active = this.active
    if (!active || active.record.id !== sessionId) return
    this.deps.emit(e)
    // A finished turn may have changed what the sidebar shows (a resumed run, a linked folder): refresh it.
    if (e.type === 'busy' && !e.busy) this.deps.changed()
  }
}
