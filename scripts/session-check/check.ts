/**
 * The real-session check (`npm run check:session`): drives the real model (the one picked in Settings, with its key
 * from the OS keychain) through set prompts on fixture projects, then grades every turn on what the learner would
 * see: a card came, the cache held, boards don't overlap, nothing broke. Costs real tokens (a few cents a run).
 *
 * Writes `.session-check/<time>/` (report.json and each scenario's session.sqlite) for reading the transcript later.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { CoachIntent, HarnessEvent } from '../../src/shared/harness'
import type { Card } from '../../src/shared/cards'
import type { ProjectInfo } from '../../src/shared/ipc'
import type { EditorSnapshot } from '../../src/main/ports'
import type { RunSummary } from '../../src/shared/code'
import { DEFAULT_PROFILE } from '../../src/shared/profile'
import { boardOverlaps } from './overlaps'
import { TIDY_EVERY } from '../../src/main/coach/request'

const ROOT = join(import.meta.dirname, '..', '..')
const FIXTURES = join(ROOT, 'tests', 'fixtures', 'session-check')

type Want = 'step' | 'point' | 'board' | 'task' | 'any-card'

interface Prompt {
  label: string
  text: string
  intent?: CoachIntent
  /** Cards that count as the right answer (any one of them). */
  want: Want[]
}

interface Scenario {
  name: string
  folder: string
  /** What the learner's editor shows (file and cursor line). */
  editor: { file: string; line: number }
  /** Their last ▶ Run, as the coach would see it. */
  run?: { path: string; output: string; exitCode: number }
  prompts: Prompt[]
}

const SCENARIOS: Scenario[] = [
  {
    name: 'calculator (C#)',
    folder: 'calculator',
    editor: { file: 'Program.cs', line: 6 },
    run: {
      path: 'Program.cs',
      output: 'What is your first number?\n23\nWhat is your second number?\n20\nWhich operation would you like to do?\n*\n460',
      exitCode: 0
    },
    prompts: [
      { label: 'Where am I', text: 'Where am I: what is done, half-built, and missing?', intent: 'where', want: ['step'] },
      { label: 'Next step', text: 'What should I do next?', intent: 'next', want: ['step', 'point'] },
      { label: 'Visualize', text: 'Draw what my code does on the whiteboard.', intent: 'visualize', want: ['board'] },
      { label: 'Add a task', text: 'can you add a task for handling a bad first number?', want: ['task'] },
      { label: 'Stuck (hint)', text: "I'm stuck.", intent: 'stuck', want: ['any-card'] }
    ]
  },
  {
    name: 'sum loop (Python)',
    folder: 'sum-loop',
    editor: { file: 'sum.py', line: 3 },
    run: { path: 'sum.py', output: '11', exitCode: 0 },
    prompts: [
      { label: 'Visualize (why 11?)', text: 'why does it print 11 and not 20? draw it', intent: 'visualize', want: ['board'] }
    ]
  }
]

interface TurnResult {
  scenario: string
  label: string
  seconds: number
  cards: string[]
  /** The first request of the turn: how much of its input came from the cache (turn 1 of a scenario can't hit). */
  firstCacheRead: number
  firstInput: number
  cachePct: number | null
  tokens: number
  requests: number
  overlaps: string[]
  errors: string[]
  answeredQuestion: boolean
  /** What the turn's first request changed in the request before it (null: it only added to it). */
  changed: string | null
  /** This turn tidied the history (old results stubbed, old notes dropped): a planned miss. */
  tidy: boolean
  fail: string[]
  warn: string[]
}

