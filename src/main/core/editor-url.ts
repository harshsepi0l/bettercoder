/**
 * Opening a file or folder in the learner's editor, through the editor's own link (`vscode://file/<path>:<line>`).
 * It only opens: nothing is written. The linked editor is used; with none linked, VS Code.
 */

const SCHEMES: Array<[RegExp, string]> = [
  [/cursor/i, 'cursor'],
  [/windsurf/i, 'windsurf'],
  [/codium/i, 'vscodium'],
  [/insiders/i, 'vscode-insiders']
]

export function editorScheme(ide: string | null): string {
  for (const [re, scheme] of SCHEMES) if (ide && re.test(ide)) return scheme
  return 'vscode'
}

/** `abs` is an absolute path; each part is percent-encoded so "#" or "?" in a name can't break the link. */
export function editorUrl(ide: string | null, abs: string, line?: number): string {
  const path = abs.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/')
  const lead = path.startsWith('/') ? '' : '/'
  const at = line && Number.isInteger(line) && line > 0 ? `:${line}` : ''
  return `${editorScheme(ide)}://file${lead}${path}${at}`
}
