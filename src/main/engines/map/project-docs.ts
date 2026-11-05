import type { ProjectInfo } from '../../../shared/ipc'
import type { DocLink } from '../../../shared/map'
import { buildMap } from './build-map'
import { stackDocs } from './docs'

/**
 * The official docs for the open project's stack, for Sources. An idea with no folder yet (or no project) has no
 * stack to read, so it gets none; never an error (regression: Sources threw "Link your project folder first").
 */
export async function projectStackDocs(p: ProjectInfo | null | undefined): Promise<DocLink[]> {
  if (!p?.root) return []
  const map = await buildMap(p).catch(() => null)
  return stackDocs(p.stacks, map?.languages ?? [], map?.libraries ?? [])
}
