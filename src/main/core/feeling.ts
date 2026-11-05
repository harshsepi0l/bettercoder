import type { Mood } from '../../shared/ide'

/**
 * How the learner seems to be doing, from editor activity only: when they last typed and how long the same errors
 * have stood. Never from the words they send the coach. Pure, so it is tested.
 */

export interface Activity {
  now: number
  /** When they last changed the text, if seen. */
  lastEditAt: number | null
  /** The same set of errors since this time, if there are errors. */
  errorsSince: number | null
  /** A step with a marker is open and not typed out yet. */
  stepOpen: boolean
}

export const FLOW_WINDOW = 30_000
export const SAME_ERROR_STUCK = 90_000
export const PAUSE_STUCK = 180_000

function minutes(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60_000))
  return `${m} min`
}

export function feeling(a: Activity): { mood: Mood; why: string } {
  const sinceEdit = a.lastEditAt === null ? null : a.now - a.lastEditAt
  if (a.errorsSince !== null) {
    const stood = a.now - a.errorsSince
    // They kept trying and the same error is still there; or it is there and they stopped.
    if (stood >= SAME_ERROR_STUCK) return { mood: 'stuck', why: `Same error for ${minutes(stood)}` }
    return { mood: 'ok', why: 'Working on an error' }
  }
  if (sinceEdit === null) return { mood: 'ok', why: a.stepOpen ? 'Ready when you are' : 'Watching your editor' }
  if (sinceEdit <= FLOW_WINDOW) return { mood: 'flowing', why: 'Typing steadily' }
  if (a.stepOpen && sinceEdit >= PAUSE_STUCK) return { mood: 'stuck', why: `Paused ${minutes(sinceEdit)}` }
  return { mood: 'ok', why: 'Thinking' }
}
