/**
 * The project map: a class diagram of the learner's code, BlueJ/Eclipse style.
 * Built by reading the code (never running it); no model involved.
 */

export const MAP_IPC = {
  build: 'map:build',
  stackDocs: 'sources:stack-docs',
  docExample: 'sources:doc-example'
} as const

export type MapNodeKind = 'class' | 'abstract' | 'interface' | 'type' | 'enum' | 'struct' | 'module'

export interface MapMember {
  name: string
  /** "(self, number)" for methods; a type or "" for fields. */
  detail: string
  line: number
  /** Unfinished: pass / ... / NotImplementedError / TODO only. */
  stub?: boolean
  visibility?: 'public' | 'private' | 'protected'
  isStatic?: boolean
}

export interface MapNode {
  id: string
  kind: MapNodeKind
  name: string
  /** File relative to the project root. */
  file: string
  line: number
  fields: MapMember[]
  methods: MapMember[]
  /** What it extends that is not in the project (e.g. BaseModel, React.Component). */
  externalBases?: string[]
}

/** Why an arrow exists: the line in the source file that made it. */
export interface EdgeEvidence {
  file: string
  line: number
  note: string
}

export interface MapEdge {
  from: string
  to: string
  kind: 'extends' | 'implements' | 'uses'
  evidence: EdgeEvidence[]
}

export interface CodeMap {
  nodes: MapNode[]
  edges: MapEdge[]
  /** Libraries the code imports (top-level names), for the Sources tab. */
  libraries: string[]
  languages: string[]
  /** Set when the project is too big to map fully. */
  truncated?: string
  /** Files that could not be read (for example, syntax errors). */
  skipped: Array<{ file: string; reason: string }>
}

export interface DocLink {
  title: string
  url: string
  /** Why it is listed: "you import numpy", "Python". */
  reason: string
  official: boolean
}

/** A short, verbatim example from an official doc page (fetched by the app, never written by the model). */
export interface DocExample {
  url: string
  /** The method's declaration, when the page has one (Microsoft Learn). */
  signature?: string
  /** The few lines that use it. */
  excerpt: string[]
  /** Index in `excerpt` of the line that uses it. */
  focus?: number
  /** The whole example (capped), when it is longer than the excerpt. */
  full?: string[]
}

export interface MapApi {
  build(): Promise<CodeMap>
  stackDocs(): Promise<DocLink[]>
  /** A short official example for a concept the coach linked; null for unofficial sites or no example. */
  docExample(url: string, term: string): Promise<DocExample | null>
}
