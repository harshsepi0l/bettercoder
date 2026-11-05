'use strict'

/**
 * BetterCoder for VS Code (and Cursor, Windsurf, VSCodium).
 *
 * Tells the BetterCoder app which file is open, where the cursor is, the text and the problems. Shows what the app
 * sends back: a marker on the line where the step goes, the step's pseudocode faded beside the cursor, one line at a
 * time, and a status line. Decorations only: nothing is ever written into the learner's files, and Tab never
 * accepts anything.
 */

const vscode = require('vscode')
const net = require('net')
const os = require('os')
const path = require('path')
const { ghostAt } = require('./ghost')

const SOCKET = path.join(os.homedir(), '.bettercoder', 'ide.sock')
const MAX_TEXT = 300000
const RETRY_MS = 3000

let socket = null
let buffer = ''
let retry = null
let disposed = false
/** @type {{ stepId: string, file: string, line: number, ghost: string[] } | null} */
let anchor = null
let doneSent = null
let status
let markerType
let ghostType
const timers = new Map()

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

function fileEditor() {
  const ed = vscode.window.activeTextEditor
  return ed && ed.document.uri.scheme === 'file' ? ed : null
}

function sendHello() {
  send({ type: 'hello', ide: ideName(), folders: (vscode.workspace.workspaceFolders || []).map((f) => f.uri.fsPath) })
}

function sendEditor() {
  const ed = fileEditor()
  if (!ed) return send({ type: 'editor', file: null, line: 0, col: 0 })
  const pos = ed.selection.active
  send({ type: 'editor', file: ed.document.uri.fsPath, line: pos.line + 1, col: pos.character + 1 })
}

function sendDoc() {
  const ed = fileEditor()
  if (!ed) return
  send({ type: 'doc', file: ed.document.uri.fsPath, text: ed.document.getText().slice(0, MAX_TEXT) })
}

function sendDiagnostics() {
  const ed = fileEditor()
  if (!ed) return
  const items = vscode.languages
    .getDiagnostics(ed.document.uri)
    .filter((d) => d.severity <= vscode.DiagnosticSeverity.Warning)
    .slice(0, 20)
    .map((d) => {
      const code = d.code === undefined || d.code === null ? undefined : typeof d.code === 'object' ? String(d.code.value) : String(d.code)
      return {
        line: d.range.start.line + 1,
        col: d.range.start.character + 1,
        severity: d.severity === vscode.DiagnosticSeverity.Error ? 'error' : 'warning',
        ...(code ? { code: code.slice(0, 40) } : {}),
        message: d.message.slice(0, 400)
      }
    })
  send({ type: 'diagnostics', file: ed.document.uri.fsPath, items })
}

function sendAll() {
  sendHello()
  sendEditor()
  sendDoc()
  sendDiagnostics()
}

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
    if (!disposed) retry = setTimeout(connect, RETRY_MS)
  }
  s.on('error', lost)
  s.on('close', lost)
}

function receive(m) {
  if (!m || typeof m !== 'object') return
  if (m.type === 'anchor' && typeof m.file === 'string' && Number.isInteger(m.line) && Array.isArray(m.ghost)) {
    const isNew = !anchor || anchor.stepId !== m.stepId
    anchor = { stepId: String(m.stepId), file: m.file, line: m.line, ghost: m.ghost.map(String).slice(0, 12) }
    if (isNew) doneSent = null
    render()
    if (isNew) offerToGo()
  } else if (m.type === 'clear') {
    anchor = null
    render()
  } else if (m.type === 'status' && typeof m.text === 'string') {
    status.text = '$(sparkle) ' + m.text.slice(0, 80)
    status.tooltip = typeof m.tooltip === 'string' ? m.tooltip.slice(0, 200) : ''
  }
}

function samePath(a, b) {
  return path.resolve(a) === path.resolve(b)
}

