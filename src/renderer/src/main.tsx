import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { TooltipProvider } from '@/components/ui/tooltip'
import { App } from './app'
import { ConfirmDeleteProvider } from '@/features/workspace/confirm-delete'
import './styles/globals.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TooltipProvider delayDuration={300}>
      <ConfirmDeleteProvider>
        <App />
      </ConfirmDeleteProvider>
    </TooltipProvider>
  </StrictMode>
)
