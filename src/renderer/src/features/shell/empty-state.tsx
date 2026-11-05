import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

export function EmptyState({
  icon: Icon,
  title,
  children,
  action
}: {
  icon: LucideIcon
  title: string
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
      <div className="flex size-10 items-center justify-center rounded-lg border bg-card text-brand-text">
        <Icon className="size-5" aria-hidden="true" />
      </div>
      <h2 className="text-sm font-medium text-heading">{title}</h2>
      <p className="text-[13px] leading-relaxed text-muted-foreground">{children}</p>
      {action}
    </div>
  )
}
