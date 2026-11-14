import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import type { Api, AssistantMessage, Model, Models, ToolResultMessage } from '@earendil-works/pi-ai'
import {
  GenerationTask,
  Harness,
  ToolTask,
  createRegistry,
  defineExtension,
  defineTool,
  hook,
  section,
  watchEvents,
  type AgentEventStream,
  type Conversation
} from '@earendil-works/pi-durable'
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node'
import type { Card } from '../../shared/cards'
import type { ChatItem } from '../../shared/chat'
import type { HarnessEvent, TurnUsage } from '../../shared/harness'
import type { ProjectInfo } from '../../shared/ipc'
import type { CoachPorts } from '../ports'
import { FALLBACK_REPLY, REWRITE_REQUEST, TOOL_TEXT_REQUEST, VISUALIZE_NUDGE, coachPrompt, learnerNow, learnerPrompt, type CoachIntent } from './prompts'
import type { CoachMode } from '../../shared/harness'
import { DEFAULT_PROFILE, type LearnerProfile } from '../../shared/profile'
import { createOutlineTool } from './tools/outline'
import { redactSecrets } from '../core/paths'
import { createTools } from './tools/read'
import { VISUAL_TOOL_NAMES, createVisualTools } from './tools/cards'
import { createSkillTool } from './tools/skill'
import { createTaskTool, type SetTask } from './tools/tasks'
import type { Skill } from '../../shared/profile'
import { MAX_REWRITES, MAX_TOOL_CALLS_PER_MESSAGE, MAX_TOOL_RESULT_CHARS, HIDDEN_PREFIX, READ_TOOLS, withIntent, withMode, isDrawing, stripIntent, type TurnState, turnState, textOf, MAX_TOOL_RETRIES, typedToolName, withoutToolNames, hasCode, asksQuestion } from './turn'
import { describeTool, isToolLine, itemsFromEntries, sumUsage, type AnchoredStep, anchoredStep, lastStepFromEntries, legacyTaskTitles } from './replay'
import { prepareMessages, cacheSettings, type SentNotes } from './request'

/**
 * The coach, running on pi-durable. One SQLite file per session: the transcript,
 * tool calls and usage are committed before anything is shown, and a session
 * picks up where it stopped after a crash or restart.
 *
 * BetterCoder's rules plug in as one extension:
 *  - read-only, sandboxed tools and visual cards
 *  - hooks: no-code guard (silent rewrite), hidden rejected replies, secret
 *    redaction, trimmed context, tool budget
 *  - intents (Visualize, I'm stuck, ...) come from UI buttons as structured
 *    data on the input, never from matching words; per-turn state is worked
 *    out from the stored transcript, so it survives restarts
 */

const ctx = BACKGROUND_CONTEXT

/** Turn BetterCoder's AgentTools into pi-durable tools (same names, schemas and behaviour). */
function toDurable(tool: AgentTool<any>) {
  return defineTool({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    execute: async (args, api) => {
      const r = await tool.execute(api.callId, args as never)
      return {
        output: r.content,
        ...(r.details !== undefined ? { details: r.details as never } : {}),
        ...((r as { terminate?: boolean }).terminate ? { control: { terminate: true } } : {})
      }
    }
  })
}

export interface CoachDeps {
  models: Models
  resolveModel: () => Promise<Model<Api> | null>
  /** The outside world (project files, animator, code map), plugged in by ipc/ports.ts. */
  ports: CoachPorts
  /** The learner's skills and style, read before every request (Settings › You applies from the next message). */
  profile?: () => LearnerProfile
  /** The coach saw evidence of how well the learner knows a topic. */
  noteSkill?: (skill: Omit<Skill, 'at'>) => void
  /** How they used cards this session, in words ("revealed pseudocode all at once 2×"); empty if nothing yet. */
  cardUse?: () => string
  /** What their editor shows right now (see ide/context.ts); empty when no editor is linked. */
  editorContext?: () => string
  /** A step card was shown: where to write it (null when the step has no place), for their editor. */
  onStep?: (step: AnchoredStep | null) => void
  /** The coach added a task or wrote one's check (set_task); throws when it can't be saved. */
  setTask?: SetTask
  /** The session's tasks as the coach sees them (never the answers); empty when there are none. */
  tasksContext?: () => string
}

