import { join } from 'node:path'
import { Type } from 'typebox'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import { SKIP_DIRS, isSecretPath } from '../../core/paths'
import type { ProjectFiles } from '../../ports'
import { searchTerms, viewLines } from '../../core/text-view'

/**
 * The coach's tools. All read-only: there is no tool that writes, edits,
 * deletes or runs anything in the user's project.
 */

const MAX_LIST = 300
const MAX_READ_BYTES = 96 * 1024
const MAX_READ_LINES = 200
const MAX_SEARCH_HITS = 80
const MAX_SEARCH_FILE_BYTES = 512 * 1024
/** Notebooks carry outputs (often images) in their JSON, so they may be big on disk but small as cells. */
const MAX_NOTEBOOK_BYTES = 20 * 1024 * 1024
const isNotebook = (p: string) => p.toLowerCase().endsWith('.ipynb')

function text(t: string) {
  return { content: [{ type: 'text' as const, text: t }], details: undefined }
}

const decode = (buf: Uint8Array) => new TextDecoder().decode(buf)

function isBinary(buf: Uint8Array): boolean {
  const n = Math.min(buf.length, 8000)
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true
  return false
}

/**
 * @param fs    Read-only access to the project (ports.ProjectFiles): every path goes through its gate.
 * @param files When the session was opened on individual files, the only paths
 *              (relative to root) the tools may see.
 */
