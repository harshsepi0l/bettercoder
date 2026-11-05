/**
 * Part-by-part labels on an official doc line, for topics the learner is new to.
 *
 * The coach never sees the official line, so it names the parts it expects ("Console.ReadLine()", "=", ";") with a
 * few plain words each. The app then finds those parts in the line it copied from the docs: a part that is not there
 * is dropped, and the line itself is never changed.
 */

/** A part the coach expects in the official line, with its plain-words label. */
export interface LinePart {
  part: string
  says: string
}

/** One piece of the official line, labelled when the coach named it. */
export interface LineSegment {
  text: string
  says?: string
}

/** A name ("s", "Console.ReadLine", "Console.ReadLine()", "string?") or a short symbol ("=", ";", "+=", "()"). */
export const PART_PATTERN = /^(?:[A-Za-z_][\w.]*(?:\(\)|\?)?|[=;:+\-*/%<>!&|?.,()[\]{}]{1,3})$/

const isName = (s: string) => /^[A-Za-z_]/.test(s)
const wordChar = (c: string | undefined) => !!c && /[\w]/.test(c)

/** Where `part` starts in `line` at or after `from`, as a whole name (or a symbol anywhere). */
function find(line: string, part: string, taken: boolean[]): number {
  for (let i = line.indexOf(part); i >= 0; i = line.indexOf(part, i + 1)) {
    if (isName(part) && (wordChar(line[i - 1]) || line[i - 1] === '.' || (wordChar(part.at(-1)) && wordChar(line[i + part.length])))) continue
    if (taken.slice(i, i + part.length).some(Boolean)) continue
    return i
  }
  return -1
}

/**
 * Split the official line into pieces, labelling the parts the coach named that really are in it.
 * A call named with "()" also matches the call with arguments in the line ("Console.ReadLine()" → "Console.ReadLine").
 */
export function splitLine(line: string, parts: readonly LinePart[]): LineSegment[] {
  const taken = new Array<boolean>(line.length).fill(false)
  const hits: Array<{ at: number; len: number; says: string }> = []
  for (const { part, says } of parts) {
    const p = part.trim()
    if (!p || !says.trim()) continue
    let at = find(line, p, taken)
    let len = p.length
    if (at < 0 && p.endsWith('()')) {
      len = p.length - 2
      at = find(line, p.slice(0, -2), taken)
    }
    if (at < 0) continue
    taken.fill(true, at, at + len)
    hits.push({ at, len, says: says.trim() })
  }
  hits.sort((a, b) => a.at - b.at)
  const out: LineSegment[] = []
  let pos = 0
  for (const h of hits) {
    if (h.at > pos) out.push({ text: line.slice(pos, h.at) })
    out.push({ text: line.slice(h.at, h.at + h.len), says: h.says })
    pos = h.at + h.len
  }
  if (pos < line.length) out.push({ text: line.slice(pos) })
  return out
}
