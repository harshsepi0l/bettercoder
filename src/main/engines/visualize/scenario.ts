import type { ScenarioCall } from '../../../shared/trace'

/**
 * Scenarios are data, not code: a list of calls to names that exist in the
 * learner's file, with plain JSON arguments. BetterCoder turns them into calls
 * itself, so the coach never writes a driver script.
 */

const NAME = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)*$/
const ASSIGN = /^[A-Za-z][A-Za-z0-9_]{0,30}$/
const MAX_CALLS = 12
const MAX_ARGS_JSON = 2000

export class ScenarioError extends Error {}

function plainJson(v: unknown, depth = 0): boolean {
  if (depth > 4) return false
  if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) return true
  if (Array.isArray(v)) return v.every((x) => plainJson(x, depth + 1))
  if (typeof v === 'object') return Object.values(v as object).every((x) => plainJson(x, depth + 1))
  return false
}

/** Names defined at the top level of a Python file: functions and classes (and their methods, for dotted calls). */
export function pythonOutline(source: string): { functions: string[]; classes: Array<{ name: string; methods: string[] }> } {
  const functions: string[] = []
  const classes: Array<{ name: string; methods: string[] }> = []
  let current: { name: string; methods: string[] } | null = null
  for (const line of source.split('\n')) {
    const top = /^def\s+([A-Za-z_]\w*)\s*\(/.exec(line)
    const cls = /^class\s+([A-Za-z_]\w*)\s*[(:]/.exec(line)
    const method = /^\s+def\s+([A-Za-z_]\w*)\s*\(/.exec(line)
    if (top) {
      functions.push(top[1])
      current = null
    } else if (cls) {
      current = { name: cls[1], methods: [] }
      classes.push(current)
    } else if (method && current) {
      current.methods.push(method[1])
    } else if (/^\S/.test(line) && !/^(#|@)/.test(line)) {
      current = null
    }
  }
  return { functions, classes }
}

/** Check a scenario against the learner's file. Throws ScenarioError with a plain explanation. */
export function validateScenario(calls: ScenarioCall[], source: string): ScenarioCall[] {
  if (!Array.isArray(calls)) throw new ScenarioError('The scenario must be a list of calls.')
  if (calls.length === 0) return [] // no calls: run the whole file top to bottom
  if (calls.length > MAX_CALLS) throw new ScenarioError(`Keep the scenario to ${MAX_CALLS} calls or fewer.`)
  const outline = pythonOutline(source)
  const topNames = new Set([...outline.functions, ...outline.classes.map((c) => c.name)])
  const assigned = new Set<string>()
  return calls.map((c, i) => {
    if (typeof c?.call !== 'string' || !NAME.test(c.call)) {
      throw new ScenarioError(`Call ${i + 1}: "${String(c?.call)}" is not a plain name. Private names (starting with _) are not allowed.`)
    }
    const [head] = c.call.split('.')
    if (!topNames.has(head) && !assigned.has(head)) {
      throw new ScenarioError(`Call ${i + 1}: "${head}" is not a function or class in this file, or a name made earlier in the scenario.`)
    }
    const args = c.args ?? []
    if (!Array.isArray(args) || !args.every((a) => plainJson(a)) || JSON.stringify(args).length > MAX_ARGS_JSON) {
      throw new ScenarioError(`Call ${i + 1}: arguments must be plain values (text, numbers, true/false, lists).`)
    }
    if (c.assign !== undefined) {
      if (typeof c.assign !== 'string' || !ASSIGN.test(c.assign)) throw new ScenarioError(`Call ${i + 1}: "${String(c.assign)}" is not a valid name to keep the result under.`)
      assigned.add(c.assign)
    }
    return { call: c.call, args, ...(c.assign ? { assign: c.assign } : {}) }
  })
}

function show(v: unknown): string {
  return typeof v === 'string' ? `"${v}"` : JSON.stringify(v)
}

/** The scenario in plain words, for the panel. */
export function describeScenario(calls: ScenarioCall[]): string[] {
  if (calls.length === 0) return ['Run the whole file, top to bottom']
  return calls.map((c) => {
    const args = c.args.length ? ` with ${c.args.map(show).join(', ')}` : ''
    const parts = c.call.split('.')
    const isCreate = parts.length === 1 && /^[A-Z]/.test(parts[0])
    const what = isCreate ? `Create a ${parts[0]}${args}` : `Call ${c.call}${args}`
    return c.assign ? `${what}, and call it ${c.assign}` : what
  })
}