export async function main(args: string[]): Promise<number> {
  const only = args.find((a) => !a.startsWith('-'))
  const { currentModel, loadSettings, models } = await import('../../src/main/adapters/providers')
  const { Coach } = await import('../../src/main/coach/coach')
  const { realPorts } = await import('../../src/main/ipc/ports')
  const { detectProject } = await import('../../src/main/engines/project')
  const { SessionTasks } = await import('../../src/main/services/tasks')
  const { editorContext } = await import('../../src/main/services/editor-context')
  const { runView } = await import('../../src/main/core/run-view')
  const { FALLBACK_REPLY } = await import('../../src/main/coach/prompts')

  await loadSettings()
  const model = await currentModel()
  if (!model) {
    console.error('No model picked. Connect one in the app (Settings) first.')
    return 2
  }
  const out = join(ROOT, '.session-check', new Date().toISOString().replace(/[:.]/g, '-'))
  await mkdir(out, { recursive: true })
  console.log(`Model: ${model.provider}/${model.id}\nOutput: ${out}\n`)

  const results: TurnResult[] = []
  for (const sc of SCENARIOS) {
    if (only && !sc.name.includes(only)) continue
    const root = join(FIXTURES, sc.folder)
    const project: ProjectInfo = await detectProject(root)
    const file = join(out, `${sc.folder}.sqlite`)
    const events: HarnessEvent[] = []
    const tasks = new SessionTasks([], () => undefined, () => undefined)
    const text = await readFile(join(root, sc.editor.file), 'utf8')
    const snap: EditorSnapshot = {
      ide: 'VS Code',
      folders: [root],
      file: join(root, sc.editor.file),
      line: sc.editor.line,
      col: 1,
      text,
      diagnostics: [],
      lastEditAt: Date.now() - 60_000,
      errors: null,
      stepsDone: new Set(),
      stepTyped: null
    }
    const run: RunSummary | null = sc.run
      ? { id: 'run-1', path: sc.run.path, startedAt: Date.now() - 90_000, endedAt: Date.now() - 80_000, exitCode: sc.run.exitCode, stopped: false, output: sc.run.output, error: null, words: null }
      : null
    // Every request body as pi-ai sends it, to name what changed when the cache missed.
    const bodies: Array<{ input: unknown[]; tools?: unknown }> = []
    const watched = new Proxy(models, {
      get(target, prop, recv) {
        const v = Reflect.get(target, prop, recv)
        if (prop !== 'stream' && prop !== 'streamSimple') return typeof v === 'function' ? v.bind(target) : v
        return (m: unknown, c: unknown, o: { onPayload?: (p: unknown, m: unknown) => unknown } = {}) =>
          v.call(target, m, c, { ...o, onPayload: (p: unknown, mm: unknown) => (bodies.push(structuredClone(p) as never), o.onPayload?.(p, mm)) })
      }
    })
    const coach = await Coach.open(file, project, (e) => events.push(e), {
      ports: realPorts(),
      models: watched,
      resolveModel: currentModel,
      profile: () => DEFAULT_PROFILE,
      editorContext: () => [editorContext(root, project.files, snap), runView(run, Date.now())].filter(Boolean).join('\n'),
      setTask: (task) => tasks.coachSet(task),
      tasksContext: () => tasks.forCoach()
    })

    // Learner messages sent in this scenario (a question answered by the check counts too): every TIDY_EVERY-th one
    // tidies the history, which misses the cache on purpose.
    let sent = 0
    try {
      for (const p of sc.prompts) {
        process.stdout.write(`${sc.name} · ${p.label} … `)
        const from = events.length
        const bodiesBefore = bodies.length
        const start = Date.now()
        const tidy = sent > 0 && sent % TIDY_EVERY === 0
        sent++
        await coach.send(p.text, p.intent)
        await coach.waitForIdle()
        let answered = false
        // A question ends the turn: answer it with its first option, as a learner tapping it would.
        const asked = lastCard(events.slice(from))
        if (asked?.kind === 'question' && asked.options.length > 0 && !p.want.includes('any-card')) {
          answered = true
          sent++
          await coach.send(asked.options[0])
          await coach.waitForIdle()
        }
        const seconds = (Date.now() - start) / 1000
        const turn = events.slice(from)
        const cards = turn.flatMap((e) => (e.type === 'card' ? [e.card] : []))
        const errors = turn.flatMap((e) => (e.type === 'error' ? [e.message] : []))
        const texts = turn.filter((e) => e.type === 'text').map((e) => (e as { delta: string }).delta).join('')
        if (texts.includes(FALLBACK_REPLY)) errors.push('The no-code fallback was shown (the reply had code 3 times).')
        const toolErrors = turn.flatMap((e) => (e.type === 'tool' && e.status === 'error' ? [`${e.label}: ${e.detail}`] : []))
        errors.push(...toolErrors)
        const overlaps = cards.flatMap((c) => (c.kind === 'board' ? boardOverlaps(c.board) : []))
        const firstBody = bodies.findIndex((_, k) => k >= bodiesBefore)
        const changed = firstBody > 0 ? firstChange(bodies[firstBody - 1], bodies[firstBody]) : null
        const r: TurnResult = {
          scenario: sc.name,
          label: p.label,
          seconds,
          cards: cards.map((c) => c.kind),
          firstCacheRead: 0,
          firstInput: 0,
          cachePct: null,
          tokens: 0,
          requests: 0,
          overlaps,
          errors,
          answeredQuestion: answered,
          changed,
          tidy,
          fail: [],
          warn: []
        }
        results.push(r)
        grade(r, p, cards, tasks.view().length)
        console.log(r.fail.length ? 'FAIL' : r.warn.length ? 'warn' : 'ok')
      }
    } finally {
      await coach.close()
    }
    fillUsage(file, results.filter((r) => r.scenario === sc.name))
  }

  // Cache can only be graded once the transcript is read (fillUsage), so it is graded last.
  for (const [i, r] of results.entries()) {
    const firstOfScenario = i === 0 || results[i - 1].scenario !== r.scenario
    if (r.tidy && r.cachePct !== null && r.cachePct < 50) r.warn.push(`tidy-up turn: a planned cache miss (${r.cachePct}% cached)`)
    else if (!firstOfScenario && r.cachePct !== null && r.cachePct < 50) {
      r.fail.push(`cache missed on the first request (${r.cachePct}% cached)${r.changed ? `; we changed ${r.changed}` : '; the request only grew, so xAI dropped it'}`)
    }
  }

  printTable(results)
  await writeFile(join(out, 'report.json'), JSON.stringify({ model: `${model.provider}/${model.id}`, at: new Date().toISOString(), results }, null, 2))
  const failed = results.filter((r) => r.fail.length > 0).length
  console.log(`\n${results.length - failed} of ${results.length} turns passed. Report: ${join(out, 'report.json')}`)
  return failed > 0 ? 1 : 0
}

