import type { ScenarioCall, Trace } from './trace'

export const VISUALIZE_IPC = {
  files: 'visualize:files',
  outline: 'visualize:outline',
  run: 'visualize:run'
} as const

export interface PythonOutline {
  functions: string[]
  classes: Array<{ name: string; methods: string[] }>
}

export interface VisualizeApi {
  /** Python files in the open project that can be animated. */
  files(): Promise<string[]>
  outline(file: string): Promise<PythonOutline>
  run(file: string, scenario: ScenarioCall[]): Promise<Trace>
}
