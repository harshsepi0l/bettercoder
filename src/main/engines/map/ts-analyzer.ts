import ts from 'ts5'
import type { MapMember, MapNodeKind } from '../../../shared/map'

/**
 * TypeScript / JavaScript read with the TypeScript compiler's parser (syntax
 * only, nothing runs). Gives exact declarations, members, heritage, imports
 * and where each name is referenced, so arrows can be backed by evidence.
 */

export interface Ref {
  name: string
  line: number
  /** For `ns.Name`: the namespace/module part. */
  qualifier?: string
}

export interface TsDecl {
  name: string
  kind: MapNodeKind
  line: number
  fields: MapMember[]
  methods: MapMember[]
  extends: Ref[]
  implements: Ref[]
  refs: Ref[]
}

export interface TsImport {
  /** Name used in this file. */
  local: string
  /** Name exported by the other module ("default" or "*" for namespace imports). */
  imported: string
  from: string
  line: number
}

export interface TsFile {
  decls: TsDecl[]
  functions: Array<MapMember & { refs: Ref[] }>
  imports: TsImport[]
}

const STUB = /\b(TODO|FIXME)\b|not implemented|NotImplemented/i

function lineOf(sf: ts.SourceFile, node: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
}

function visibility(node: ts.Node): MapMember['visibility'] {
  const mods = ts.canHaveModifiers(node) ? (ts.getModifiers(node) ?? []) : []
  if (mods.some((m) => m.kind === ts.SyntaxKind.PrivateKeyword)) return 'private'
  if (mods.some((m) => m.kind === ts.SyntaxKind.ProtectedKeyword)) return 'protected'
  const name = (node as { name?: ts.Node }).name
  if (name && ts.isPrivateIdentifier(name)) return 'private'
  return 'public'
}

function isStatic(node: ts.Node): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.StaticKeyword)
}

function params(sf: ts.SourceFile, list: ts.NodeArray<ts.ParameterDeclaration>): string {
  return `(${list.map((p) => p.name.getText(sf)).join(', ')})`
}

/** Every name referenced inside a node: identifiers, type names, and `ns.Name` pairs. */
function collectRefs(sf: ts.SourceFile, root: ts.Node, own: string): Ref[] {
  const out: Ref[] = []
  const seen = new Set<string>()
  const add = (name: string, node: ts.Node, qualifier?: string) => {
    const key = `${qualifier ?? ''}.${name}`
    if (name === own || seen.has(key)) return
    seen.add(key)
    out.push({ name, line: lineOf(sf, node), ...(qualifier ? { qualifier } : {}) })
  }
  const visit = (n: ts.Node) => {
    if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression)) add(n.name.text, n, n.expression.text)
    else if (ts.isQualifiedName(n) && ts.isIdentifier(n.left)) add(n.right.text, n, n.left.text)
    else if (ts.isIdentifier(n)) {
      // Skip the declared names themselves (parameters, properties being declared).
      const p = n.parent
      const declaring =
        (ts.isParameter(p) || ts.isPropertyDeclaration(p) || ts.isPropertySignature(p) || ts.isMethodDeclaration(p) || ts.isVariableDeclaration(p) || ts.isPropertyAssignment(p)) &&
        (p as { name?: ts.Node }).name === n
      if (!declaring && !(ts.isPropertyAccessExpression(p) && p.name === n)) add(n.text, n)
    }
    ts.forEachChild(n, visit)
  }
  ts.forEachChild(root, visit)
  return out
}

function heritage(sf: ts.SourceFile, clauses: ts.NodeArray<ts.HeritageClause> | undefined, token: ts.SyntaxKind): Ref[] {
  const out: Ref[] = []
  for (const c of clauses ?? []) {
    if (c.token !== token) continue
    for (const t of c.types) {
      const e = t.expression
      if (ts.isIdentifier(e)) out.push({ name: e.text, line: lineOf(sf, t) })
      else if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression)) out.push({ name: e.name.text, qualifier: e.expression.text, line: lineOf(sf, t) })
    }
  }
  return out
}

function stubText(sf: ts.SourceFile, node: ts.Node): boolean {
  const body = (node as { body?: ts.Node }).body
  return !!body && STUB.test(body.getFullText(sf))
}

