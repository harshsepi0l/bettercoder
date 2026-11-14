'use strict'

/**
 * BetterCoder inside the Code tab's built-in VS Code. (Installed anywhere else, it does nothing.)
 *
 * Tells the BetterCoder app which file is open, where the cursor is, the text and the problems. Notebooks are
 * reported in the coach's own view of them (notebook-view.js): a header per cell, its source and short outputs, with
 * the same line numbers the coach's tools use. Shows what the app sends back: a label above the line where the step
 * goes (in a notebook, in the right cell) with "See the official line", which opens the method's official example
 * (copied word for word from the docs by the app) inline under that line, read-only; and a status line. Nothing is
 * ever written into the learner's files, and Tab never accepts anything.
 *
 * ▶ Run (the learner's button, in the editor's title bar): the app runs the file in its own terminal, so the coach
 * sees the last run and errors get their plain-words line; it streams back into a "▶ Run" terminal here, which takes
 * the learner's keystrokes (input() works). The run's error is underlined on its line.
 */

const vscode = require('vscode')
const net = require('net')
const os = require('os')
const path = require('path')
const { ghostAt, typedCount } = require('./ghost')
const { notebookView, cellAt } = require('./notebook-view')
const { isAiExtension } = require('./ai-block')

const SOCKET = path.join(os.homedir(), '.bettercoder', 'ide.sock')
const MAX_TEXT = 300000
const RETRY_MS = 3000
const PINK = '\x1b[38;2;241;162;171m'
const DIM = '\x1b[2m'
const RED = '\x1b[38;2;251;113;133m'
const RESET = '\x1b[0m'

let socket = null
let buffer = ''
let retry = null
let disposed = false
/** @type {{ stepId: string, file: string, line: number, title: string, ghost: string[], official: Array<{ method: string, docUrl: string } | null> } | null} */
let anchor = null
let doneSent = null
/** The last lines-typed count sent, as "stepId:n". */
let typedSent = null
let status
/** Which pseudocode line of the step they are on (lines typed so far), for the label's official line. */
let stepIndex = 0
/** The label above the step changes (another step, or they moved on a line). */
const lensChanged = new vscode.EventEmitter()
/** The official examples opened under a step, by their read-only document's address. */
const officialDocs = new Map()
const OFFICIAL_SCHEME = 'bettercoder-official'
let runProblems
/** The "▶ Run" terminal of the latest run: { id, file, done, terminal, write }. */
let runTerm = null
/** The "▶ Check" terminal of a step's Check (separate from ▶ Run). */
let checkTerm = null
const timers = new Map()
const decoder = new TextDecoder()

function debounce(key, ms, fn) {
  clearTimeout(timers.get(key))
  timers.set(key, setTimeout(fn, ms))
}

function ideName() {
  return vscode.env.appName || 'VS Code'
}

function send(message) {
  if (socket && !socket.destroyed && socket.writable) socket.write(JSON.stringify(message) + '\n')
}

// ── Where the learner is: a file, or a cell of a notebook ──

function notebookOfCell(doc) {
  for (const nb of vscode.workspace.notebookDocuments) {
    const index = nb.getCells().findIndex((c) => c.document === doc)
    if (index >= 0) return { nb, index }
  }
  return null
}

/** One output, nbformat-like (what notebook-view.js reads): an error, printed text, or a plain-text value. */
function outputOf(o) {
  const item = (mime) => o.items.find((i) => i.mime === mime)
  const err = item('application/vnd.code.notebook.error')
  if (err) {
    try {
      const e = JSON.parse(decoder.decode(err.data))
      return { output_type: 'error', ename: e.name, evalue: e.message }
    } catch {
      return null
    }
  }
  const streams = o.items.filter((i) => i.mime === 'application/vnd.code.notebook.stdout' || i.mime === 'application/vnd.code.notebook.stderr')
  if (streams.length) return { output_type: 'stream', text: streams.map((i) => decoder.decode(i.data)).join('') }
  const plain = item('text/plain')
  return plain ? { output_type: 'execute_result', data: { 'text/plain': decoder.decode(plain.data) } } : null
}

