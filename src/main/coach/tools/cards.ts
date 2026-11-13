import { Type } from 'typebox'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import type { Card } from '../../../shared/cards'
import { PART_PATTERN } from '../../../shared/line-parts'
import { StreamGuard, isCodeLine, isDataLiteral, pseudocodeProblem } from '../../core/guard'
import { redactSecrets } from '../../core/paths'
import { viewLines } from '../../core/text-view'
import type { ProjectFiles } from '../../ports'
import { BOARD_LIMITS, boardProblem, boardTexts, type Board, type BoardItem } from '../../../shared/board'

/**
 * Tools that draw cards in the chat. They keep the coach visual and short:
 * a question to click, a diagram, the learner's own code with a line to look
 * at, a step, or the whiteboard.
 */

const MAX_REF_LINES = 15
const DIAGRAM_TYPES = /^\s*(flowchart|graph|sequenceDiagram|stateDiagram(-v2)?|mindmap)\b/

/** Text in a card that looks like code the model wrote. Null when clean. */
export function codeInText(text: string): string | null {
  const r = StreamGuard.clean(text)
  return r.removed > 0 ? text : null
}

/** Pull the human-readable labels out of Mermaid source. */
export function mermaidLabels(src: string): string[] {
  const labels: string[] = []
  const patterns = [/\["?([^\]"]+)"?\]/g, /\("?([^)"]+)"?\)/g, /\{"?([^}"]+)"?\}/g, /\|([^|]+)\|/g, /:\s*(.+)$/gm, /"([^"]+)"/g]
  for (const re of patterns) for (const m of src.matchAll(re)) labels.push(m[1].trim())
  return labels.filter((l) => l.length > 0)
}

/** Why a card cannot be shown (it contains code), or null if it can. */
export function cardProblem(card: Card): string | null {
  const texts: string[] = []
  switch (card.kind) {
    case 'question':
      texts.push(card.question, ...card.options)
      break
    case 'diagram':
      texts.push(card.title, card.caption ?? '')
      for (const label of mermaidLabels(card.mermaid)) {
        if (isCodeLine(label) || codeInText(label)) return `A diagram label looks like code: "${label}". Use plain words.`
      }
      break
    case 'code_ref':
      texts.push(card.note ?? '') // the lines themselves are the learner's own code
      break
    case 'concept':
      texts.push(card.term, card.explanation, card.docTitle ?? '')
      break
    case 'steps':
      texts.push(card.title, ...card.steps)
      break
    case 'pseudocode':
      texts.push(card.title, card.note ?? '')
      break
    case 'step':
      // The pseudocode lines are checked by pseudocodeProblem; method names are names, not code.
      texts.push(card.title, card.idea?.term ?? '', card.idea?.explanation ?? '', card.idea?.docTitle ?? '')
      texts.push(...card.lines.map((l) => l.note ?? ''))
      // Part labels are plain words; the parts themselves are names or symbols (checked by PART_PATTERN).
      for (const l of card.lines) {
        for (const x of l.parts ?? []) if (isCodeLine(x.says)) return `A part label looks like code: "${x.says}". Use plain words.`
        texts.push(...(l.parts ?? []).map((x) => x.says))
      }
      if (card.question) texts.push(card.question.question, ...card.question.options)
      break
    case 'board':
      texts.push(card.title, card.note)
      for (const t of boardTexts(card.board)) if (!isDataLiteral(t) && (isCodeLine(t) || codeInText(t))) return `The board shows code: "${t}". Use plain words and values.`
      break
    case 'animation':
      texts.push(card.title, card.note)
      break
  }
  for (const t of texts) if (t && codeInText(t)) return 'That card contained code. Say it in plain words instead.'
  return null
}

function shown(card: Card, extra = '') {
  return { content: [{ type: 'text' as const, text: `Shown to the learner.${extra}` }], details: card }
}

/**
 * The card tools. `files` (read-only project access) comes in as a port, so these never touch files themselves.
 */
