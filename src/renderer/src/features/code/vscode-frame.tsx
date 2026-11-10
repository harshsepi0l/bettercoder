import { useEffect, useState } from 'react'
import { FolderOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { VscodeFrame } from '../../../../shared/code'

/**
 * The Code tab: the built-in VS Code (code-server) for the open project. It runs on 127.0.0.1 in its own frame and
 * can't reach the app's bridge (another origin). A project without a folder (an idea) gets "Pick a folder" first.
 */
export function CodeSurface({ sessionKey, root, onPickFolder }: { sessionKey: string; root: string; onPickFolder: () => void }) {
  const [frame, setFrame] = useState<VscodeFrame | null>(null)
  // VS Code restarted (after "Bring your VS Code"): open it again.
  const [epoch, setEpoch] = useState(0)
  useEffect(() => {
    const off = window.editorImport.onRestarted(() => setEpoch((n) => n + 1))
    return off
  }, [])
  useEffect(() => {
    let live = true
    setFrame(null)
    void window.code.vscodeUrl().then((f) => live && setFrame(f))
    return () => {
      live = false
    }
  }, [sessionKey, root, epoch])

  if (!frame) return <Centered>Opening VS Code…</Centered>
  if (frame.kind === 'problem') return <Centered>{frame.message}</Centered>
  if (frame.kind === 'no-folder')
    return (
      <Centered>
        <div className="flex flex-col items-center gap-3">
          <span className="text-[15px] font-medium text-heading">Pick a folder for your code</span>
          <span>Your files live there. The coach can read them; only you write them.</span>
          <Button size="sm" onClick={onPickFolder}>
            <FolderOpen className="size-4" />
            Pick a folder
          </Button>
        </div>
      </Centered>
    )
  return (
    <iframe
      key={`${frame.url}#${epoch}`}
      title="VS Code"
      src={frame.url}
      className="min-h-0 min-w-0 flex-1 border-0 bg-background"
      allow="clipboard-read; clipboard-write"
    />
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-1 items-center justify-center p-6 text-center text-[13px] text-muted-foreground">{children}</div>
}
