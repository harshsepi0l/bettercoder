/**
 * Checked steps: a step card can carry checks, and Check runs the learner's file once per check with its inputs typed
 * in (in their ▶ Run terminal), then the app grades each expectation with fixed rules (core/step-check.ts), never
 * the model. The words for each line come from the app too.
 */

/** What a run should do. Only things the app can tell from a run on its own. */
export type Expect =
  /** It ends normally (exit 0, no error, did not hang). */
  | { kind: 'no_crash' }
  /** This number appears in what it printed (by value: 10, 10.0). */
  | { kind: 'prints_number'; value: number }
  /** These words appear in what it printed (ignoring case and spacing): a line their code already prints, or one the step asks for. */
  | { kind: 'prints'; text: string }
  /** These words never appear: a prompt it should skip. */
  | { kind: 'not_prints'; text: string }

/** One run: the lines typed in, in order, and what should happen. */
export interface RunCheck {
  inputs: string[]
  expect: Expect[]
}

export const MAX_CHECKS = 4
export const MAX_INPUTS = 8
export const MAX_EXPECTS = 3

/** One expectation's outcome after Check. */
export interface CheckResult {
  /** What was checked, in the app's words ("Type abc: no crash"). */
  line: string
  pass: boolean
  /** Why it failed, in plain words (empty when it passed). */
  why: string
}

/** The last Check of a step card. */
export interface StepRun {
  at: number
  results: CheckResult[]
  passed: boolean
}

/** Which task step a step card is (set by the coach: the task's id, and the step's number from 1). */
export interface StepOfTask {
  taskId: string
  step: number
}

/** The same card always has the same key (its title and checks), across restarts. */
export function stepKey(title: string, checks: readonly RunCheck[]): string {
  return `${title}\u0000${JSON.stringify(checks)}`
}

function typed(inputs: readonly string[]): string {
  if (inputs.length === 0) return 'Run it'
  return `Type ${inputs.map((i) => (i === '' ? '(Enter)' : i)).join(', then ')}`
}

/** The line a learner reads for one expectation of a check. */
export function expectWords(check: RunCheck, e: Expect): string {
  const how = typed(check.inputs)
  switch (e.kind) {
    case 'no_crash':
      return `${how}: it doesn't crash`
    case 'prints_number':
      return `${how}: it prints ${e.value}`
    case 'prints':
      return `${how}: it shows “${e.text}”`
    case 'not_prints':
      return `${how}: it never shows “${e.text}”`
  }
}

const short = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : null)

/** Checks as they came over IPC or from the model, kept to what is allowed (anything else is dropped). */
export function cleanChecks(raw: unknown): RunCheck[] {
  if (!Array.isArray(raw)) return []
  const out: RunCheck[] = []
  for (const c of raw.slice(0, MAX_CHECKS)) {
    if (!c || typeof c !== 'object') continue
    const inputs = Array.isArray(c.inputs) ? c.inputs.slice(0, MAX_INPUTS).map((i: unknown) => short(i, 60)).filter((i: string | null): i is string => i !== null && !/[\r\n]/.test(i)) : []
    const expect: Expect[] = []
    for (const e of Array.isArray(c.expect) ? c.expect.slice(0, MAX_EXPECTS) : []) {
      if (e?.kind === 'no_crash') expect.push({ kind: 'no_crash' })
      else if (e?.kind === 'prints_number' && typeof e.value === 'number' && Number.isFinite(e.value)) expect.push({ kind: 'prints_number', value: e.value })
      else if ((e?.kind === 'prints' || e?.kind === 'not_prints') && short(e.text, 80)?.trim()) expect.push({ kind: e.kind, text: short(e.text, 80)!.trim() })
    }
    if (expect.length) out.push({ inputs, expect })
  }
  return out
}
