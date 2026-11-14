import { useEffect, useMemo, useRef, useState } from 'react'
import { boardsFromChat, lockedSections } from '../../shared/chat'
import { AlertTriangle, X } from 'lucide-react'
import { TitleBar } from '@/features/shell/title-bar'
import { PanelTabs, type NarrowTab } from '@/features/shell/panel-tabs'
import { Sidebar, SidebarRail, type SidebarProps } from '@/features/shell/sidebar'
import { SessionBar } from '@/features/shell/session-bar'
import { Composer } from '@/features/shell/composer'
import { ModePanel } from '@/features/shell/sections'
import { CodeSurface } from '@/features/code/vscode-frame'
import type { CoachIntent, CoachMode } from '../../shared/harness'
import { CoachSplit } from '@/features/shell/coach-aside'
import { CoachPane } from '@/features/coach/coach-pane'
import { useIsWide } from '@/features/shell/use-is-wide'
import { useCoach } from '@/features/coach/use-coach'
import { SettingsDialog } from '@/features/settings/settings-dialog'
import { useSettings } from '@/features/settings/use-settings'
import { useWorkspace } from '@/features/workspace/use-workspace'
import { Home } from '@/features/home/home'
import { Onboarding } from '@/features/profile/onboarding'
import { CodeViewContext } from '@/features/coach/code-view'
import { BoardOpenContext } from '@/features/visualize/board-open'
import { ErrorBoundary } from '@/features/shell/error-boundary'
import { useApplyTheme } from '@/features/settings/theme'

const SIDEBAR_KEY = 'bettercoder.sidebar-open'

function readSidebarOpen(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) !== 'false'
  } catch {
    return true
  }
}

