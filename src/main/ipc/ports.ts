import type { CoachPorts, ProjectScanner } from '../ports'
import { projectFiles } from '../adapters/fs-readonly'
import { codeMapper } from '../engines/map/build-map'
import { projectScanner } from '../engines/project'

/**
 * The real implementations of the ports, plugged in at the top (the composition root). Nothing below ipc/ picks its
 * own outside world; tests can pass these or stand-ins.
 */
export function realPorts(): CoachPorts & { scanner: ProjectScanner } {
  return { files: projectFiles, mapper: codeMapper, scanner: projectScanner }
}
