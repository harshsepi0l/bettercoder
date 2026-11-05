import { Type } from 'typebox'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import type { CodeMap, MapNode } from '../../../shared/map'
import type { ProjectInfo } from '../../../shared/ipc'
import type { CodeMapper } from '../../ports'

/**
 * project_outline: the project's structure (files, classes, methods, functions,
 * unfinished parts) from the same reader as the Map tab. Cheap and read-only:
 * the coach uses it to know WHERE things are and to offer real options when
 * it asks the learner which part they mean.
 */

function node(n: MapNode): string {
  const unfinished = (m: { stub?: boolean }) => (m.stub ? ' [unfinished]' : '')
  const methods = n.methods.map((m) => `${m.name}${m.detail}${unfinished(m)} @${m.line}`).join(', ')
  if (n.kind === 'module') return `  functions: ${methods || '(none)'}`
  const label = n.kind === 'class' ? 'class' : n.kind
  const fields = n.fields.length ? ` fields: ${n.fields.map((f) => f.name).join(', ')};` : ''
  return `  ${label} ${n.name} @${n.line}:${fields} ${methods ? `methods: ${methods}` : 'no methods'}`
}

/** The outline as compact text for the model. */
export function formatOutline(map: CodeMap): string {
  if (map.nodes.length === 0 && map.skipped.length === 0) return 'No classes or functions found yet (code written at the top level of a file has none). Read the file or use the editor view instead; calling this again will not show more until they add some.'
  const byFile = new Map<string, MapNode[]>()
  for (const n of map.nodes) byFile.set(n.file, [...(byFile.get(n.file) ?? []), n])
  const lines: string[] = []
  for (const [file, nodes] of [...byFile].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`${file}${file.endsWith('.ipynb') ? ' (line numbers refer to the notebook cell view)' : ''}`)
    for (const n of nodes) lines.push(node(n))
  }
  for (const s of map.skipped) lines.push(`${s.file}: ${s.reason}`)
  if (map.libraries.length) lines.push(`imports: ${map.libraries.join(', ')}`)
  if (map.truncated) lines.push(map.truncated)
  return lines.join('\n')
}

export function createOutlineTool(project: ProjectInfo, mapper: CodeMapper): AgentTool<any> {
  const Params = Type.Object({})
  const tool: AgentTool<typeof Params> = {
    name: 'project_outline',
    label: 'Outline',
    description:
      'Outline of the project: files, classes, methods and functions with line numbers, unfinished ones marked. Read-only and cheap. Use it first to know where things are, and to build options when you ask the learner which part they mean.',
    parameters: Params,
    execute: async () => ({ content: [{ type: 'text' as const, text: formatOutline(await mapper.build(project)) }], details: undefined })
  }
  return tool as AgentTool<any>
}