/** The first thing in `cur` that differs from `prev` (tools, or an input item), or null when `cur` only extends it. */
function firstChange(prev: { input: unknown[]; tools?: unknown }, cur: { input: unknown[]; tools?: unknown }): string | null {
  if (JSON.stringify(prev.tools) !== JSON.stringify(cur.tools)) return 'the tool list'
  for (let k = 0; k < prev.input.length; k++) {
    const a = JSON.stringify(prev.input[k])
    const b = JSON.stringify(cur.input[k])
    if (a === b) continue
    let c = 0
    while (c < a.length && a[c] === b?.[c]) c++
    return `input item ${k} of ${prev.input.length} at char ${c}: "${a.slice(Math.max(0, c - 40), c + 60)}" → "${(b ?? '(gone)').slice(Math.max(0, c - 40), c + 60)}"`
  }
  return null
}

function lastCard(events: HarnessEvent[]): Extract<Card, { kind: 'question' }> | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (e.type === 'card') return e.card.kind === 'question' ? (e.card as Extract<Card, { kind: 'question' }>) : null
  }
  return null
}

function grade(r: TurnResult, p: Prompt, cards: Card[], taskCount: number): void {
  const kinds = new Set<string>(cards.map((c) => c.kind))
  const ok = p.want.some((w) => {
    if (w === 'task') return taskCount > 0
    if (w === 'any-card') return cards.length > 0
    if (w === 'point') return kinds.has('code_ref')
    return kinds.has(w)
  })
  if (!ok) r.fail.push(`no ${p.want.join(' / ')} (got ${r.cards.join(', ') || 'text only'})`)
  if (r.errors.length) r.fail.push(...r.errors)
  if (r.overlaps.length) r.fail.push(`board overlaps: ${r.overlaps.slice(0, 3).join('; ')}${r.overlaps.length > 3 ? ` (+${r.overlaps.length - 3})` : ''}`)
  if (r.seconds > 45) r.warn.push(`slow: ${Math.round(r.seconds)} s`)
  if (r.answeredQuestion) r.warn.push('asked a question first (answered with its first option)')
}

