import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { TooltipProvider } from '@/components/ui/tooltip'
import { App } from './app'
import { ConfirmDeleteProvider } from '@/features/workspace/confirm-delete'
import './styles/globals.css'

// The whiteboard's fonts come with the app (scripts/copy-excalidraw-fonts.mjs), not from Excalidraw's CDN.
;(window as { EXCALIDRAW_ASSET_PATH?: string }).EXCALIDRAW_ASSET_PATH = new URL('./', location.href).href

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TooltipProvider delayDuration={300}>
      <ConfirmDeleteProvider>
        <App />
      </ConfirmDeleteProvider>
    </TooltipProvider>
  </StrictMode>
)