export function createVisualTools(
  ports: { files: ProjectFiles },
  root: string,
  files: string[] | undefined
): AgentTool<any>[] {
  const allowed = files ? new Set(files) : undefined
  const check = (card: Card) => {
    const problem = cardProblem(card)
    if (problem) throw new Error(problem)
  }

  const AskParams = Type.Object({
    question: Type.String({ minLength: 3, maxLength: 200 }),
    options: Type.Array(Type.String({ minLength: 1, maxLength: 80 }), { minItems: 2, maxItems: 5 }),
    allow_other: Type.Optional(Type.Boolean({ description: 'Let them type their own answer. Default true.' }))
  })
  const ask: AgentTool<typeof AskParams> = {
    name: 'ask_question',
    label: 'Question',
    description:
      'Ask the learner ONE question with 2-5 short clickable answers. Ends your turn; their answer comes back as their next message. Prefer this over asking in prose.',
    parameters: AskParams,
    execute: async (_id, p) => {
      const card: Card = { kind: 'question', question: p.question, options: p.options, allowOther: p.allow_other ?? true }
      check(card)
      return { ...shown(card, ' Wait for their answer.'), terminate: true }
    }
  }

  const DiagramParams = Type.Object({
    title: Type.String({ maxLength: 80 }),
    mermaid: Type.String({
      maxLength: 2000,
      description:
        'Mermaid source: flowchart, sequenceDiagram, stateDiagram-v2 or mindmap. Labels in plain words, never code.'
    }),
    caption: Type.Optional(Type.String({ maxLength: 160 }))
  })
  const diagram: AgentTool<typeof DiagramParams> = {
    name: 'show_diagram',
    label: 'Diagram',
    description:
      'Draw a small diagram (Mermaid) to explain how something works: data flow, order of steps, what points to what, list positions. Keep it to about 3-8 nodes.',
    parameters: DiagramParams,
    execute: async (_id, p) => {
      const src = p.mermaid.trim()
      if (!DIAGRAM_TYPES.test(src)) throw new Error('Use a flowchart, sequenceDiagram, stateDiagram-v2 or mindmap.')
      if (/%%\{|\bclick\b|<script|javascript:|href/i.test(src)) throw new Error('Directives, links and click handlers are not allowed.')
      const card: Card = { kind: 'diagram', title: p.title, mermaid: src, caption: p.caption }
      check(card)
      return { ...shown(card), terminate: true }
    }
  }

  const RefParams = Type.Object({
    path: Type.String({ description: 'File relative to the project root' }),
    start_line: Type.Integer({ minimum: 1 }),
    end_line: Type.Integer({ minimum: 1 }),
    focus_line: Type.Optional(Type.Integer({ minimum: 1, description: 'The line they should look at' })),
    note: Type.Optional(Type.String({ maxLength: 200, description: 'What to look at or think about here, in plain words' }))
  })
  const pointTo: AgentTool<typeof RefParams> = {
    name: 'point_to_code',
    label: 'Look here',
    description: `Show the learner a few of THEIR OWN lines (max ${MAX_REF_LINES}) from a file, with the line to look at highlighted and a short note. Use this instead of describing where to look.`,
    parameters: RefParams,
    execute: async (_id, p) => {
      const { abs, rel } = await ports.files.resolve(root, p.path, allowed)
      const all = viewLines(rel, new TextDecoder().decode(await ports.files.read(abs)))
      const start = Math.min(Math.max(1, p.start_line), all.length)
      const end = Math.min(all.length, Math.max(start, p.end_line), start + MAX_REF_LINES - 1)
      const lines = all.slice(start - 1, end).map((l) => redactSecrets(l))
      const focus = p.focus_line && p.focus_line >= start && p.focus_line <= end ? p.focus_line : undefined
      const card: Card = { kind: 'code_ref', path: rel, startLine: start, lines, focusLine: focus, note: p.note }
      check(card)
      return { ...shown(card), terminate: true }
    }
  }

  const Idea = Type.Object({
    term: Type.String({ maxLength: 60, description: 'The idea or method, by its usual full name: "Console.ReadLine", "turning text into a number"' }),
    explanation: Type.String({ maxLength: 300, description: 'One or two plain sentences' }),
    doc_title: Type.Optional(Type.String({ maxLength: 100 })),
    doc_url: Type.Optional(Type.String({ description: 'Official documentation URL (https)' })),
    level: Type.Optional(
      Type.Union([Type.Literal('new'), Type.Literal('basics'), Type.Literal('pro')], {
        description: "The learner's level in this topic (see THE LEARNER)."
      })
    )
  })
  const Line = Type.Object({
    text: Type.String({ minLength: 2, maxLength: 100, description: 'One pseudocode line. Indent with two spaces per level inside an if or a repeat.' }),
    method: Type.Optional(
      Type.String({ maxLength: 60, description: 'The real method this line uses, if any: "Console.ReadLine", "double.Parse". The learner sees its official line.' })
    ),
    doc_url: Type.Optional(Type.String({ description: "That method's official API reference page (https)" })),
    note: Type.Optional(Type.String({ maxLength: 120, description: 'One plain sentence about this line' })),
    parts: Type.Optional(
      Type.Array(
        Type.Object({
          part: Type.String({ maxLength: 40, description: 'A name or symbol you expect in the official line: "Console.ReadLine()", "=", ";", "string?"' }),
          says: Type.String({ minLength: 2, maxLength: 60, description: 'What that part does, in 2-8 plain words' })
        }),
        {
          maxItems: 6,
          description:
            "Only with method, and only when the learner is new to this topic: label the parts of the method's official line. You don't see that line; name the parts you expect in it. Parts not in it are dropped."
        }
      )
    )
  })
  const StepParams = Type.Object({
    title: Type.String({ maxLength: 80, description: 'What this step does, e.g. "Read the two numbers"' }),
    idea: Type.Optional(Idea),
    lines: Type.Optional(Type.Array(Line, { maxItems: 12, description: 'Leave out for a step that is only an idea' })),
    question: Type.Optional(
      Type.Object({
        question: Type.String({ minLength: 3, maxLength: 200 }),
        options: Type.Array(Type.String({ minLength: 1, maxLength: 80 }), { minItems: 2, maxItems: 5 })
      })
    ),
    at: Type.Optional(
      Type.Object(
        {
          path: Type.String({ description: 'File relative to the project root' }),
          line: Type.Integer({ minimum: 1, description: 'The line where they should start writing (usually a blank line)' })
        },
        { description: "Where in THEIR file this step is written. Their editor labels that line with the step's title and offers the official line for each tagged line. Use it whenever you know the place." }
      )
    )
  })
  const https = (u: string | undefined) => (u && /^https:\/\/[^\s]+$/.test(u) ? u : undefined)
  const step: AgentTool<typeof StepParams> = {
    name: 'show_step',
    label: 'Step',
    description:
      'The one card for a step: the idea behind it, what to write as pseudocode (language-neutral, mixed with plain English: "a ← read a number", "if op = +: result ← a + b"), and optionally one question at the end (it then ends your turn). Tag each line that uses a real method with method + doc_url: the learner sees the official line for it, so never write the real code yourself. Never real syntax in the lines: no brackets for calls, no ; { }, no ==. Ordered setup or run steps are lines too, in plain words.',
    parameters: StepParams,
    execute: async (_id, p) => {
      if (!p.idea && !p.lines?.length) throw new Error('Give the step an idea, some lines, or both.')
      const lines = (p.lines ?? []).map((l) => {
        const text = l.text.replace(/\t/g, '  ').trimEnd()
        const why = pseudocodeProblem(text)
        if (why) throw new Error(`"${text.trim()}" is real code (${why}). Rewrite it as pseudocode.`)
        const method = l.method?.trim()
        if (method && !/^[A-Za-z_][\w.]*$/.test(method)) throw new Error(`method must be a name like Console.ReadLine, not "${method}".`)
        const docUrl = method ? https(l.doc_url) : undefined
        // A part that isn't one name or symbol is dropped (it could never match the official line); no failed round.
        const parts = docUrl ? (l.parts ?? []).map((x) => ({ part: x.part.trim(), says: x.says.trim() })).filter((x) => PART_PATTERN.test(x.part)) : []
        return {
          text,
          ...(method ? { method } : {}),
          ...(docUrl ? { docUrl } : {}),
          ...(l.note ? { note: l.note } : {}),
          ...(parts.length ? { parts } : {})
        }
      })
      const ideaUrl = https(p.idea?.doc_url)
      const idea = p.idea
        ? {
            term: p.idea.term,
            explanation: p.idea.explanation,
            ...(p.idea.doc_title ? { docTitle: p.idea.doc_title } : {}),
            ...(ideaUrl ? { docUrl: ideaUrl } : {}),
            ...(p.idea.level ? { level: p.idea.level } : {})
          }
        : undefined
      // Only a real file of theirs: the same sandbox as reading. An idea has no folder, so no place.
      const anchor = root && p.at ? { path: (await ports.files.resolve(root, p.at.path, allowed)).rel, line: p.at.line } : undefined
      const card: Card = {
        kind: 'step',
        title: p.title,
        ...(idea ? { idea } : {}),
        lines,
        ...(anchor ? { anchor } : {}),
        ...(p.question ? { question: { question: p.question.question, options: p.question.options, allowOther: true } } : {})
      }
      check(card)
      // A card ends the reply (a round of only cards ends the turn): another round would only repeat the headline.
      return { ...shown(card, p.question ? ' Wait for their answer.' : ''), terminate: true }
    }
  }

  const Item = Type.Object({
    type: Type.Union([Type.Literal('box'), Type.Literal('cells'), Type.Literal('note'), Type.Literal('arrow')], {
      description: 'box: a value or a few words in a shape. cells: a row of cells (a list, a queue, letters). note: words with no border. arrow: from one thing to another.'
    }),
    id: Type.String({ maxLength: 24, description: 'Short name to refer to it later: "total", "nums". A cell is "<row id>.<index>": "nums.2".' }),
    text: Type.Optional(Type.String({ maxLength: BOARD_LIMITS.noteText, description: 'box or note: a value or a few plain words ("5", "\\"milk\\"", "empty")' })),
    label: Type.Optional(Type.String({ maxLength: BOARD_LIMITS.boxText, description: 'box or cells: its name, shown above it ("total"); arrow: a word on it' })),
    items: Type.Optional(Type.Array(Type.String({ maxLength: BOARD_LIMITS.boxText }), { maxItems: BOARD_LIMITS.cells, description: 'cells: one value per cell' })),
    col: Type.Optional(Type.Integer({ minimum: 0, maximum: BOARD_LIMITS.cols - 1, description: 'Grid column, 0 on the left (a box is one column wide; a cell is a third of one)' })),
    row: Type.Optional(Type.Integer({ minimum: 0, maximum: BOARD_LIMITS.rows - 1, description: 'Grid row, 0 at the top' })),
    width: Type.Optional(Type.Integer({ minimum: 1, maximum: 4, description: 'box: columns wide (default 1)' })),
    shape: Type.Optional(Type.Union([Type.Literal('box'), Type.Literal('circle'), Type.Literal('diamond')])),
    indexes: Type.Optional(Type.Boolean({ description: 'cells: show 0, 1, 2… under them (default true)' })),
    from: Type.Optional(Type.String({ description: 'arrow: id it starts at' })),
    to: Type.Optional(Type.String({ description: 'arrow: id it points to' }))
  })
  const BoardStepParams = Type.Object({
    say: Type.String({ minLength: 2, maxLength: BOARD_LIMITS.say, description: 'One short plain line: what happens now ("i moves to the next cell")' }),
    add: Type.Optional(Type.Array(Item, { maxItems: BOARD_LIMITS.itemsPerStep })),
    change: Type.Optional(
      Type.Array(
        Type.Object({
          id: Type.String({ description: 'A box, note, arrow, a row, or one cell ("nums.2")' }),
          text: Type.Optional(Type.String({ maxLength: BOARD_LIMITS.noteText, description: 'New value or words' })),
          items: Type.Optional(Type.Array(Type.String({ maxLength: BOARD_LIMITS.boxText }), { maxItems: BOARD_LIMITS.cells, description: 'A row: all its cells, when it grows or shrinks' }))
        }),
        { maxItems: BOARD_LIMITS.itemsPerStep }
      )
    ),
    remove: Type.Optional(Type.Array(Type.String(), { maxItems: BOARD_LIMITS.itemsPerStep, description: 'Ids to take off (their arrows go too)' })),
    focus: Type.Optional(Type.Array(Type.String(), { maxItems: 6, description: 'Ids to light up in this step (what is added or changed lights up anyway)' }))
  })
  const BoardParams = Type.Object({
    title: Type.String({ maxLength: 80, description: 'What this shows, e.g. "Why the loop stops one early"' }),
    note: Type.String({ maxLength: 200, description: 'What to watch for, in plain words' }),
    steps: Type.Array(BoardStepParams, { minItems: 1, maxItems: BOARD_LIMITS.steps })
  })
  const draw: AgentTool<typeof BoardParams> = {
    name: 'draw_board',
    label: 'Whiteboard',
    description:
      'Draw on a whiteboard, step by step, like a teacher: boxes for values (label = the name, text = the value), rows of cells for lists, notes, and arrows for what points to what. Each step adds, changes, removes or lights up things and says what happened in one line; the learner plays it or steps through. Lay things out on a 10×10 grid (col, row), leaving room between them. Use it to show how data changes (loops, indexes, lists, references, recursion, sorting) or how parts of their program connect. Values and plain words only, never code.',
    parameters: BoardParams,
    execute: async (_id, p) => {
      const board: Board = {
        steps: p.steps.map((s, n) => ({
          say: s.say.trim(),
          add: (s.add ?? []).map((it) => boardItem(it, n)),
          change: (s.change ?? []).map((c) => ({ id: c.id, ...(c.text !== undefined ? { text: c.text } : {}), ...(c.items ? { items: c.items } : {}) })),
          remove: s.remove ?? [],
          focus: s.focus ?? []
        }))
      }
      const problem = boardProblem(board)
      if (problem) throw new Error(problem)
      const card: Card = { kind: 'board', title: p.title, note: p.note, board }
      check(card)
      return { ...shown(card), terminate: true }
    }
  }

  return [ask, diagram, pointTo, step, draw] as AgentTool<any>[]
}

/** One item from the tool's flat shape, checked for what its type needs. */
function boardItem(
  it: { type: BoardItem['type']; id: string; text?: string; label?: string; items?: string[]; col?: number; row?: number; width?: number; shape?: 'box' | 'circle' | 'diamond'; indexes?: boolean; from?: string; to?: string },
  n: number
): BoardItem {
  const at = `Step ${n + 1}, "${it.id}"`
  const place = () => {
    if (it.col === undefined || it.row === undefined) throw new Error(`${at}: give it a col and a row.`)
    return { col: it.col, row: it.row }
  }
  switch (it.type) {
    case 'box':
      if (!it.text) throw new Error(`${at}: a box needs text.`)
      if (it.text.length > BOARD_LIMITS.boxText) throw new Error(`${at}: keep a box to ${BOARD_LIMITS.boxText} characters; use a note for more.`)
      return { type: 'box', id: it.id, text: it.text, ...place(), ...(it.label ? { label: it.label } : {}), ...(it.width ? { width: it.width } : {}), ...(it.shape ? { shape: it.shape } : {}) }
    case 'cells':
      if (!it.items?.length) throw new Error(`${at}: a row of cells needs items.`)
      return { type: 'cells', id: it.id, items: it.items, ...place(), ...(it.label ? { label: it.label } : {}), ...(it.indexes === false ? { indexes: false } : {}) }
    case 'note':
      if (!it.text) throw new Error(`${at}: a note needs text.`)
      return { type: 'note', id: it.id, text: it.text, ...place() }
    case 'arrow':
      if (!it.from || !it.to) throw new Error(`${at}: an arrow needs from and to.`)
      return { type: 'arrow', id: it.id, from: it.from, to: it.to, ...(it.label ? { label: it.label } : {}) }
  }
}

export const VISUAL_TOOL_NAMES = new Set([
  'ask_question',
  'show_diagram',
  'point_to_code',
  'explain_concept',
  'show_steps',
  'show_pseudocode',
  'show_step',
  'draw_board',
  // From before the whiteboard: old sessions still have these cards.
  'animate_code',
  'animate_example'
])
