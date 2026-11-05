import { useSyncExternalStore } from 'react'

/** True when the window is wide enough for the sidebar layout. */
const QUERY = '(min-width: 760px)'

export function useIsWide(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(QUERY)
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    },
    () => window.matchMedia(QUERY).matches
  )
}
