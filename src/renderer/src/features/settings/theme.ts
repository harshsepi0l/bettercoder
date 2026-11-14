import { useEffect, useState } from 'react'
import type { Theme } from '../../../../shared/profile'

export type ShownTheme = 'dark' | 'light'

const MEDIA = '(prefers-color-scheme: light)'

/** The theme on screen: their pick, or the system's when they picked "system" (or nothing yet). */
export function resolveTheme(pick: Theme | undefined, systemLight: boolean): ShownTheme {
  if (pick === 'dark' || pick === 'light') return pick
  return systemLight ? 'light' : 'dark'
}

/** Put the theme on <html data-theme> (globals.css has the colours) and tell the main process (VS Code, the window). */
export function useApplyTheme(pick: Theme | undefined | null): ShownTheme {
  const [systemLight, setSystemLight] = useState(() => window.matchMedia(MEDIA).matches)
  useEffect(() => {
    const mq = window.matchMedia(MEDIA)
    const on = () => setSystemLight(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  // null: their settings are not read yet, so the look stays as it is (dark) instead of flashing the system's.
  const shown = pick === null ? 'dark' : resolveTheme(pick, systemLight)
  useEffect(() => {
    if (pick === null) return
    document.documentElement.dataset.theme = shown
    window.dispatchEvent(new CustomEvent('bc-theme', { detail: shown }))
    void window.bettercoder?.setTheme?.(shown)
  }, [shown, pick === null])
  return shown
}

/** The theme on screen now, for things that draw with raw colours (the whiteboard, diagrams). */
export function useShownTheme(): ShownTheme {
  const read = (): ShownTheme => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark')
  const [theme, setTheme] = useState<ShownTheme>(read)
  useEffect(() => {
    const on = () => setTheme(read())
    window.addEventListener('bc-theme', on)
    return () => window.removeEventListener('bc-theme', on)
  }, [])
  return theme
}

/** A theme colour as it is right now (a CSS variable from globals.css), for libraries that take raw colours. */
export function themeColor(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim()
}
