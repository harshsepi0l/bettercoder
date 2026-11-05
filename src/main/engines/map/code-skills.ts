import { extname } from 'node:path'
import type { CodeMap } from '../../../shared/map'
import type { Skill } from '../../../shared/profile'
import { EXTENSIONS } from '../project'

const TEST_LIBRARIES = new Set(['pytest', 'unittest', 'junit', 'org', 'xunit', 'nunit', 'jest', 'vitest', 'mocha'])

/**
 * What the learner's own code shows they can do, per language, read from the Map (no model).
 * Only "basics": code may be copied or generated, so it never claims more; the coach raises it from evidence.
 */
export function codeSkills(map: CodeMap): Array<Omit<Skill, 'at'>> {
  const byLanguage = new Map<string, { classes: number; abstractions: number; inherits: number }>()
  const languageOf = (file: string) => EXTENSIONS[extname(file).toLowerCase()]
  const nodeLanguage = new Map<string, string>()
  for (const n of map.nodes) {
    const language = languageOf(n.file)
    if (!language) continue
    nodeLanguage.set(n.id, language)
    const c = byLanguage.get(language) ?? { classes: 0, abstractions: 0, inherits: 0 }
    if (n.kind === 'class' || n.kind === 'struct' || n.kind === 'abstract') c.classes++
    if (n.kind === 'interface' || n.kind === 'abstract') c.abstractions++
    byLanguage.set(language, c)
  }
  for (const e of map.edges) {
    if (e.kind === 'uses') continue
    const language = nodeLanguage.get(e.from)
    const c = language ? byLanguage.get(language) : undefined
    if (c) c.inherits++
  }

  const out: Array<Omit<Skill, 'at'>> = []
  for (const [language, c] of byLanguage) {
    if (c.classes > 0) out.push({ language, topic: 'classes', level: 'basics', evidence: `${c.classes} class${c.classes === 1 ? '' : 'es'} in their code`, by: 'code' })
    if (c.abstractions > 0 || c.inherits > 0) {
      out.push({ language, topic: 'interfaces and inheritance', level: 'basics', evidence: `${c.abstractions + c.inherits} interface, abstract or inheritance uses in their code`, by: 'code' })
    }
  }
  const tests = map.libraries.filter((l) => TEST_LIBRARIES.has(l))
  // The language most of their classes are in (the Map's own names group TypeScript and JavaScript).
  const main = [...byLanguage].sort((a, b) => b[1].classes - a[1].classes)[0]?.[0] ?? map.languages[0]
  if (tests.length > 0 && main) out.push({ language: main, topic: 'testing', level: 'basics', evidence: `imports ${tests.join(', ')}`, by: 'code' })
  return out
}