function cellsOf(nb) {
  return nb.getCells().map((c) => ({
    kind: c.kind === vscode.NotebookCellKind.Code ? 'code' : 'markdown',
    source: c.document.getText(),
    outputs: c.outputs.map(outputOf).filter(Boolean)
  }))
}

/**
 * Where the learner is: { file, line, col, doc?, nb?, view? }. In a notebook, `file` is the .ipynb and `line` is in
 * the coach's view of it. Null when they are not in a file of theirs.
 */
function activeSpot() {
  const ed = vscode.window.activeTextEditor
  if (ed && ed.document.uri.scheme === 'file') {
    const pos = ed.selection.active
    return { file: ed.document.uri.fsPath, line: pos.line + 1, col: pos.character + 1, doc: ed.document }
  }
  if (ed && ed.document.uri.scheme === 'vscode-notebook-cell') {
    const hit = notebookOfCell(ed.document)
    if (hit && hit.nb.uri.scheme === 'file') {
      const view = notebookView(cellsOf(hit.nb))
      const pos = ed.selection.active
      return { file: hit.nb.uri.fsPath, line: view.starts[hit.index] + pos.line, col: pos.character + 1, nb: hit.nb, view }
    }
  }
  const ned = vscode.window.activeNotebookEditor
  if (ned && ned.notebook.uri.scheme === 'file') {
    const view = notebookView(cellsOf(ned.notebook))
    const cell = ned.selection ? ned.selection.start : 0
    return { file: ned.notebook.uri.fsPath, line: view.starts[cell] || 1, col: 1, nb: ned.notebook, view }
  }
  return null
}

function sendHello() {
  send({ type: 'hello', ide: ideName(), folders: (vscode.workspace.workspaceFolders || []).map((f) => f.uri.fsPath) })
}

function sendEditor() {
  const s = activeSpot()
  if (!s) return send({ type: 'editor', file: null, line: 0, col: 0 })
  send({ type: 'editor', file: s.file, line: s.line, col: s.col })
}

function sendDoc() {
  const s = activeSpot()
  if (!s) return
  const text = s.nb ? s.view.lines.join('\n') : s.doc.getText()
  send({ type: 'doc', file: s.file, text: text.slice(0, MAX_TEXT) })
}

function diagItem(d, line) {
  const code = d.code === undefined || d.code === null ? undefined : typeof d.code === 'object' ? String(d.code.value) : String(d.code)
  return {
    line,
    col: d.range.start.character + 1,
    severity: d.severity === vscode.DiagnosticSeverity.Error ? 'error' : 'warning',
    ...(code ? { code: code.slice(0, 40) } : {}),
    message: d.message.slice(0, 400)
  }
}

const shown = (d) => d.severity <= vscode.DiagnosticSeverity.Warning

function sendDiagnostics() {
  const s = activeSpot()
  if (!s) return
  let items
  if (s.nb) {
    items = []
    s.nb.getCells().forEach((cell, i) => {
      for (const d of vscode.languages.getDiagnostics(cell.document.uri).filter(shown)) items.push(diagItem(d, s.view.starts[i] + d.range.start.line))
    })
  } else {
    items = vscode.languages.getDiagnostics(s.doc.uri).filter(shown).map((d) => diagItem(d, d.range.start.line + 1))
  }
  send({ type: 'diagnostics', file: s.file, items: items.slice(0, 20) })
}

function sendAll() {
  sendHello()
  sendEditor()
  sendDoc()
  sendDiagnostics()
}

// ── The link ──

function connect() {
  if (disposed) return
  clearTimeout(retry)
  const s = net.createConnection(SOCKET)
  socket = s
  buffer = ''
  s.setEncoding('utf8')
  s.on('connect', () => {
    status.text = '$(sparkle) BetterCoder'
    status.tooltip = 'BetterCoder is watching'
    sendAll()
  })
  s.on('data', (chunk) => {
    buffer += chunk
    let nl
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl)
      buffer = buffer.slice(nl + 1)
      try {
        receive(JSON.parse(line))
      } catch {
        // A bad line is ignored.
      }
    }
  })
  const lost = () => {
    if (socket !== s) return
    socket = null
    status.text = '$(circle-slash) BetterCoder'
    status.tooltip = 'BetterCoder app is not running'
    if (runTerm && !runTerm.done) finishRun(runTerm, `${RED}The BetterCoder app closed, so this run stopped.${RESET}`)
    if (!disposed) retry = setTimeout(connect, RETRY_MS)
  }
  s.on('error', lost)
  s.on('close', lost)
}

