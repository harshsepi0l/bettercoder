import { useCallback, useEffect, useState } from 'react'
import type { AuthUiEvent, HarnessSettings } from '../../../../shared/harness'

export function useSettings() {
  const [settings, setSettings] = useState<HarnessSettings | null>(null)
  const [auth, setAuth] = useState<AuthUiEvent | null>(null)

  const refresh = useCallback(async () => setSettings(await window.harness.getSettings()), [])

  useEffect(() => {
    void refresh()
    return window.harness.onAuthEvent((e) => setAuth(e))
  }, [refresh])

  return {
    settings,
    auth,
    clearAuth: () => setAuth(null),
    setAuth,
    refresh,
    apply: setSettings
  }
}

export type SettingsState = ReturnType<typeof useSettings>