/** The step is in a file they don't have in front of them: offer to go there (never move them without asking). */
function offerToGo() {
  if (!anchor || !vscode.window.state.focused) return
  const ed = fileEditor()
  if (ed && samePath(ed.document.uri.fsPath, anchor.file)) return
  const where = `${path.basename(anchor.file)} line ${anchor.line}`
  void vscode.window.showInformationMessage(`BetterCoder: the next step goes in ${where}`, 'Go there').then((pick) => {
    if (pick) void goToStep()
  })
}

async function goToStep() {
  if (!anchor) return
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(anchor.file))
  const ed = await vscode.window.showTextDocument(doc)
  const line = Math.min(anchor.line - 1, doc.lineCount - 1)
  const pos = new vscode.Position(line, doc.lineAt(line).firstNonWhitespaceCharacterIndex)
  ed.selection = new vscode.Selection(pos, pos)
  ed.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenterIfOutsideViewport)
}

function render() {
  for (const ed of vscode.window.visibleTextEditors) {
    if (!anchor || ed.document.uri.scheme !== 'file' || !samePath(ed.document.uri.fsPath, anchor.file)) {
      ed.setDecorations(markerType, [])
      ed.setDecorations(ghostType, [])
      continue
    }
    const doc = ed.document
    const a = Math.min(Math.max(0, anchor.line - 1), doc.lineCount - 1)
    ed.setDecorations(markerType, [new vscode.Range(a, 0, a, 0)])
    const lines = []
    for (let i = 0; i < doc.lineCount; i++) lines.push(doc.lineAt(i).text)
    const at = ghostAt(lines, a, ed.selection.active.line, anchor.ghost)
    if (at.ghost) {
      const end = doc.lineAt(at.ghost.line).range.end
      ed.setDecorations(ghostType, [
        {
          range: new vscode.Range(end, end),
          renderOptions: { after: { contentText: '◆ ' + at.ghost.text } }
        }
      ])
    } else {
      ed.setDecorations(ghostType, [])
    }
    if (at.done && doneSent !== anchor.stepId && ed === vscode.window.activeTextEditor) {
      doneSent = anchor.stepId
      send({ type: 'step_done', stepId: anchor.stepId })
    }
  }
}

function activate(context) {
  status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
  status.text = '$(circle-slash) BetterCoder'
  status.command = 'bettercoder.goToStep'
  status.show()
  markerType = vscode.window.createTextEditorDecorationType({
    gutterIconPath: context.asAbsolutePath(path.join('media', 'marker.svg')),
    gutterIconSize: 'contain',
    isWholeLine: true,
    backgroundColor: 'rgba(192, 57, 75, 0.10)',
    overviewRulerColor: '#C0394B',
    overviewRulerLane: vscode.OverviewRulerLane.Left
  })
  ghostType = vscode.window.createTextEditorDecorationType({
    after: { color: '#C98A92', fontStyle: 'italic', margin: '0 0 0 2em' }
  })

  context.subscriptions.push(
    status,
    markerType,
    ghostType,
    vscode.commands.registerCommand('bettercoder.reconnect', () => {
      socket?.destroy()
      connect()
    }),
    vscode.commands.registerCommand('bettercoder.goToStep', () => goToStep()),
    vscode.window.onDidChangeActiveTextEditor(() => {
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
      const ed = fileEditor()
      if (!ed || e.document !== ed.document) return
      render()
      debounce('doc', 500, sendDoc)
    }),
    vscode.languages.onDidChangeDiagnostics((e) => {
      const ed = fileEditor()
      if (ed && e.uris.some((u) => u.toString() === ed.document.uri.toString())) debounce('diag', 300, sendDiagnostics)
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => sendHello()),
    // The window in front is the one BetterCoder follows.
    vscode.window.onDidChangeWindowState((s) => {
      if (s.focused) sendEditor()
    })
  )
  connect()
}

function deactivate() {
  disposed = true
  clearTimeout(retry)
  for (const t of timers.values()) clearTimeout(t)
  socket?.destroy()
}

module.exports = { activate, deactivate }