export function analyzeTs(path: string, source: string): TsFile {
  const kind = /\.tsx$/i.test(path) ? ts.ScriptKind.TSX : /\.jsx$/i.test(path) ? ts.ScriptKind.JSX : /\.m?js$/i.test(path) ? ts.ScriptKind.JS : ts.ScriptKind.TS
  const sf = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, kind)
  const decls: TsDecl[] = []
  const functions: TsFile['functions'] = []
  const imports: TsImport[] = []

  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier)) {
      const from = st.moduleSpecifier.text
      const clause = st.importClause
      const line = lineOf(sf, st)
      if (clause?.name) imports.push({ local: clause.name.text, imported: 'default', from, line })
      const nb = clause?.namedBindings
      if (nb && ts.isNamespaceImport(nb)) imports.push({ local: nb.name.text, imported: '*', from, line })
      if (nb && ts.isNamedImports(nb)) for (const el of nb.elements) imports.push({ local: el.name.text, imported: (el.propertyName ?? el.name).text, from, line })
      continue
    }
    if (ts.isClassDeclaration(st) && st.name) {
      const abstract = (ts.getModifiers(st) ?? []).some((m) => m.kind === ts.SyntaxKind.AbstractKeyword)
      const fields: MapMember[] = []
      const methods: MapMember[] = []
      for (const m of st.members) {
        const name = m.name && (ts.isIdentifier(m.name) || ts.isPrivateIdentifier(m.name) || ts.isStringLiteral(m.name)) ? m.name.text : undefined
        if (ts.isPropertyDeclaration(m) && name) {
          fields.push({ name, detail: m.type?.getText(sf) ?? '', line: lineOf(sf, m), visibility: visibility(m), isStatic: isStatic(m) })
        } else if ((ts.isMethodDeclaration(m) || ts.isGetAccessor(m) || ts.isSetAccessor(m)) && name) {
          methods.push({ name, detail: params(sf, m.parameters), line: lineOf(sf, m), visibility: visibility(m), isStatic: isStatic(m), stub: stubText(sf, m) })
        } else if (ts.isConstructorDeclaration(m)) {
          methods.push({ name: 'constructor', detail: params(sf, m.parameters), line: lineOf(sf, m), visibility: visibility(m) })
          for (const p of m.parameters) {
            // Parameter properties (constructor(private repo: Repo)) are fields.
            if (ts.canHaveModifiers(p) && (ts.getModifiers(p) ?? []).length && ts.isIdentifier(p.name)) {
              fields.push({ name: p.name.text, detail: p.type?.getText(sf) ?? '', line: lineOf(sf, p), visibility: visibility(p) })
            }
          }
        }
      }
      decls.push({
        name: st.name.text,
        kind: abstract ? 'abstract' : 'class',
        line: lineOf(sf, st),
        fields,
        methods,
        extends: heritage(sf, st.heritageClauses, ts.SyntaxKind.ExtendsKeyword),
        implements: heritage(sf, st.heritageClauses, ts.SyntaxKind.ImplementsKeyword),
        refs: collectRefs(sf, st, st.name.text)
      })
    } else if (ts.isInterfaceDeclaration(st)) {
      const fields: MapMember[] = []
      const methods: MapMember[] = []
      for (const m of st.members) {
        const name = m.name && (ts.isIdentifier(m.name) || ts.isStringLiteral(m.name)) ? m.name.text : undefined
        if (!name) continue
        if (ts.isMethodSignature(m)) methods.push({ name, detail: params(sf, m.parameters), line: lineOf(sf, m) })
        else if (ts.isPropertySignature(m)) fields.push({ name, detail: m.type?.getText(sf) ?? '', line: lineOf(sf, m) })
      }
      decls.push({
        name: st.name.text,
        kind: 'interface',
        line: lineOf(sf, st),
        fields,
        methods,
        extends: [],
        implements: heritage(sf, st.heritageClauses, ts.SyntaxKind.ExtendsKeyword),
        refs: collectRefs(sf, st, st.name.text)
      })
    } else if (ts.isEnumDeclaration(st)) {
      decls.push({
        name: st.name.text,
        kind: 'enum',
        line: lineOf(sf, st),
        fields: st.members.map((m) => ({ name: m.name.getText(sf), detail: '', line: lineOf(sf, m) })),
        methods: [],
        extends: [],
        implements: [],
        refs: []
      })
    } else if (ts.isTypeAliasDeclaration(st) && ts.isTypeLiteralNode(st.type)) {
      decls.push({
        name: st.name.text,
        kind: 'type',
        line: lineOf(sf, st),
        fields: st.type.members.filter(ts.isPropertySignature).map((m) => ({ name: m.name.getText(sf), detail: m.type?.getText(sf) ?? '', line: lineOf(sf, m) })),
        methods: [],
        extends: [],
        implements: [],
        refs: collectRefs(sf, st, st.name.text)
      })
    } else if (ts.isFunctionDeclaration(st) && st.name) {
      functions.push({ name: st.name.text, detail: params(sf, st.parameters), line: lineOf(sf, st), stub: stubText(sf, st), refs: collectRefs(sf, st, st.name.text) })
    } else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        const init = d.initializer
        if (ts.isIdentifier(d.name) && init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
          functions.push({ name: d.name.text, detail: params(sf, init.parameters), line: lineOf(sf, d), stub: stubText(sf, init), refs: collectRefs(sf, init, d.name.text) })
        }
      }
    } else if (ts.isExportAssignment(st) || ts.isExpressionStatement(st)) {
      // export default ..., top-level calls: not boxes.
    }
  }
  return { decls, functions, imports }
}
