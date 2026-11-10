/**
 * VS Code's settings, keybindings and snippets are JSON with comments and trailing commas (JSONC). This reads them:
 * comments outside strings and trailing commas are removed, then it is parsed as JSON. Null when it still isn't JSON.
 */
export function parseJsonc(text: string): unknown {
  let out = ''
  let i = 0
  const n = text.length
  while (i < n) {
    const c = text[i]
    if (c === '"') {
      // A string: copied as it is, escapes included.
      let j = i + 1
      while (j < n && text[j] !== '"') j += text[j] === '\\' ? 2 : 1
      out += text.slice(i, j + 1)
      i = j + 1
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < n && text[i] !== '\n') i++
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      i = end < 0 ? n : end + 2
    } else {
      out += c
      i++
    }
  }
  const cleaned = stripTrailingCommas(out)
  try {
    return JSON.parse(cleaned)
  } catch {
    return null
  }
}

/** Remove commas that come right before a closing } or ] (outside strings). */
function stripTrailingCommas(text: string): string {
  let out = ''
  let i = 0
  const n = text.length
  while (i < n) {
    const c = text[i]
    if (c === '"') {
      let j = i + 1
      while (j < n && text[j] !== '"') j += text[j] === '\\' ? 2 : 1
      out += text.slice(i, j + 1)
      i = j + 1
      continue
    }
    if (c === ',') {
      let j = i + 1
      while (j < n && /\s/.test(text[j])) j++
      if (text[j] === '}' || text[j] === ']') {
        i++
        continue
      }
    }
    out += c
    i++
  }
  return out
}
