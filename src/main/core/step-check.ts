import type { RunSummary } from '../../shared/code'
import { expectWords, type CheckResult, type RunCheck } from '../../shared/step-checks'

/**
 * Grading one Check run with fixed rules (never the model): did it crash, which numbers and words it printed. What
 * was typed is echoed into the output by the terminal, so it is taken out first: typing 3 is not printing 3.
 */

const NUMBER = /-?\d+(?:\.\d+)?/g
const squash = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()

function numbersIn(text: string): number[] {
  return (text.match(NUMBER) ?? []).map(Number)
}

/** What it printed itself: the output with each typed line's echo taken out once, in order. */
export function withoutEcho(output: string, inputs: readonly string[]): string {
  let out = output
  let from = 0
  for (const input of inputs) {
    if (!input) continue
    const at = out.indexOf(input, from)
    if (at < 0) continue
    out = out.slice(0, at) + out.slice(at + input.length)
    from = at
  }
  return out
}

export function gradeCheck(check: RunCheck, run: RunSummary, timedOut: boolean): CheckResult[] {
  const output = withoutEcho(run.output, check.inputs)
  return check.expect.map((e) => {
    const line = expectWords(check, e)
    const ok = (pass: boolean, why: string): CheckResult => ({ line, pass, why: pass ? '' : why })
    switch (e.kind) {
      case 'no_crash':
        if (timedOut) return ok(false, 'It was still running when the check stopped it: it may be waiting for more input.')
        if (run.error) return ok(false, run.words ?? `It stopped with ${run.error.type}.`)
        return ok(run.exitCode === 0, `It ended with exit status ${run.exitCode ?? 'unknown'}.`)
      case 'prints_number': {
        const seen = numbersIn(output)
        return ok(seen.some((n) => Math.abs(n - e.value) < 1e-9), seen.length ? `It printed ${[...new Set(seen)].slice(0, 4).join(', ')}, not ${e.value}.` : 'It printed no number.')
      }
      case 'prints':
        return ok(squash(output).includes(squash(e.text)), `“${e.text}” never showed.`)
      case 'not_prints':
        return ok(!squash(output).includes(squash(e.text)), `It still showed “${e.text}”.`)
    }
  })
}