function receive(m) {
  if (!m || typeof m !== 'object') return
  if (m.type === 'anchor' && typeof m.file === 'string' && Number.isInteger(m.line) && Array.isArray(m.ghost)) {
    const isNew = !anchor || anchor.stepId !== m.stepId
    const official = Array.isArray(m.official) ? m.official.slice(0, 12).map(officialOf) : []
    anchor = { stepId: String(m.stepId), file: m.file, line: m.line, title: typeof m.title === 'string' ? m.title.slice(0, 80) : '', ghost: m.ghost.map(String).slice(0, 12), official }
    if (isNew) {
      doneSent = null
      stepIndex = 0
    }
    lensChanged.fire()
    render()
    if (isNew) offerToGo()
  } else if (m.type === 'clear') {
    anchor = null
    lensChanged.fire()
    render()
  } else if (m.type === 'official' && typeof m.term === 'string' && Array.isArray(m.lines)) {
    void showOfficial(m)
  } else if (m.type === 'status' && typeof m.text === 'string') {
    status.text = '$(sparkle) ' + m.text.slice(0, 80)
    status.tooltip = typeof m.tooltip === 'string' ? m.tooltip.slice(0, 200) : ''
  } else if (m.type === 'term' && m.event && typeof m.event === 'object') {
    onTerm(m.event)
  } else if (m.type === 'check_run' && typeof m.runId === 'string' && typeof m.file === 'string') {
    showCheckRun(m)
  } else if (m.type === 'run_error' && typeof m.message === 'string') {
    const install = m.install && typeof m.install.url === 'string' && /^https:\/\//.test(m.install.url) ? m.install : null
    if (runTerm && !runTerm.id && !runTerm.done) finishRun(runTerm, `${RED}${m.message}${RESET}${install ? `\r\n${DIM}Get it: ${install.url}${RESET}` : ''}`)
    if (install) {
      void vscode.window.showWarningMessage(`BetterCoder: ${m.message}`, 'Official install page').then((pick) => {
        if (pick) void vscode.env.openExternal(vscode.Uri.parse(install.url))
      })
    } else if (!runTerm || runTerm.id) void vscode.window.showErrorMessage(`BetterCoder: ${m.message}`)
  } else if (m.type === 'open' && typeof m.file === 'string') {
    void openAt(m.file, Number.isInteger(m.line) ? m.line : null)
  } else if (m.type === 'problems' && typeof m.file === 'string' && Array.isArray(m.items)) {
    showRunProblems(m.file, m.items)
  }
}

function samePath(a, b) {
  return path.resolve(a) === path.resolve(b)
}

// ── The step marker ──

/** The step is in a file they don't have in front of them: offer to go there (never move them without asking). */
function offerToGo() {
  if (!anchor || !vscode.window.state.focused) return
  const s = activeSpot()
  if (s && samePath(s.file, anchor.file)) return
  const where = /\.ipynb$/i.test(anchor.file) ? path.basename(anchor.file) : `${path.basename(anchor.file)} line ${anchor.line}`
  void vscode.window.showInformationMessage(`BetterCoder: the next step goes in ${where}`, 'Go there').then((pick) => {
    if (pick) void goToStep()
  })
}

async function goToStep() {
  if (anchor) await openAt(anchor.file, anchor.line)
}

