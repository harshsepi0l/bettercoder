import { useCallback, useEffect, useRef, useState } from 'react'
import type { TaskNotice, TasksUpdate } from '../../../../shared/tasks'

/** How long a notification stays (it shows a bar running down). */
export const NOTICE_MS = 6000

export interface ShownNotice extends TaskNotice {
  key: number
}

/** The open session's tasks, kept current by the main process, and the notifications they raise. */
export function useTasks(): { update: TasksUpdate; notices: ShownNotice[]; dismiss: (key: number) => void } {
  const [update, setUpdate] = useState<TasksUpdate>({ sessionId: null, tasks: [] })
  const [notices, setNotices] = useState<ShownNotice[]>([])
  const next = useRef(0)
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())

  const dismiss = useCallback((key: number) => {
    clearTimeout(timers.current.get(key))
    timers.current.delete(key)
    setNotices((list) => list.filter((n) => n.key !== key))
  }, [])

  useEffect(() => {
    let live = true
    void window.tasks.list().then((u) => live && setUpdate(u))
    const off = window.tasks.onChanged((u) => {
      setUpdate((before) => {
        // Another session: its notifications go.
        if (before.sessionId !== u.sessionId) setNotices([])
        return u
      })
      if (!u.notice) return
      const key = ++next.current
      setNotices((list) => [...list.slice(-2), { ...u.notice!, key }])
      timers.current.set(
        key,
        setTimeout(() => dismiss(key), NOTICE_MS)
      )
    })
    const all = timers.current
    return () => {
      live = false
      off()
      for (const t of all.values()) clearTimeout(t)
    }
  }, [dismiss])

  return { update, notices, dismiss }
}
