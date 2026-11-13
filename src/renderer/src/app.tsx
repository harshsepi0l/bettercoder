import { useEffect, useMemo, useRef, useState } from 'react'
import { lockedSections } from '../../shared/chat'
import { AlertTriangle, X } from 'lucide-react'
import { TitleBar } from '@/features/shell/title-bar'
import { PanelTabs } from '@/features/shell/panel-tabs'
import { Sidebar, SidebarRail, type SidebarProps } from '@/features/shell/sidebar'
import { SessionBar } from '@/features/shell/session-bar'
import { Composer } from '@/features/shell/composer'
import { SectionContent, layoutSections, type SectionId } from '@/features/shell/sections'
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

const SIDEBAR_KEY = 'bettercoder.sidebar-open'

function readSidebarOpen(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) !== 'false'
  } catch {
    return true
  }
}

export function App() {
  const [section, setSection] = useState<SectionId>('code')
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

  // Opening or starting a session leaves Home; an idea project starts on the Coach tab.
  useEffect(() => {
    if (!sessionId) return
    setAtHome(false)
    setAbout(null)
    // A session opens on the code; an idea with no folder (in a narrow window) on the coach.
    setSection(isIdea && !wide ? 'coach' : 'code')
    // Only when the session changes.
  }, [sessionId])
  // A locked tab (Map and Tasks in an idea) falls back to the first tab. Same rule as the tab row.
  const locked = useMemo(() => lockedSections(isIdea), [isIdea])
  // Wide: the coach is a pane beside the Code tab's VS Code.
  const paneLayout = wide
  const shown = layoutSections({ wide })
  const shownSection: SectionId = (locked as SectionId[]).includes(section) || !shown.includes(section) ? shown[0] : section
  // Also reset what is stored, so a tab that unlocks later (an animation arrives) never jumps open by itself.
  useEffect(() => {
    if (shownSection !== section) setSection(shownSection)
  }, [shownSection, section])

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
      onSend={coach.send}
      onStop={coach.stop}
      about={about}
      onClearAbout={() => setAbout(null)}
    />
  )
  const tabs = (
    <PanelTabs section={shownSection} onSectionChange={setSection} disabled={locked} shown={shown}>
      <SectionContent
        section={shownSection}
        sessionKey={sessionId ?? ''}
        project={project}
        onOpenProject={() => workspace.open()}
        onPickFolder={() => {
          if (workspace.active) void workspace.linkFolder(workspace.active.project.id)
        }}
        coach={coach}
        hasModel={hasModel}
        onOpenSettings={() => setSettingsOpen(true)}
        onAsk={(text, intent) => {
          // Beside the editor the coach is already on screen; otherwise switch to it.
          if (!paneLayout) setSection('coach')
          coach.send(text, intent)
        }}
        onViewTasks={() => setSection('tasks')}
        onAskTask={(task) => {
          setAbout({ id: task.id, title: task.title })
          if (!paneLayout) setSection('coach')
        }}
      />
    </PanelTabs>
  )

  // How step cards show real code: the learner's pick from onboarding or Settings, saved with their profile.
  const codeView = { view: settings?.profile.codeView }

  return (
    <CodeViewContext.Provider value={codeView}>
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
                {paneLayout ? (
                  // The learner's work on the left, the coach always on the right (resizable).
                  <CoachSplit
                    work={tabs}
                    coach={
                      <CoachPane
                        project={project}
                        coach={coach}
                        hasModel={hasModel}
                        onOpenProject={() => workspace.open()}
                        onOpenSettings={() => setSettingsOpen(true)}
                        onViewTasks={() => setSection('tasks')}
                      >
                        {composer}
                      </CoachPane>
                    }
                  />
                ) : (
                  <>
                    {tabs}
                    {shownSection === 'coach' && composer}
                  </>
                )}
              </>
            )}
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
    </CodeViewContext.Provider>
  )
}
