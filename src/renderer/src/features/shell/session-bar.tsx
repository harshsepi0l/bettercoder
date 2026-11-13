import { useEffect, useRef, useState } from 'react'
import { FolderOpen, FolderPlus, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { Workspace } from '@/features/workspace/use-workspace'
import { SessionMenu } from '@/features/workspace/menus'
import { relativeTime } from './sidebar'

/**
 * The open session's header on narrow windows (no sidebar): a session picker plus new-session and open-folder buttons.
 * Wide windows have none: the title bar names the project and session, and the sidebar renames it.
 */
export function SessionBar({ workspace }: { workspace: Workspace }) {
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
