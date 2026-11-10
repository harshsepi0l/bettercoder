import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { DEFAULT_WIDTH, MIN_WIDTH, STEP, clampCoachWidth, maxCoachWidth, readWidth, saveWidth, startCoachDrag } from './coach-width'

/**
 * The work on the left and the coach on the right, with a handle between them to resize the coach (drag, or ← / →
 * when the handle has focus; double-click resets it). The width is remembered on this computer.
 */
export function CoachSplit({ work, coach }: { work: React.ReactNode; coach: React.ReactNode }) {
  const rowRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(readWidth)
  const [rowWidth, setRowWidth] = useState(0)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    const el = rowRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setRowWidth(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const shown = rowWidth ? clampCoachWidth(width, rowWidth) : width
  const set = useCallback(
    (next: number) => {
      const w = rowWidth ? clampCoachWidth(next, rowWidth) : next
      setWidth(w)
      saveWidth(w)
    },
    [rowWidth]
  )

  // The latest `set`, for listeners attached during a drag.
  const setRef = useRef(set)
  setRef.current = set
  const stopDrag = useRef<(() => void) | null>(null)
  // Unmounted mid-drag (the session closed): take the listeners and the cover away.
  useEffect(() => {
    return () => stopDrag.current?.()
  }, [])

  /**
   * Dragging: the window follows the pointer, with a cover over VS Code's frame (which would otherwise take it). The
   * listeners go on at once, in the press itself: attached later (after a render), a quick press-and-release would
   * be missed and the cover would stay up over everything. Release, cancel, the window losing focus and Esc all end it.
   */
  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return
    e.preventDefault()
    stopDrag.current?.()
    stopDrag.current = startCoachDrag(window, { x: e.clientX, width: shown }, (w) => setRef.current(w), () => {
      stopDrag.current = null
      setDragging(false)
    })
    setDragging(true)
  }
  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'ArrowLeft') set(shown + STEP)
    else if (e.key === 'ArrowRight') set(shown - STEP)
    else if (e.key === 'Home') set(maxCoachWidth(rowWidth))
    else if (e.key === 'End') set(MIN_WIDTH)
    else return
    e.preventDefault()
  }

  return (
    <div ref={rowRef} className="relative flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">{work}</div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the coach"
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={rowWidth ? maxCoachWidth(rowWidth) : undefined}
        aria-valuenow={Math.round(shown)}
        tabIndex={0}
        title="Drag to resize the coach (double-click to reset)"
        onPointerDown={onPointerDown}
        onDoubleClick={() => set(DEFAULT_WIDTH)}
        onKeyDown={onKeyDown}
        className={cn(
          'group relative z-10 -mr-[3px] w-[6px] flex-none cursor-col-resize outline-none',
          'after:absolute after:inset-y-0 after:left-[2px] after:w-px after:bg-divider after:transition-colors',
          'hover:after:w-[2px] hover:after:bg-brand-line focus-visible:after:w-[2px] focus-visible:after:bg-brand-line',
          dragging && 'after:w-[2px] after:bg-brand-line'
        )}
      />
      <aside aria-label="Coach" style={{ width: shown }} className="flex min-w-0 flex-none flex-col overflow-hidden">
        {coach}
      </aside>
      {/* While dragging, VS Code's frame would swallow the pointer: a cover keeps it with the handle. */}
      {dragging && <div aria-hidden="true" className="fixed inset-0 z-50 cursor-col-resize" onPointerUp={() => stopDrag.current?.()} />}
    </div>
  )
}