export function createTools(fs: ProjectFiles, root: string, files?: string[]): AgentTool<any>[] {
  const allowed = files ? new Set(files) : undefined
  const resolveInside = fs.resolve

  const ListParams = Type.Object({
    path: Type.Optional(Type.String({ description: "Folder relative to the project root. Default '.'" })),
    depth: Type.Optional(Type.Integer({ minimum: 1, maximum: 4, description: 'How deep to go (1-4). Default 2.' }))
  })
  const listFiles: AgentTool<typeof ListParams> = {
    name: 'list_files',
    label: 'List files',
    description:
      'List files and folders in the project (read-only). Dependency and build folders are skipped. Use to see how the project is laid out.',
    parameters: ListParams,
    execute: async (_id, params) => {
      if (files) return text(`This session was opened on these files only:\n${files.join('\n')}`)
      const { abs, rel } = await resolveInside(root, params.path ?? '.')
      const depthLimit = params.depth ?? 2
      const lines: string[] = []
      async function walk(dir: string, prefix: string, depth: number): Promise<void> {
        if (lines.length >= MAX_LIST) return
        const entries = (await fs.list(dir)).sort((a, b) => a.name.localeCompare(b.name))
        for (const e of entries) {
          if (lines.length >= MAX_LIST) return
          if (e.name.startsWith('.') && e.name !== '.github') continue
          if (e.isDir) {
            if (SKIP_DIRS.has(e.name)) continue
            lines.push(`${prefix}${e.name}/`)
            if (depth < depthLimit) await walk(join(dir, e.name), prefix + '  ', depth + 1)
          } else if (e.isFile) {
            lines.push(`${prefix}${e.name}`)
          }
        }
      }
      await walk(abs, '', 1)
      const more = lines.length >= MAX_LIST ? `\n… (stopped at ${MAX_LIST} entries)` : ''
      return text(`${rel}/\n${lines.join('\n')}${more}`)
    }
  }

  const ReadParams = Type.Object({
    path: Type.String({ description: 'File path relative to the project root' }),
    start_line: Type.Optional(Type.Integer({ minimum: 1 })),
    end_line: Type.Optional(Type.Integer({ minimum: 1 }))
  })
  const readFileTool: AgentTool<typeof ReadParams> = {
    name: 'read_file',
    label: 'Read file',
    description:
      'Read a text file in the project (read-only), with line numbers. Jupyter notebooks are shown as cells (markdown, code, short outputs). Use start_line/end_line for large files. Files that hold secrets are refused.',
    parameters: ReadParams,
    execute: async (_id, params) => {
      const { abs, rel } = await resolveInside(root, params.path, allowed)
      const info = await fs.info(abs)
      if (!info.isFile) throw new Error(`${rel} is not a file`)
      const buf = await fs.read(abs)
      if (isBinary(buf)) throw new Error(`${rel} is a binary file`)
      const all = isNotebook(rel) && buf.length <= MAX_NOTEBOOK_BYTES
        ? viewLines(rel, decode(buf))
        : decode(buf.subarray(0, MAX_READ_BYTES)).split('\n')
      const start = Math.max(1, params.start_line ?? 1)
      const end = Math.min(all.length, params.end_line ?? start + MAX_READ_LINES - 1, start + MAX_READ_LINES - 1)
      const body = all
        .slice(start - 1, end)
        .map((l, i) => `${String(start + i).padStart(4)}  ${l}`)
        .join('\n')
      const tail = end < all.length ? `\n… (${all.length - end} more lines; ask for start_line=${end + 1})` : ''
      return text(`${rel} (lines ${start}-${end} of ${all.length})\n${body}${tail}`)
    }
  }

  const SearchParams = Type.Object({
    query: Type.String({ minLength: 2, description: 'Text to look for' }),
    path: Type.Optional(Type.String({ description: "Folder to search in, relative to the root. Default '.'" }))
  })
  const search: AgentTool<typeof SearchParams> = {
    name: 'search',
    label: 'Search',
    description:
      'Search the project for text (case-insensitive, read-only). Use "a|b|c" to match any of several words. Notebooks are searched by cell content. Returns file:line matches.',
    parameters: SearchParams,
    execute: async (_id, params, signal) => {
      const terms = searchTerms(params.query)
      if (terms.length === 0) throw new Error('Search for at least 2 characters.')
      const matches = (line: string) => {
        const l = line.toLowerCase()
        return terms.some((t) => l.includes(t))
      }
      const hits: string[] = []
      if (files) {
        for (const f of files) {
          if (hits.length >= MAX_SEARCH_HITS) break
          let abs: string
          try {
            abs = (await resolveInside(root, f, allowed)).abs
          } catch {
            continue
          }
          const buf = await fs.read(abs)
          if (isBinary(buf)) continue
          const lines = viewLines(f, decode(buf))
          for (let i = 0; i < lines.length && hits.length < MAX_SEARCH_HITS; i++) {
            if (matches(lines[i])) hits.push(`${f}:${i + 1}: ${lines[i].trim().slice(0, 160)}`)
          }
        }
        return text(hits.length ? hits.join('\n') : `No matches for "${params.query}".`)
      }
      const { abs } = await resolveInside(root, params.path ?? '.')
      const rootReal = (await resolveInside(root, '.')).abs
      async function walk(dir: string, depth: number): Promise<void> {
        if (hits.length >= MAX_SEARCH_HITS || depth > 6 || signal?.aborted) return
        const entries = await fs.list(dir)
        for (const e of entries) {
          if (hits.length >= MAX_SEARCH_HITS) return
          if (e.name.startsWith('.')) continue
          const full = join(dir, e.name)
          if (e.isDir) {
            if (!SKIP_DIRS.has(e.name)) await walk(full, depth + 1)
            continue
          }
          if (!e.isFile) continue
          const rel = full.slice(rootReal.length + 1)
          if (isSecretPath(rel)) continue
          const info = await fs.info(full)
          if (info.size > (isNotebook(rel) ? MAX_NOTEBOOK_BYTES : MAX_SEARCH_FILE_BYTES)) continue
          const buf = await fs.read(full)
          if (isBinary(buf)) continue
          const lines = viewLines(rel, decode(buf))
          for (let i = 0; i < lines.length && hits.length < MAX_SEARCH_HITS; i++) {
            if (matches(lines[i])) hits.push(`${rel}:${i + 1}: ${lines[i].trim().slice(0, 160)}`)
          }
        }
      }
      await walk(abs, 0)
      if (hits.length === 0) return text(`No matches for "${params.query}".`)
      const more = hits.length >= MAX_SEARCH_HITS ? `\n… (stopped at ${MAX_SEARCH_HITS} matches)` : ''
      return text(hits.join('\n') + more)
    }
  }

  return [listFiles, readFileTool, search] as AgentTool<any>[]
}
