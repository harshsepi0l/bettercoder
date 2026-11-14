import { useEffect, useMemo, useRef, useState } from 'react'
import { Excalidraw, convertToExcalidrawElements } from '@excalidraw/excalidraw'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import '@excalidraw/excalidraw/index.css'
import type { Drawn } from '../../../../shared/board'
import { BOARD_THEMES, boardBounds, boardSkeletons } from './board-elements'
import { useShownTheme } from '@/features/settings/theme'

/** How long new things take to appear on the board. */
const FADE_MS = 380

/**
 * The whiteboard canvas (Excalidraw, loaded only when a board shows). Read-only: it draws the current step, fades in
 * what the step added, and keeps the camera on the whole board so nothing jumps while it plays. Light theme on the
 * app's dark grey: Excalidraw's dark theme inverts the canvas colours.
 */
export default function BoardCanvas({ drawn, frame, interactive }: { drawn: Drawn[]; frame: Drawn[]; interactive: boolean }) {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null)
  const theme = useShownTheme()
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setSize({ width: e.contentRect.width, height: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // The camera: framed on the whole board (its last step), so nothing moves while it plays. Excalidraw fits it; the
  // finished board's elements are the target even when they are not all drawn yet. Never zoomed in past 1.2×.
  const target = useMemo(() => convertToExcalidrawElements(boardSkeletons(frame, 1, theme) as never, { regenerateIds: false }), [frame, theme])
  const frameCamera = useRef<() => void>(() => undefined)
  frameCamera.current = () => {
    if (!api || !size.width) return
    const b = boardBounds(frame)
    const fit = Math.min((size.width - 64) / b.w, (size.height - 64) / b.h)
    api.scrollToContent(target, { fitToViewport: true, viewportZoomFactor: Math.max(0.1, Math.min(0.92, (0.92 * 1.2) / fit)), animate: false })
  }
  useEffect(() => {
    frameCamera.current()
  }, [api, target, size])

  // The step: drawn at once, with what it added fading in, then the camera put back on the whole board (Excalidraw
  // moves it when the scene changes).
  useEffect(() => {
    if (!api) return
    const draw = (fade: number) => {
      api.updateScene({ elements: convertToExcalidrawElements(boardSkeletons(drawn, fade, theme) as never, { regenerateIds: false }) })
      frameCamera.current()
    }
    if (!drawn.some((d) => d.fresh)) {
      draw(1)
      return
    }
    let raf = 0
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / FADE_MS)
      draw(t)
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [api, drawn, theme])

  // The board's own ground follows the app's theme.
  useEffect(() => {
    api?.updateScene({ appState: { viewBackgroundColor: BOARD_THEMES[theme].background } })
  }, [api, theme])

  return (
    <div ref={box} className={interactive ? 'bc-board h-full w-full' : 'bc-board pointer-events-none h-full w-full'}>
      <Excalidraw
        excalidrawAPI={setApi}
        theme="light"
        viewModeEnabled
        zenModeEnabled
        detectScroll={false}
        handleKeyboardGlobally={false}
        autoFocus={false}
        initialData={{ appState: { viewBackgroundColor: BOARD_THEMES[theme].background } }}
        UIOptions={{ canvasActions: { changeViewBackgroundColor: false, clearCanvas: false, export: false, loadScene: false, saveToActiveFile: false, toggleTheme: false, saveAsImage: false } }}
      />
    </div>
  )
}
