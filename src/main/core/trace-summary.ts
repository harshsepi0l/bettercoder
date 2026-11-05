import type { Trace, TraceValue } from '../../shared/trace'

/** A value as Python would print it, roughly. */
export function plainValue(v: TraceValue): string {
  switch (v.t) {
    case 'none':
      return 'None'
    case 'bool':
      return v.v ? 'True' : 'False'
    case 'num':
      return String(v.v)
    case 'str':
      return JSON.stringify(v.v)
    case 'list': {
      const [open, close] = v.kind === 'list' ? ['[', ']'] : v.kind === 'tuple' ? ['(', ')'] : ['{', '}']
      return `${open}${v.items.map(plainValue).join(', ')}${v.more ? `, …${v.more} more` : ''}${close}`
    }
    case 'dict':
      return `{${v.entries.map(([k, x]) => `${plainValue(k)}: ${plainValue(x)}`).join(', ')}${v.more ? ', …' : ''}}`
    case 'obj':
      return `${v.cls}(${v.fields.map(([k, x]) => `${k}=${plainValue(x)}`).join(', ')})`
    case 'func':
      return `<${v.name}>`
    case 'repr':
      return v.v
  }
}

/** A short text summary of a trace, for the coach to reason about. */
export function summarizeTrace(trace: Trace): string {
  const lines = [`Ran ${trace.scenario.length} call(s) on ${trace.file}: ${trace.steps.length} steps recorded.`]
  const last = trace.steps.at(-1)
  if (last) {
    const scenarioVars = last.frames[0]?.locals.map(([k, v]) => `${k} = ${plainValue(v).slice(0, 300)}`) ?? []
    if (scenarioVars.length) lines.push(`At the end: ${scenarioVars.join('; ')}`)
    if (last.output.trim()) lines.push(`Printed: ${last.output.trim().slice(-300)}`)
  }
  const exc = trace.steps.find((s) => s.exception)
  if (exc) lines.push(`Exception at ${exc.file}:${exc.line} in ${exc.func}: ${exc.exception}`)
  if (trace.stopped) lines.push(`Stopped: ${trace.stopped}`)
  return lines.join('\n')
}