export function App() {
  // Narrow windows only: VS Code and the coach are two tabs.
  const [section, setSection] = useState<NarrowTab>('code')
  // What the coach pane has open (Chat, Tasks, Visualize, Map, Sources). Chat is the only chat.
  const [mode, setMode] = useState<CoachMode>('chat')
  // The board Visualize shows: opened with Expand in the chat, or picked there (null: the newest).
  const [board, setBoard] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  // The task they are asking the coach about, from the Tasks tab.
  const [about, setAbout] = useState<{ id: string; title: string } | null>(null)
  const [atHome, setAtHome] = useState(true)
  const [sidebarOpen, setSidebarOpen] = useState(readSidebarOpen)
  const ideaRef = useRef<HTMLTextAreaElement>(null)
  const wide = useIsWide()
  const rawWorkspace = useWorkspace()
  // Picking the session that is already open must still leave Home.
  const workspace = {
    ...rawWorkspace,
    openSession: (id: string) => {
      if (rawWorkspace.active?.session.id === id) setAtHome(false)
      return rawWorkspace.openSession(id)
    }
  }
  const coach = useCoach()
  const settingsState = useSettings()
  const settings = settingsState.settings
  const hasModel = settings?.model != null
  const project = workspace.active?.project ?? null
  const sessionId = workspace.active?.session.id
  const isIdea = !!project && !project.root
  const showHome = atHome || !workspace.active

  // Opening or starting a session leaves Home, on the code with the coach's chat beside it.
  useEffect(() => {
    if (!sessionId) return
    setAtHome(false)
    setAbout(null)
    setMode('chat')
    setBoard(null)
    // A narrow window opens on the code; an idea with no folder on the coach.
    setSection(isIdea && !wide ? 'coach' : 'code')
    // Only when the session changes.
  }, [sessionId])
  // Modes an idea can't use yet (Map and Tasks) fall back to Chat.
  const locked = useMemo(() => lockedSections(isIdea) as CoachMode[], [isIdea])
  const shownMode: CoachMode = locked.includes(mode) ? 'chat' : mode
  useEffect(() => {
    if (shownMode !== mode) setMode(shownMode)
  }, [shownMode, mode])
  // Typed in the chat: no mode tag.
  const send = (text: string, intent?: CoachIntent) => coach.send(text, intent)
  // Asked from another mode (Ask on the Map or in Sources, Get a hint on a task, Draw): it carries that mode, and the
  // answer is read in the chat, the only one, so the pane goes there. Visualize stays: the board lands in its view.
  const askFromMode = (text: string, intent?: CoachIntent) => {
    coach.send(text, intent, shownMode)
    if (shownMode !== 'visualize') setMode('chat')
  }

  // "Open in editor" (Map, a step card's file link) opens the file in VS Code: bring the Code tab to the front.
  useEffect(() => {
    const off = window.ide.onShowCode(() => {
      setAtHome(false)
      setSection('code')
    })
    return off
  }, [])

  function toggleSidebar() {
    setSidebarOpen((open) => {
      try {
        localStorage.setItem(SIDEBAR_KEY, String(!open))
      } catch {
        // Remembering is a convenience only.
      }
      return !open
    })
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        toggleSidebar()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const sidebarProps: SidebarProps = {
    workspace,
    atHome: showHome,
    onHome: () => setAtHome(true),
    onNewIdea: () => {
      setAtHome(true)
      setTimeout(() => ideaRef.current?.focus(), 50)
    },
    profile: settings?.profile ?? null,
    onOpenProfile: () => setSettingsOpen(true)
  }

  const onboarding = settings != null && !settings.profile.onboarded

  const disabledReason = !project ? 'Open a folder or files first' : !hasModel ? 'Connect a model in Settings to start' : null

  const composer = (
    <Composer
      wide={wide}
      disabledReason={disabledReason}
      busy={coach.busy}
      usage={coach.usage}
      hasCode={!isIdea}
      onSend={send}
      onStop={coach.stop}
      about={about}
      onClearAbout={() => setAbout(null)}
      onClearChat={
        sessionId && coach.items.length > 0
          ? async () => {
              setAbout(null)
              await window.workspace.clearChat(sessionId)
            }
          : undefined
      }
    />
  )
  const code = (
    <CodeSurface
      sessionKey={sessionId ?? ''}
      root={project?.root ?? ''}
      onPickFolder={() => {
        if (workspace.active) void workspace.linkFolder(workspace.active.project.id)
      }}
    />
  )
  const coachPane = (
    <CoachPane
      project={project}
      coach={coach}
      hasModel={hasModel}
      onOpenProject={() => workspace.open()}
      onOpenSettings={() => setSettingsOpen(true)}
      mode={shownMode}
      onModeChange={setMode}
      locked={locked}
      onSend={send}
      panel={
        <ModePanel
          mode={shownMode}
          project={project}
          items={coach.items}
          busy={coach.busy}
          onAsk={askFromMode}
          board={board}
          onPickBoard={setBoard}
          onAskTask={(task) => {
            // The task goes on the composer as a chip; they type their question in the chat.
            setAbout({ id: task.id, title: task.title })
            setMode('chat')
          }}
        />
      }
    >
      {composer}
    </CoachPane>
  )

  // A new board: Visualize shows it (the newest) instead of one opened earlier.
  const boardCount = useMemo(() => boardsFromChat(coach.items).length, [coach.items])
  useEffect(() => {
    setBoard(null)
  }, [boardCount])

  // Expand on a board in the chat: open it full size in Visualize.
  const openBoard = (id: string) => {
    setBoard(id)
    setMode('visualize')
  }

  // The app's look: their pick in Settings › You, or the computer's (dark until settings load).
  useApplyTheme(settings ? settings.profile.theme : null)

  // How step cards show real code: the learner's pick from onboarding or Settings, saved with their profile.
  const codeView = { view: settings?.profile.codeView }

  return (
    <CodeViewContext.Provider value={codeView}>
    <BoardOpenContext.Provider value={openBoard}>
    <div className="flex h-full flex-col bg-background">
      <TitleBar
        project={project}
        sessionTitle={workspace.active?.session.title}
        atHome={showHome || onboarding}
        onOpenSettings={() => setSettingsOpen(true)}
        sidebar={onboarding ? undefined : { open: sidebarOpen, toggle: toggleSidebar }}
      />
      {onboarding ? (
        <Onboarding state={settingsState} onDone={() => setAtHome(true)} />
      ) : (
        <div className="flex min-h-0 flex-1">
          {sidebarOpen && (wide ? <Sidebar {...sidebarProps} /> : <SidebarRail {...sidebarProps} />)}
          <main className="flex min-w-0 flex-1 flex-col">
            <ErrorBoundary label="This session" resetKey={sessionId ?? 'home'}>
            {workspace.error && (
              <div
                role="alert"
                className="flex items-start gap-2 border-b border-status-missing/40 bg-status-missing/10 px-3.5 py-2 text-[12px] text-status-missing"
              >
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                <span className="flex-1">{workspace.error}</span>
                <button type="button" aria-label="Dismiss" onClick={workspace.clearError}>
                  <X className="size-3.5" />
                </button>
              </div>
            )}
            {showHome ? (
              <Home workspace={workspace} hasModel={hasModel} onOpenSettings={() => setSettingsOpen(true)} ideaRef={ideaRef} />
            ) : (
              <>
                {/* Wide: the title bar already names the project and session. */}
                {!wide && <SessionBar workspace={workspace} />}
                {wide ? (
                  // VS Code on the left, the coach always on the right (resizable).
                  <CoachSplit work={code} coach={coachPane} />
                ) : (
                  <PanelTabs tab={section} onTabChange={setSection}>
                    {section === 'code' ? code : coachPane}
                  </PanelTabs>
                )}
              </>
            )}
            </ErrorBoundary>
          </main>
        </div>
      )}
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={(open) => {
          setSettingsOpen(open)
          if (!open) void settingsState.refresh()
        }}
        state={settingsState}
        onRedoSetup={async () => {
          setSettingsOpen(false)
          if (settings) settingsState.apply(await window.harness.setProfile({ ...settings.profile, onboarded: false }))
        }}
      />
    </div>
    </BoardOpenContext.Provider>
    </CodeViewContext.Provider>
  )
}
