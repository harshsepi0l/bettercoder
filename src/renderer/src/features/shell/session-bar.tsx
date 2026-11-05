import { useEffect, useRef, useState } from 'react'
import { Code, FolderOpen, FolderPlus, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { Workspace } from '@/features/workspace/use-workspace'
import { SessionMenu } from '@/features/workspace/menus'
import { relativeTime } from './sidebar'

/**
 * The open session's header. Wide: project / editable title.
 * Narrow (no sidebar): a session picker plus new-session and open-folder buttons.
 */
export function SessionBar({ workspace, wide }: { workspace: Workspace; wide: boolean }) {
  const active = workspace.active
  const [title, setTitle] = useState(active?.session.title ?? '')
  const [renaming, setRenaming] = useState(false)
  const titleInput = useRef<HTMLInputElement>(null)
  useEffect(() => {
    setTitle(active?.session.title ?? '')
  }, [active?.session.id, active?.session.title])

  function commit() {
    setRenaming(false)
    if (active && title.trim() && title !== active.session.title) void workspace.renameSession(active.session.id, title.trim())
  }

  const menu = active && (
    <SessionMenu
      session={active.session}
      workspace={workspace}
      onRename={() => {
        setRenaming(true)
        // Wait for the input to be on screen, then select its text.
        setTimeout(() => titleInput.current?.select(), 0)
      }}
    />
  )

  // An idea project has no folder yet: linking one lets the coach see the learner's files.
  const linkButton = active && !active.project.root && (
    <Button size="sm" variant="secondary" onClick={() => workspace.linkFolder(active.project.id)}>
      <FolderPlus />
      Link folder
    </Button>
  )

  // Opens the project in their editor (VS Code, Cursor…). Only opens; nothing is written.
  const editorButton = active?.project.root && (
    <Button size="sm" variant="ghost" aria-label="Open in editor" title="Open in editor" onClick={() => void window.ide.openInEditor()}>
      <Code />
      {wide && 'Open in editor'}
    </Button>
  )

  if (!wide) {
    return (
      <div className="flex shrink-0 items-center gap-1.5 border-b border-divider px-3 py-2">
        {renaming && active ? (
          <>
            <label htmlFor="session-title-narrow" className="sr-only">
              Session title
            </label>
            <Input
              id="session-title-narrow"
              ref={titleInput}
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit()
                if (e.key === 'Escape') setRenaming(false)
              }}
              className="h-8 flex-1 bg-muted text-[12.5px]"
            />
          </>
        ) : (
        <Select value={active?.session.id} onValueChange={(id) => workspace.openSession(id)}>
          <SelectTrigger size="sm" className="min-w-0 flex-1 bg-muted text-[12.5px]" aria-label="Session">
            <SelectValue placeholder={workspace.projects.length ? 'Choose a session' : 'No sessions yet'} />
          </SelectTrigger>
          <SelectContent>
            {workspace.projects.map((p) => (
              <SelectGroup key={p.id}>
                <SelectLabel>{p.name}</SelectLabel>
                {p.sessions.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.title} · {relativeTime(s.updatedAt)}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
        )}
        {menu}
        {linkButton}
        {editorButton}
        {active && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="New session in this project"
            onClick={() => workspace.newSession(active.project.id)}
          >
            <Plus />
          </Button>
        )}
        <Button variant="ghost" size="icon-sm" aria-label="Open a folder or files" onClick={() => workspace.open()}>
          <FolderOpen />
        </Button>
      </div>
    )
  }

  if (!active) return null
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-divider px-3.5 py-2">
      <span className="font-mono text-[12px] text-muted-foreground">{active.project.name}</span>
      <span className="text-muted-foreground" aria-hidden="true">
        /
      </span>
      <label htmlFor="session-title" className="sr-only">
        Session title
      </label>
      <Input
        id="session-title"
        ref={titleInput}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        className="h-7 max-w-md border-transparent bg-transparent px-1.5 text-[13px] font-medium text-heading shadow-none hover:border-input focus-visible:border-input dark:bg-transparent"
      />
      <div className="flex-1" />
      {linkButton}
      {editorButton}
    </div>
  )
}