/** Show a file at a line (1-based; in a notebook, a line of the coach's view, so it lands on the right cell). */
async function openAt(file, lineNo) {
  const uri = vscode.Uri.file(file)
  if (/\.ipynb$/i.test(file)) {
    const nb = await vscode.workspace.openNotebookDocument(uri)
    const at = (lineNo && cellAt(notebookView(cellsOf(nb)), lineNo)) || { cell: 0, line: 0 }
    const range = new vscode.NotebookRange(at.cell, at.cell + 1)
    const ned = await vscode.window.showNotebookDocument(nb, { selections: [range] })
    ned.revealRange(range, vscode.NotebookEditorRevealType.InCenterIfOutsideViewport)
    await vscode.commands.executeCommand('notebook.cell.edit')
    return
  }
  const doc = await vscode.workspace.openTextDocument(uri)
  const ed = await vscode.window.showTextDocument(doc)
  const line = Math.max(0, Math.min((lineNo || 1) - 1, doc.lineCount - 1))
  const pos = new vscode.Position(line, doc.lineAt(line).firstNonWhitespaceCharacterIndex)
  ed.selection = new vscode.Selection(pos, pos)
  ed.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenterIfOutsideViewport)
}

/** The marked line (0-based) in this editor, or -1 when the step is not in it. */
function markedLine(ed, views) {
  if (!anchor) return -1
  const uri = ed.document.uri
  if (uri.scheme === 'file') return samePath(uri.fsPath, anchor.file) ? anchor.line - 1 : -1
  if (uri.scheme !== 'vscode-notebook-cell') return -1
  const hit = notebookOfCell(ed.document)
  if (!hit || !samePath(hit.nb.uri.fsPath, anchor.file)) return -1
  if (!views.has(hit.nb)) views.set(hit.nb, notebookView(cellsOf(hit.nb)))
  const at = cellAt(views.get(hit.nb), anchor.line)
  return at && at.cell === hit.index ? at.line : -1
}

/**
 * Follow how far they are in the step (nothing is drawn in their text): lines typed, the step done, and which
 * pseudocode line the label's official line is for.
 */
function render() {
  const views = new Map()
  for (const ed of vscode.window.visibleTextEditors) {
    const marked = markedLine(ed, views)
    if (marked < 0 || ed !== vscode.window.activeTextEditor) continue
    const doc = ed.document
    const a = Math.min(Math.max(0, marked), doc.lineCount - 1)
    const lines = []
    for (let i = 0; i < doc.lineCount; i++) lines.push(doc.lineAt(i).text)
    const at = ghostAt(lines, a, ed.selection.active.line, anchor.ghost)
    const n = typedCount(lines, a, ed.selection.active.line, anchor.ghost.length)
    const index = Math.min(n, Math.max(0, anchor.ghost.length - 1))
    if (index !== stepIndex) {
      stepIndex = index
      lensChanged.fire()
    }
    const key = `${anchor.stepId}:${n}`
    if (key !== typedSent) {
      typedSent = key
      send({ type: 'step_typed', stepId: anchor.stepId, n })
    }
    if (at.done && doneSent !== anchor.stepId && ed === vscode.window.activeTextEditor) {
      doneSent = anchor.stepId
      send({ type: 'step_done', stepId: anchor.stepId })
    }
  }
}

// ── The label above the step, and its official line ──

function officialOf(o) {
  return o && typeof o.method === 'string' && typeof o.docUrl === 'string' && /^https:\/\//.test(o.docUrl) ? { method: o.method.slice(0, 100), docUrl: o.docUrl } : null
}

/** The official line for the pseudocode line they are on, else the next one that has one, else any. */
function currentOfficial() {
  if (!anchor) return null
  const list = anchor.official
  for (let i = stepIndex; i < list.length; i++) if (list[i]) return list[i]
  return list.find(Boolean) || null
}

/** "◆ Read the second number · See the official line (Console.ReadLine)", above the line where the step goes. */
const lensProvider = {
  onDidChangeCodeLenses: lensChanged.event,
  provideCodeLenses(doc) {
    if (!anchor) return []
    const ed = vscode.window.visibleTextEditors.find((e) => e.document === doc)
    const marked = ed ? markedLine(ed, new Map()) : doc.uri.scheme === 'file' && samePath(doc.uri.fsPath, anchor.file) ? anchor.line - 1 : -1
    if (marked < 0) return []
    const line = Math.min(Math.max(0, marked), doc.lineCount - 1)
    const range = new vscode.Range(line, 0, line, 0)
    const lenses = [new vscode.CodeLens(range, { title: `◆ ${anchor.title || 'Your next step goes here'}`, command: '' })]
    const o = currentOfficial()
    if (o) lenses.push(new vscode.CodeLens(range, { title: `See the official line (${o.method})`, command: 'bettercoder.seeOfficial', arguments: [o] }))
    return lenses
  }
}

