import { Type } from 'typebox'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import type { Card } from '../../../shared/cards'
import { PART_PATTERN } from '../../../shared/line-parts'
import { StreamGuard, exampleProblem, isCodeLine, pseudocodeProblem } from '../../core/guard'
import { redactSecrets } from '../../core/paths'
import { viewLines } from '../../core/text-view'
import { summarizeTrace } from '../../core/trace-summary'
import type { Animator, ProjectFiles } from '../../ports'
import type { Trace } from '../../../shared/trace'
import { visibleSteps } from '../../../shared/example-steps'

/**
 * Tools that draw cards in the chat. They keep the coach visual and short:
 * a question to click, a diagram, the learner's own code with a line to look
 * at, a concept, or a short checklist.
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
    case 'animation':
      texts.push(card.title, card.note) // the trace is their own code, actually run
      break
  }
  for (const t of texts) if (t && codeInText(t)) return 'That card contained code. Say it in plain words instead.'
  return null
}

function shown(card: Card, extra = '') {
  return { content: [{ type: 'text' as const, text: `Shown to the learner.${extra}` }], details: card }
}

/**
 * The card tools. `fs` (read-only project access) and `animator` come in as ports, so these never touch files or
 * processes themselves.
 */
export function createVisualTools(
  ports: { files: ProjectFiles; animator: Animator },
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
        { description: "Where in THEIR file this step is written. Their editor marks the line and shows your lines there, faded, one at a time as they type. Use it whenever you know the place." }
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

  const AnimateParams = Type.Object({
    file: Type.String({ description: 'Python file or Jupyter notebook (.ipynb), relative to the project root' }),
    scenario: Type.Optional(Type.Array(
      Type.Object({
        call: Type.String({
          description:
            'A function or class name from that file, or a method on a name you assigned earlier: "TodoList", "todos.add". No code, no private names.'
        }),
        args: Type.Optional(Type.Array(Type.Unknown(), { description: 'Plain values only: text, numbers, true/false, lists' })),
        assign: Type.Optional(Type.String({ description: 'Keep the result under this name for later calls, e.g. "todos"' }))
      }),
      {
        maxItems: 12,
        description: 'Calls to make. Leave it out (or empty) to run the whole file or notebook top to bottom.'
      }
    )),
    title: Type.String({ maxLength: 80, description: 'What this shows, e.g. "What remove(1) really deletes"' }),
    note: Type.String({ maxLength: 200, description: 'What to watch for, in plain words' })
  })
  const animate: AgentTool<typeof AnimateParams> = {
    name: 'animate_code',
    label: 'Animation',
    description:
      "Actually RUN the learner's own Python code or notebook and show an animation they can step through: the current line, the variables, lists and arrays drawn as boxes/grids. Best way to show what their code really does (bugs, loops, off-by-one, recursion). Either run the whole file/notebook top to bottom (no scenario), or describe calls as data (names in their file + plain values); BetterCoder builds and runs it, so you never write code. You get a summary of what happened.",
    parameters: AnimateParams,
    execute: async (_id, p) => {
      const trace = await ports.animator.run({
        root,
        files,
        file: p.file,
        scenario: (p.scenario ?? []).map((c) => ({ call: c.call, args: c.args ?? [], ...(c.assign ? { assign: c.assign } : {}) }))
      })
      const card: Card = { kind: 'animation', title: p.title, note: p.note, trace }
      check(card)
      return {
        content: [{ type: 'text' as const, text: `Shown to the learner as an animation.\n${summarizeTrace(trace)}` }],
        details: card
      }
    }
  }

  const ExampleParams = Type.Object({
    python: Type.String({
      maxLength: 4000,
      description:
        'A short, self-contained Python script (standard library only, no input(), no network, no files) that shows the idea with plain, well-named variables. Hidden from the learner: they see only the variables and what it prints.'
    }),
    title: Type.String({ maxLength: 80, description: 'What this shows, e.g. "A dict becomes text and back"' }),
    note: Type.String({ maxLength: 200, description: 'What to watch for, in plain words' })
  })
  const example: AgentTool<typeof ExampleParams> = {
    name: 'animate_example',
    label: 'Animation',
    description:
      "Show an idea in motion with the animator: you write a small Python example, BetterCoder runs it in a sandbox, and the learner steps through how the variables change (lists, dicts and objects drawn as boxes) and what it prints. They never see your code, so it does not break the no-code rule; never repeat it in text or cards. Prefer this over a diagram to show what data looks like as it changes (serializing, sorting, loops, references). Python only. Prints and text values must be data, not code.",
    parameters: ExampleParams,
    execute: async (_id, p) => {
      const ran = await ports.animator.runExample(p.python)
      // The code stays here: the window gets the variables and output only.
      const trace: Trace = { ...ran, file: 'example', source: [], scenario: [], example: true, steps: visibleSteps(ran.steps).map((s) => ({ ...s, file: 'example' })) }
      const problem = exampleProblem(trace)
      if (problem) throw new Error(problem)
      const card: Card = { kind: 'animation', title: p.title, note: p.note, trace }
      check(card)
      return {
        content: [{ type: 'text' as const, text: `Shown to the learner as an animation (your code stays hidden).\n${summarizeTrace(trace)}` }],
        details: card
      }
    }
  }

  return [ask, diagram, pointTo, step, animate, example] as AgentTool<any>[]
}

export const VISUAL_TOOL_NAMES = new Set([
  'ask_question',
  'show_diagram',
  'point_to_code',
  'explain_concept',
  'show_steps',
  'show_pseudocode',
  'show_step',
  'animate_code',
  'animate_example'
])
