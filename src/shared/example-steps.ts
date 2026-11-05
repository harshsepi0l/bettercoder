import type { TraceFrame, TraceStep, TraceValue } from './trace'

/**
 * With the code hidden, a step is only worth showing when something on screen changes: a value or the output.
 * Steps that change nothing (and the empty start) are dropped; the last step always stays.
 */
export function visibleSteps(steps: readonly TraceStep[]): TraceStep[] {
  const seen = (s: TraceStep) => JSON.stringify([s.frames.map((f) => f.locals), s.output, s.exception ?? null])
  const out: TraceStep[] = []
  let lastKey = ''
  for (const [i, s] of steps.entries()) {
    const key = seen(s)
    const empty = s.frames.every((f) => f.locals.length === 0) && !s.output && !s.exception
    const same = out.length > 0 && key === lastKey
    if (i < steps.length - 1 && (empty || same)) continue
    if (same) out.pop()
    out.push(s)
    lastKey = key
  }
  return out
}

/**
 * Variables whose value changed since the previous step, as "frameIndex:name". On the first step everything present
 * is new (regression: step 1 lit its story line but none of its values).
 */
export function changedNames(prev: TraceStep | undefined, cur: TraceStep): Set<string> {
  const out = new Set<string>()
  cur.frames.forEach((f, i) => {
    const before = prev?.frames[i]
    for (const [name, v] of f.locals) {
      const old = before?.func === f.func ? before.locals.find(([n]) => n === name)?.[1] : undefined
      if (!old || JSON.stringify(old) !== JSON.stringify(v)) out.add(`${i}:${name}`)
    }
  })
  return out
}

/**
 * Every name each frame of a hidden example ever makes, in the order first made, keyed "frameIndex:func". Worked out
 * once per trace, so drawing a step never rescans the whole run.
 */
export function frameNames(steps: readonly TraceStep[]): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const s of steps) {
    s.frames.forEach((f, fi) => {
      const key = `${fi}:${f.func}`
      const names = out.get(key) ?? (out.set(key, []), out.get(key)!)
      for (const [n] of f.locals) if (!names.includes(n)) names.push(n)
    })
  }
  return out
}

/**
 * A frame's values with every name it will ever make (from frameNames): a name not made yet has no value (shown
 * faded), so going back never makes values vanish from the box.
 */
export function localsWithPending(names: readonly string[] | undefined, frame: TraceFrame): Array<[string, TraceValue | undefined]> {
  const now = new Map(frame.locals)
  return (names ?? frame.locals.map(([n]) => n)).map((n) => [n, now.get(n)])
}

/** One line of a hidden example's story: what this step made, changed or printed. */
export type StoryPart = { name: string; what: string } | { text: string }

/**
 * For a hidden example: what changed on screen, since there are no lines to point at. Uses the same rule as the lit
 * values (changedNames), so a story line and its values always agree. Names are kept apart to light them.
 */
export function storyLine(prev: TraceStep | undefined, step: TraceStep, isLast: boolean): StoryPart[] {
  if (step.event === 'exception') return [{ text: `Error: ${step.exception ?? ''}` }]
  const changed = changedNames(prev, step)
  const parts: StoryPart[] = []
  step.frames.forEach((f, fi) => {
    const had = prev?.frames[fi]?.func === f.func ? new Set(prev.frames[fi].locals.map(([n]) => n)) : new Set<string>()
    for (const [n] of f.locals) if (changed.has(`${fi}:${n}`)) parts.push({ name: n, what: had.has(n) ? 'changes' : 'is made' })
  })
  const printed = step.output.slice(prev?.output.length ?? 0).trim()
  if (printed) parts.push({ text: `prints ${printed.split('\n').at(-1)}` })
  if (parts.length) return parts
  return [{ text: isLast ? 'Done' : 'Start' }]
}
