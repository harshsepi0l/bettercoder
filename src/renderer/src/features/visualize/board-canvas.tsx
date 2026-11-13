import { useEffect, useRef, useState } from 'react'
import { Excalidraw, convertToExcalidrawElements } from '@excalidraw/excalidraw'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import '@excalidraw/excalidraw/index.css'
import type { Drawn } from '../../../../shared/board'
import { BOARD_COLORS, boardBounds, boardCamera, boardSkeletons } from './board-elements'

/** How long new things take to appear on the board. */
const FADE_MS = 380

/**
 * The whiteboard canvas (Excalidraw, loaded only when a board shows). Read-only: it draws the current step, fades in
 * what the step added, and keeps the camera on the whole board so nothing jumps while it plays. Light theme on the
 * app's dark grey: Excalidraw's dark theme inverts the canvas colours.
 */
export default function BoardCanvas({ drawn, frame, interactive }: { drawn: Drawn[]; frame: Drawn[]; interactive: boolean }) {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setSize({ width: e.contentRect.width, height: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // The camera: framed on the whole board (its last step).
  useEffect(() => {
    if (!api || !size.width) return
    const cam = boardCamera(boardBounds(frame), size)
    api.updateScene({ appState: { zoom: { value: cam.zoom as never }, scrollX: cam.scrollX, scrollY: cam.scrollY } })
  }, [api, frame, size])

  // The step: drawn at once, with what it added fading in.
  useEffect(() => {
    if (!api) return
    const draw = (fade: number) =>
      api.updateScene({ elements: convertToExcalidrawElements(boardSkeletons(drawn, fade) as never, { regenerateIds: false }) })
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
  }, [api, drawn])

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
        initialData={{ appState: { viewBackgroundColor: BOARD_COLORS.background } }}
        UIOptions={{ canvasActions: { changeViewBackgroundColor: false, clearCanvas: false, export: false, loadScene: false, saveToActiveFile: false, toggleTheme: false, saveAsImage: false } }}
      />
    </div>
  )
}
