import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * One part of the window that fails to draw shows what went wrong and a Try again button, instead of taking the
 * whole window down with it (React unmounts everything on an uncaught render error). `resetKey` changing (another
 * mode, another session) tries again by itself.
 */
export class ErrorBoundary extends Component<{ children: ReactNode; label: string; resetKey?: string }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[BetterCoder] ${this.props.label} failed to draw:`, error, info.componentStack)
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null })
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div role="alert" className="flex flex-col items-start gap-2 p-4 text-[13px]">
        <p className="flex items-center gap-2 font-semibold text-heading">
          <AlertTriangle className="size-4 text-status-missing" aria-hidden="true" />
          {this.props.label} hit a problem
        </p>
        <p className="font-mono text-[11.5px] break-all text-muted-foreground">{this.state.error.message}</p>
        <Button size="sm" variant="outline" className="h-7" onClick={() => this.setState({ error: null })}>
          <RotateCcw />
          Try again
        </Button>
      </div>
    )
  }
}
