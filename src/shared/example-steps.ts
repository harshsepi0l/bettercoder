import type { TraceFrame, TraceStep, TraceValue } from './trace'

/**
 * With the code hidden, a step is only worth showing when something on screen changes: a value or the output.
 * Steps that change nothing (and the empty start) are dropped; the last step always stays.
 */
export function visibleSteps(steps: readonly TraceStep[]): TraceStep[] {
  const seen = (s: TraceStep) => JSON.stringify([s.frames.map((f) => f.locals), s.output, s.exception ?? null])
  const out: TraceStep[] = []
  for (const [i, s] of steps.entries()) {
    const empty = s.frames.every((f) => f.locals.length === 0) && !s.output && !s.exception
    if (i < steps.length - 1 && (empty || (out.length && seen(out.at(-1)!) === seen(s)))) continue
    if (out.length && seen(out.at(-1)!) === seen(s)) out.pop()
    out.push(s)
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
 * A frame's values for a hidden example, with every name the run ever makes in that frame, in the order first made:
 * a name not made yet has no value (shown faded), so going back never makes values vanish from the box.
 */
export function localsWithPending(steps: readonly TraceStep[], frameIndex: number, frame: TraceFrame): Array<[string, TraceValue | undefined]> {
  const names: string[] = []
  for (const s of steps) {
    const f = s.frames[frameIndex]
    if (f?.func !== frame.func) continue
    for (const [n] of f.locals) if (!names.includes(n)) names.push(n)
  }
  const now = new Map(frame.locals)
  return names.map((n) => [n, now.get(n)])
}