/** The read-only documents the official examples open in. */
const officialContent = {
  provideTextDocumentContent(uri) {
    return officialDocs.get(uri.toString()) || ''
  }
}

let officialAsked = null

/** Ask the app for the official example (it fetches it from the official docs; nothing comes from the coach). */
function seeOfficial(o) {
  if (!o) return
  if (!socket) return vscode.window.showWarningMessage('BetterCoder: the app is not connected.')
  officialAsked = o
  send({ type: 'official', url: o.docUrl, term: o.method })
}

/** Open the official example inline under the step's line, its line lit. Read-only: it can't be typed into. */
async function showOfficial(m) {
  const asked = officialAsked
  officialAsked = null
  if (!anchor || !asked || asked.method !== m.term) return
  const url = typeof m.url === 'string' && /^https:\/\//.test(m.url) ? m.url : asked.docUrl
  if (m.lines.length === 0) {
    const pick = await vscode.window.showInformationMessage(`BetterCoder: that page has no example of ${m.term} to show.`, 'Open the docs')
    if (pick) void vscode.env.openExternal(vscode.Uri.parse(url))
    return
  }
  let host = 'docs'
  try {
    host = new URL(url).host
  } catch {}
  const ext = path.extname(anchor.file) || '.txt'
  const safe = m.term.replace(/[^\w.-]+/g, '_').slice(0, 60)
  const uri = vscode.Uri.from({ scheme: OFFICIAL_SCHEME, path: `/${host}/${safe}${ext === '.ipynb' ? '.py' : ext}` })
  const text = m.lines.map(String).slice(0, 200).join('\n')
  officialDocs.set(uri.toString(), text)
  const ed = vscode.window.activeTextEditor
  if (!ed || markedLine(ed, new Map()) < 0) await goToStep()
  const here = vscode.window.activeTextEditor
  if (!here) return
  const marked = Math.max(0, markedLine(here, new Map()))
  const focus = Number.isInteger(m.focus) && m.focus >= 0 && m.focus < m.lines.length ? m.focus : 0
  const lit = new vscode.Range(focus, 0, focus, String(m.lines[focus]).length)
  await vscode.commands.executeCommand('editor.action.peekLocations', here.document.uri, new vscode.Position(marked, 0), [new vscode.Location(uri, lit)], 'peek')
}

// ── ▶ Run ──

/** ▶ Run: the file in the title bar (or the open one). A notebook runs all its cells in its own kernel instead. */
async function runFile(uri) {
  const s = activeSpot()
  const file = uri && uri.scheme === 'file' ? uri.fsPath : s ? s.file : null
  if (!file) return
  if (/\.ipynb$/i.test(file)) return vscode.commands.executeCommand('notebook.execute')
  if (!socket) return vscode.window.showWarningMessage('BetterCoder: the app is not connected, so Run is not available.')
  const doc = vscode.workspace.textDocuments.find((d) => d.uri.scheme === 'file' && samePath(d.uri.fsPath, file))
  if (doc && doc.isDirty) await doc.save()

  if (runTerm) runTerm.terminal.dispose()
  const write = new vscode.EventEmitter()
  const state = { id: null, file, done: false, terminal: null, write }
  const live = () => state.id && !state.done
  const pty = {
    onDidWrite: write.event,
    open: (dims) => {
      write.fire(`${DIM}▶ ${path.basename(file)}${RESET}\r\n`)
      send({ type: 'run', file, cols: (dims && dims.columns) || 80, rows: (dims && dims.rows) || 24 })
    },
    close: () => {
      if (live()) send({ type: 'term_stop', id: state.id })
      if (runTerm === state) runTerm = null
    },
    handleInput: (data) => {
      if (live()) send({ type: 'term_input', id: state.id, data })
    },
    setDimensions: (d) => {
      if (live()) send({ type: 'term_resize', id: state.id, cols: d.columns, rows: d.rows })
    }
  }
  state.terminal = vscode.window.createTerminal({ name: '▶ Run', pty, iconPath: new vscode.ThemeIcon('play') })
  runTerm = state
  state.terminal.show(false)
}