/** Usage per turn from the transcript: each learner message starts a turn; its first reply is the first request. */
function fillUsage(file: string, turns: TurnResult[]): void {
  const db = new DatabaseSync(file, { readOnly: true })
  try {
    const rows = db.prepare('select record from entries order by id').all() as Array<{ record: string }>
    const perTurn: Array<{ first: { input: number; cacheRead: number } | null; tokens: number; requests: number }> = []
    let cur: (typeof perTurn)[number] | null = null
    for (const row of rows) {
      const rec = JSON.parse(row.record) as { kind?: string; model?: Array<{ role: string; content: unknown; usage?: { input: number; cacheRead: number; totalTokens: number } }> }
      const m = rec.model?.[0]
      if (!m) continue
      const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
      const said = typeof m.content === 'string' ? m.content : ((m.content as Array<{ text?: string }>)[0]?.text ?? '')
      // Hidden harness messages (redo requests, nudges) start with "[BetterCoder" and are not a new turn.
      if (m.role === 'user' && text && !said.startsWith('[BetterCoder')) {
        cur = { first: null, tokens: 0, requests: 0 }
        perTurn.push(cur)
      }
      if (m.role === 'assistant' && m.usage && cur) {
        cur.first ??= { input: m.usage.input, cacheRead: m.usage.cacheRead }
        cur.tokens += m.usage.totalTokens
        cur.requests++
      }
    }
    // A question answered by the check adds a learner message: fold it into the turn it belongs to.
    let k = 0
    for (const t of turns) {
      const main = perTurn[k++]
      if (!main) break
      if (t.answeredQuestion && perTurn[k]) {
        main.tokens += perTurn[k].tokens
        main.requests += perTurn[k].requests
        k++
      }
      if (main.first) {
        t.firstInput = main.first.input
        t.firstCacheRead = main.first.cacheRead
        const all = main.first.input + main.first.cacheRead
        t.cachePct = all > 0 ? Math.round((100 * main.first.cacheRead) / all) : null
      }
      t.tokens = main.tokens
      t.requests = main.requests
    }
  } finally {
    db.close()
  }
}

function printTable(results: TurnResult[]): void {
  const red = (s: string) => `\x1b[31m${s}\x1b[0m`
  const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`
  const green = (s: string) => `\x1b[32m${s}\x1b[0m`
  console.log('')
  for (const r of results) {
    const status = r.fail.length ? red('FAIL') : r.warn.length ? yellow('warn') : green(' ok ')
    const cache = r.cachePct === null ? '  -' : `${String(r.cachePct).padStart(3)}%`
    console.log(
      `${status}  ${`${r.scenario} · ${r.label}`.padEnd(38)} ${String(Math.round(r.seconds)).padStart(3)} s  cache ${cache}  ${String(r.tokens).padStart(6)} tok  ${r.requests} req  cards: ${r.cards.join(', ') || '—'}`
    )
    for (const f of r.fail) console.log(`        ${red('✗')} ${f}`)
    for (const w of r.warn) console.log(`        ${yellow('!')} ${w}`)
  }
}