/** The project's languages, most files first ("C#", "Python"); none for an idea without a folder. */
export function projectLanguages(project: ProjectInfo): string[] {
  const names = [...project.languages].sort((a, b) => b.files - a.files).map((l) => l.name)
  return names.length > 0 ? names : project.stacks.filter((s) => !/\//.test(s))
}

/** What a Visualize turn may call (beforeTool blocks the rest). */
const VISUALIZE_TOOLS = new Set([...READ_TOOLS, 'ask_question', 'draw_board'])

/** Cards that need no files: all a coach has before a project folder is linked. */
const IDEA_TOOLS = new Set(['ask_question', 'show_diagram', 'show_step', 'draw_board'])

export class Coach {
  private stream: AgentEventStream | null = null
  /** Per-request state, recomputed from the transcript before every model request (restart-safe). */
  private state: TurnState = { intent: null, mode: null, rewrites: 0, toolRetries: 0, readCalls: 0, drew: false, asked: false, nudged: false }
  /** Read calls made inside the current round, on top of state.readCalls. */
  private roundReads = 0
  /** The current round includes ask_question, so every call in it ends the turn (pi-durable needs all of them to). */
  private roundAsks = false
  private shownSinceInput = false
  /** The last reply text shown since the learner's message, so a repeated headline is not shown twice. */
  private lastShown = ''
  private busy = false

  private constructor(
    readonly project: ProjectInfo,
    private readonly harness: Harness,
    private readonly root: Conversation,
    private readonly emit: (e: HarnessEvent) => void,
    private readonly deps: CoachDeps,
    private readonly durableTools: ReturnType<typeof toDurable>[],
    readonly initialItems: ChatItem[],
    readonly initialUsage: TurnUsage | null,
    readonly initialStep: AnchoredStep | null,
    /** Tasks from the old progress meter in this transcript (see legacyTaskTitles). */
    readonly legacyTasks: string[]
  ) {}

  /** Open (or create) a session's coach on its SQLite file, recovering and resuming any unfinished work. */
  static async open(
    file: string,
    project: ProjectInfo,
    emit: (e: HarnessEvent) => void,
    deps: CoachDeps
  ): Promise<Coach> {
    // An idea with no folder yet: no file tools at all (an empty root must never reach the sandbox).
    const idea = !project.root
    const languages = projectLanguages(project)
    const skillTool = createSkillTool(languages[0] ?? 'general', (s) => deps.noteSkill?.(s))
    const agentTools = idea
      ? [...createVisualTools(deps.ports, '', undefined).filter((t) => IDEA_TOOLS.has(t.name)), skillTool]
      : [
          createOutlineTool(project, deps.ports.mapper),
          ...createTools(deps.ports.files, project.root, project.files),
          ...createVisualTools(deps.ports, project.root, project.files),
          skillTool,
          createTaskTool((task) => {
            if (!deps.setTask) throw new Error('Tasks are not available here.')
            return deps.setTask(task)
          })
        ]
    const durableTools = agentTools.map(toDurable)
    const toolNames = new Set(agentTools.map((t) => t.name))
    // Hooks need the instance, which exists only after Harness.open; they read it through this box.
    const box: { coach?: Coach } = {}
    // The note each learner message went out with, resent unchanged so the cache holds (memory only, never stored).
    const sentNotes: SentNotes = new Map()

    const extension = defineExtension({
      name: 'bettercoder',
      sections: [
        section('coach', () => coachPrompt(project), { tag: false }),
        section('learner', () => learnerPrompt(deps.profile?.() ?? DEFAULT_PROFILE), { tag: false })
      ],
      tools: durableTools,
      hooks: [
        hook(GenerationTask, {
          beforeRequest: (request) => {
            if (box.coach) {
              box.coach.state = turnState(request.messages)
              box.coach.roundReads = 0
            }
            // Everything that changes turn to turn rides on the newest message, so the start of the request stays cached.
            // Written once per learner message, then resent unchanged (see prepareMessages).
            const now = () =>
              [learnerNow(deps.profile?.() ?? DEFAULT_PROFILE, languages, deps.cardUse?.() ?? ''), idea ? '' : (deps.editorContext?.() ?? ''), idea ? '' : (deps.tasksContext?.() ?? '')]
                .filter(Boolean)
                .join('\n\n')
            return { messages: prepareMessages(request.messages, idea, now, sentNotes) }
          },
          afterResponse: (message: AssistantMessage) => {
            if (box.coach) box.coach.roundAsks = asksQuestion(message)
          },
          onYield: (answer: AssistantMessage) => {
            const t = box.coach?.state
            if (!t) return undefined
            if (hasCode(textOf(answer.content))) {
              // Silent redo; after MAX_REWRITES the run ends and the learner gets the fallback (see run_end).
              return t.rewrites < MAX_REWRITES ? { continue: REWRITE_REQUEST } : undefined
            }
            if (typedToolName(answer) && t.toolRetries < MAX_TOOL_RETRIES) return { continue: TOOL_TEXT_REQUEST }
            if (isDrawing(t) && !t.drew && !t.asked && !t.nudged) {
              return { continue: VISUALIZE_NUDGE }
            }
            return undefined
          }
        }),
        hook(ToolTask, {
          beforeTool: (call) => {
            const c = box.coach
            if (!toolNames.has(call.name)) return { block: 'BetterCoder only allows read-only tools.' }
            // Visualize allows only reading, asking and the whiteboard. Checked here, not by changing the tool list:
            // a different tool list changes the start of the request, so the whole cache would be lost.
            if (c && isDrawing(c.state) && !VISUALIZE_TOOLS.has(call.name)) {
              return { block: 'The learner is on Visualize: draw it with draw_board (read first if you need to, or ask_question which part).' }
            }
            // Only reading counts against the budget: a card (like a question) must always get through.
            // A blocked call skips afterTool, so it could not end a question's round: let reads in that round through.
            if (c && !c.roundAsks && READ_TOOLS.has(call.name) && c.state.readCalls + ++c.roundReads > MAX_TOOL_CALLS_PER_MESSAGE) {
              return { block: 'Tool limit for this reply reached. Answer the learner now with what you have.' }
            }
            return undefined
          },
          afterTool: (_call, result) => {
            const output = result.output?.map((c) => {
              if (c.type !== 'text') return c
              const clean = redactSecrets(c.text)
              return {
                ...c,
                text: clean.length > MAX_TOOL_RESULT_CHARS ? `${clean.slice(0, MAX_TOOL_RESULT_CHARS)}\n… (cut to save space; ask for a smaller range)` : clean
              }
            })
            // A question waits for the learner, even when other cards came with it in the same round.
            const control = box.coach?.roundAsks ? { ...result.control, terminate: true } : result.control
            return { ...result, ...(output ? { output } : {}), ...(control ? { control } : {}) }
          }
        })
      ]
    })

    const registry = createRegistry()
    registry.install(extension)
    const harness = await Harness.open(
      await openNodeSqliteStorage(file),
      {
        models: deps.models,
        registry,
        identity: { attribution: { name: 'bettercoder', url: 'https://github.com/' } },
        settings: { afterFailedRun: 'withdraw', compaction: { keepRecentTokens: 12000 }, stream: cacheSettings() }
      },
      ctx
    )
    const root = await harness.root(ctx)
    const entries = (await root.entries({ order: 'ascending' }, 10_000, undefined, ctx)).items
    const usage = sumUsage((await harness.usage(ctx)) as never)
    const coach = new Coach(
      project,
      harness,
      root,
      emit,
      deps,
      durableTools,
      itemsFromEntries(entries),
      usage.total > 0 ? usage : null,
      lastStepFromEntries(entries),
      idea ? [] : legacyTaskTitles(entries)
    )
    box.coach = coach
    // A round interrupted by a restart resumes its tools: it still waits for the learner if it asked a question.
    const last = entries.findLast((e) => e.model?.[0]?.role === 'assistant')?.model?.[0] as AssistantMessage | undefined
    coach.roundAsks = !!last && asksQuestion(last)
    await coach.attach()
    harness.resume()
    await coach.recover()
    return coach
  }

  /**
   * A session must never be stuck. On open: tasks that can never run again are
   * retried or aborted (pi-durable's own inspect/retryTask/abortTask), and a tool
   * restriction left over from a crash is cleared.
   */
  private async recover(): Promise<void> {
    const report = await this.harness.inspect(ctx).catch(() => null)
    for (const t of report?.tasks ?? []) {
      if (t.state.kind !== 'blocked') continue
      if (t.state.reason === 'restart_limit') await this.harness.retryTask(t.record.id, ctx).catch(() => undefined)
      else await this.harness.abortTask(t.record.id, ctx).catch(() => undefined)
    }
    const agent = await this.root.agent(ctx).catch(() => null)
    const stored = (agent as { modelTools?: unknown } | null)?.modelTools
    if (stored && !this.busy) await this.root.configure({ modelTools: null } as never, ctx).catch(() => undefined)
  }

  private async attach(): Promise<void> {
    this.stream = await watchEvents(this.harness, this.root.id, ctx)
    this.busy = this.stream.snapshot.run !== undefined
    this.stream.start(async (events) => {
      for (const e of events) this.onEvent(e)
    })
  }

  /**
   * Send the learner's message. `intent` is set only by UI buttons (Visualize,
   * I'm stuck, ...); typed text goes to the model as it is, and the model picks tools.
   */
  async send(text: string, intent?: CoachIntent, mode?: CoachMode): Promise<void> {
    const model = await this.deps.resolveModel()
    if (!model) {
      this.emit({ type: 'error', message: 'Connect a model in Settings first.' })
      return
    }
    const agent = await this.root.agent(ctx)
    const current = agent.model as { provider?: string; modelId?: string } | undefined
    if (current?.provider !== model.provider || current?.modelId !== model.id) {
      await this.root.configure({ model: { provider: model.provider, modelId: model.id }, thinkingLevel: 'off' } as never, ctx)
    }
    this.shownSinceInput = false
    this.lastShown = ''
    const tagged = withMode(text, mode)
    await this.root.submit({ type: 'input', content: intent ? withIntent(tagged, intent) : tagged }, ctx)
  }

  async abort(): Promise<void> {
    await this.root.abort(ctx)
  }

  async waitForIdle(): Promise<void> {
    await this.harness.waitForIdle(ctx)
    // Let the event stream deliver the last commits.
    await new Promise((r) => setTimeout(r, 30))
  }

  async close(): Promise<void> {
    await this.stream?.stop().catch(() => undefined)
    await this.harness.close(ctx)
  }

  private show(id: string, text: string): void {
    if (!text.trim()) return
    // Models often repeat their headline on each round of a turn (with a card, after a retry): show it once.
    if (text.trim() === this.lastShown) return
    this.lastShown = text.trim()
    this.shownSinceInput = true
    this.emit({ type: 'assistant_start', id })
    this.emit({ type: 'text', id, delta: text })
    this.emit({ type: 'assistant_end', id })
  }

  private onEvent(e: import('@earendil-works/pi-durable').AgentEvent): void {
    switch (e.type) {
      case 'run_start':
        this.busy = true
        this.emit({ type: 'busy', busy: true })
        break
      case 'run_end':
        this.busy = false
        // Every attempt contained code: give the fallback, and keep it in the transcript.
        if (this.state.rewrites >= MAX_REWRITES && !this.shownSinceInput) {
          void this.root.submit({ type: 'write', entry: { kind: 'bc.notice', data: { text: FALLBACK_REPLY } } }, ctx)
          this.show(`fallback-${Date.now()}`, FALLBACK_REPLY)
        }
        this.emit({ type: 'busy', busy: false })
        break
      case 'message_end': {
        const msg = e.entry.model?.[0]
        if (!msg) break
        if (msg.role === 'user') {
          const text = stripIntent(textOf(msg.content))
          if (text && !text.startsWith(HIDDEN_PREFIX)) this.emit({ type: 'user', id: String(e.entry.id), text })
        } else if (msg.role === 'assistant') {
          const a = msg as AssistantMessage
          if (a.stopReason === 'error') this.emit({ type: 'error', message: a.errorMessage ?? 'The model returned an error.' })
          // A reply that typed a tool's name is redone silently; if it still slips through, the names are removed.
          const retrying = typedToolName(a) && (this.state?.toolRetries ?? 0) < MAX_TOOL_RETRIES
          const text = withoutToolNames(textOf(a.content).trim())
          // Shown only once complete and clean. A reply with code is never shown.
          if (text && !retrying && !hasCode(text)) this.show(String(e.entry.id), text)
        }
        break
      }
      case 'tool_execution_start': {
        if (e.parentToolCallId || !isToolLine(e.toolName)) break
        const { label, detail } = describeTool(e.toolName, e.args as Record<string, unknown>)
        this.emit({ type: 'tool', id: e.toolCallId, label, detail, status: 'running' })
        break
      }
      case 'tool_execution_end': {
        if (e.parentToolCallId) break
        const r = e.entry?.model?.[0] as ToolResultMessage | undefined
        const failed = r?.isError ?? true
        if (isToolLine(e.toolName)) {
          this.emit({ type: 'tool', id: e.toolCallId, label: describeTool(e.toolName, undefined).label, detail: '', status: failed ? 'error' : 'done' })
        }
        if (VISUAL_TOOL_NAMES.has(e.toolName) && r && !failed && r.details) {
          this.emit({ type: 'card', id: `card-${e.toolCallId}`, card: r.details as unknown as Card })
          // A new step replaces the old marker in their editor (or clears it, when the step has no place).
          if (e.toolName === 'show_step') this.deps.onStep?.(anchoredStep(`card-${e.toolCallId}`, r.details as unknown as Card))
        }
        break
      }
      case 'usage_changed': {
        const u = sumUsage(e.usage as never)
        this.emit({ type: 'usage', turn: u, session: u })
        break
      }
      case 'task_failed':
        if (e.kind !== 'pi.tool') this.emit({ type: 'error', message: e.message })
        break
    }
  }

  get isBusy(): boolean {
    return this.busy
  }
}