/**
 * A step's Check runs their file in the app with the check's inputs typed in: shown in one "▶ Check" terminal (each
 * check under its own heading), read-only (the app types the inputs, nothing they type goes in).
 */
function showCheckRun(m) {
  const label = typeof m.label === 'string' ? m.label.slice(0, 60) : 'Check'
  const heading = `${PINK}◆ ${label}${RESET} ${DIM}${path.basename(m.file)}${RESET}\r\n`
  // Its own terminal, beside theirs: a program they are running in ▶ Run keeps its terminal.
  if (checkTerm) {
    checkTerm.id = m.runId
    checkTerm.done = false
    checkTerm.write.fire(`\r\n${heading}`)
    checkTerm.terminal.show(true)
    return
  }
  const write = new vscode.EventEmitter()
  const state = { id: m.runId, file: m.file, done: false, terminal: null, write, check: true }
  const pty = {
    onDidWrite: write.event,
    open: () => write.fire(heading),
    close: () => {
      if (checkTerm === state) checkTerm = null
    },
    handleInput: () => {}
  }
  state.terminal = vscode.window.createTerminal({ name: '▶ Check', pty, iconPath: new vscode.ThemeIcon('pass') })
  checkTerm = state
  state.terminal.show(true)
}

function finishRun(state, line) {
  state.done = true
  if (line) state.write.fire(`\r\n${line}\r\n`)
}

function onTerm(e) {
  for (const t of [runTerm, checkTerm]) if (t) onTermFor(t, e)
}

function onTermFor(t, e) {
  if (e.type === 'run' && e.run && typeof e.run.id === 'string') {
    if (!t.id && e.run.endedAt === null) t.id = e.run.id
    if (e.run.id !== t.id || e.run.endedAt === null || t.done) return
    const lines = []
    if (typeof e.run.words === 'string' && e.run.words) lines.push(`${PINK}In words:${RESET} ${e.run.words}`)
    lines.push(`${DIM}${e.run.stopped ? 'Stopped' : `Finished · exit ${e.run.exitCode}`}${RESET}`)
    finishRun(t, lines.join('\r\n'))
  } else if (e.type === 'data' && e.id === t.id && typeof e.data === 'string') {
    t.write.fire(e.data)
  }
}

function showRunProblems(file, items) {
  const uri = vscode.Uri.file(file)
  if (items.length === 0) return runProblems.delete(uri)
  runProblems.clear()
  runProblems.set(
    uri,
    items.map((i) => {
      const line = Math.max(0, (i.line || 1) - 1)
      const d = new vscode.Diagnostic(new vscode.Range(line, Math.max(0, (i.col || 1) - 1), line, 10000), String(i.message), vscode.DiagnosticSeverity.Error)
      d.source = 'BetterCoder ▶ Run'
      return d
    })
  )
}

// ── Inside BetterCoder only: no AI, nothing typed in for them ──

/** Set by BetterCoder when it starts its own VS Code. In the learner's own VS Code, this extension only links. */
const EMBEDDED = process.env.BETTERCODER_EMBEDDED === '1'

/** Settings that stay as BetterCoder sets them (the app puts them back on every start too). */
const LOCKED = {
  'chat.disableAIFeatures': true,
  'editor.inlineSuggest.enabled': false,
  'editor.inlayHints.enabled': 'off',
  'editor.snippetSuggestions': 'none',
  'editor.suggest.showSnippets': false,
  'editor.tabCompletion': 'off'
}
const removing = new Set()

/** An AI extension was installed (from the Extensions view): it is removed at once. */
async function removeAiExtensions() {
  for (const ext of vscode.extensions.all) {
    const pj = ext.packageJSON || {}
    if (pj.isBuiltin || removing.has(ext.id) || !isAiExtension(ext.id, pj)) continue
    removing.add(ext.id)
    try {
      await vscode.commands.executeCommand('workbench.extensions.uninstallExtension', ext.id)
      void vscode.window.showInformationMessage(`BetterCoder removed ${pj.displayName || ext.id}: it writes code for you. Here, you write it.`)
    } catch {
      removing.delete(ext.id)
    }
  }
}

