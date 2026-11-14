import { useCallback, useEffect, useState } from 'react'
import { applyEvent, type ChatItem } from '../../../../shared/chat'
import type { CoachIntent, CoachMode, HarnessEvent, TurnUsage } from '../../../../shared/harness'

export type { ChatItem }

let counter = 0
const localId = () => `local-${++counter}`

/** Chat state for the open session's coach, fed by the harness event stream. */
export function useCoach() {
  const [items, setItems] = useState<ChatItem[]>([])
  const [busy, setBusy] = useState(false)
  const [usage, setUsage] = useState<TurnUsage | null>(null)

  useEffect(() => {
    return window.harness.onEvent((e: HarnessEvent) => {
      if (e.type === 'busy') setBusy(e.busy)
      else if (e.type === 'usage') setUsage(e.session)
      else if (e.type === 'session_opened') {
        setItems(e.open.session.items)
        setUsage(e.open.session.usage)
        setBusy(false)
      } else if (e.type === 'session_closed') {
        setItems([])
        setUsage(null)
        setBusy(false)
      } else setItems((xs) => applyEvent(xs, e, localId))
    })
  }, [])

  /** Typed text and card answers go without an intent; buttons pass theirs. The pane's mode goes with every message. */
  const send = useCallback((text: string, intent?: CoachIntent, mode?: CoachMode) => {
    const trimmed = text.trim()
    if (trimmed) void window.harness.send(trimmed, intent, mode)
  }, [])

  const stop = useCallback(() => void window.harness.abort(), [])

  return { items, busy, usage, send, stop }
}

export type Coach = ReturnType<typeof useCoach>
