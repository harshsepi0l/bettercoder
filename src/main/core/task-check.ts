import type { RunSummary } from '../../shared/code'
import type { TaskCheck } from '../../shared/tasks'

/**
 * Check my answer: does their last ▶ Run print the coach's answer? Decided here, by fixed rules, never by the model:
 * a number answer matches any number in the output of equal value (35 = 35.0), anything else matches as text
 * (case and spacing ignored). A run still going, stopped, or crashed is not an answer.
 */

const NUMBER = /-?\d+(?:[.,]\d+)?(?:e[+-]?\d+)?/gi

function numberOf(text: string): number | null {
  const t = text.trim().replace(',', '.')
  return /^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(t) ? Number(t) : null
}

function squash(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim()
}

/** Does this output hold the answer? */
export function outputHas(output: string, answer: string): boolean {
  const want = numberOf(answer)
  if (want !== null) {
    for (const m of output.match(NUMBER) ?? []) {
      const got = numberOf(m)
      if (got !== null && Math.abs(got - want) <= 1e-9 * Math.max(1, Math.abs(want))) return true
    }
    return false
  }
  const a = squash(answer)
  return a.length > 0 && squash(output).includes(a)
}

/** The last thing their run printed, short, for "Your run printed …". */
export function lastPrinted(output: string): string {
  const lines = output
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const last = lines.at(-1) ?? ''
  return last.length > 60 ? `${last.slice(0, 57)}…` : last
}

export function checkAnswer(answer: string, run: RunSummary | null, now: number): TaskCheck {
  if (!run) return { at: now, result: 'no_run', words: 'Run your code first (▶ in VS Code), then check.' }
  if (run.endedAt === null) return { at: now, result: 'no_run', words: 'Your run is still going. Finish it, then check.' }
  if (run.stopped) return { at: now, result: 'no_run', words: 'Your last run was stopped. Run it to the end, then check.' }
  if (run.error || (run.exitCode !== null && run.exitCode !== 0)) {
    return { at: now, result: 'not_yet', words: run.words ? `Your run crashed. ${run.words}` : 'Your run crashed before the end.' }
  }
  if (outputHas(run.output, answer)) return { at: now, result: 'matched', words: `Matched the coach: ${answer.trim()}.` }
  const printed = lastPrinted(run.output)
  return { at: now, result: 'not_yet', words: printed ? `Not yet. Your run ended with “${printed}”.` : 'Not yet. Your run printed nothing.' }
}