/** One of the locked settings was changed: it goes back. */
async function keepLocked(e) {
  for (const [key, want] of Object.entries(LOCKED)) {
    if (e && !e.affectsConfiguration(key)) continue
    const dot = key.lastIndexOf('.')
    const config = vscode.workspace.getConfiguration(key.slice(0, dot))
    const name = key.slice(dot + 1)
    const now = config.inspect(name)
    const wrong = [now?.globalValue, now?.workspaceValue, now?.workspaceFolderValue].some((v) => v !== undefined && v !== want)
    if (!wrong) continue
    await config.update(name, want, vscode.ConfigurationTarget.Global)
    if (now?.workspaceValue !== undefined) await config.update(name, undefined, vscode.ConfigurationTarget.Workspace)
    if (e) void vscode.window.showInformationMessage('BetterCoder keeps that off: here, you write the code.')
  }
}

// ── Start ──

function activate(context) {
  status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
  status.text = '$(circle-slash) BetterCoder'
  status.command = 'bettercoder.goToStep'
  status.show()
  runProblems = vscode.languages.createDiagnosticCollection('bettercoder-run')

  const activeDoc = () => {
    const ed = vscode.window.activeTextEditor
    return ed ? ed.document : null
  }

  context.subscriptions.push(
    status,
    runProblems,
    lensChanged,
    vscode.languages.registerCodeLensProvider([{ scheme: 'file' }, { scheme: 'vscode-notebook-cell' }], lensProvider),
    vscode.workspace.registerTextDocumentContentProvider(OFFICIAL_SCHEME, officialContent),
    vscode.commands.registerCommand('bettercoder.seeOfficial', (o) => seeOfficial(o || currentOfficial())),
    vscode.commands.registerCommand('bettercoder.reconnect', () => {
      socket?.destroy()
      connect()
    }),
    vscode.commands.registerCommand('bettercoder.goToStep', () => goToStep()),
    vscode.commands.registerCommand('bettercoder.run', (uri) => runFile(uri)),
    vscode.window.onDidChangeActiveTextEditor(() => {
      sendEditor()
      sendDoc()
      sendDiagnostics()
      render()
    }),
    vscode.window.onDidChangeActiveNotebookEditor(() => {
      sendEditor()
      sendDoc()
      sendDiagnostics()
      render()
    }),
    vscode.window.onDidChangeVisibleTextEditors(() => render()),
    vscode.window.onDidChangeTextEditorSelection(() => {
      render()
      debounce('editor', 150, sendEditor)
    }),
    vscode.workspace.onDidChangeTextDocument((e) => {
      const doc = activeDoc()
      if (!doc || e.document !== doc) return
      render()
      debounce('doc', 500, sendDoc)
    }),
    // A notebook's cells or outputs changed (a cell ran, was added or moved): its view and the marker move with it.
    vscode.workspace.onDidChangeNotebookDocument((e) => {
      const s = activeSpot()
      if (!s || !s.nb || e.notebook !== s.nb) return
      render()
      debounce('doc', 500, sendDoc)
    }),
    vscode.languages.onDidChangeDiagnostics(() => debounce('diag', 300, sendDiagnostics)),
    vscode.workspace.onDidChangeWorkspaceFolders(() => sendHello()),
    // The window in front is the one BetterCoder follows.
    vscode.window.onDidChangeWindowState((s) => {
      if (s.focused) sendEditor()
    })
  )
  if (EMBEDDED) {
    context.subscriptions.push(
      vscode.extensions.onDidChange(() => void removeAiExtensions()),
      vscode.workspace.onDidChangeConfiguration((e) => void keepLocked(e))
    )
    void removeAiExtensions()
    void keepLocked(null)
    connect()
  }
  // In someone's own VS Code (an old dev install), it stays quiet: BetterCoder only follows its built-in VS Code.
}

function deactivate() {
  disposed = true
  clearTimeout(retry)
  for (const t of timers.values()) clearTimeout(t)
  socket?.destroy()
}

module.exports = { activate, deactivate }
