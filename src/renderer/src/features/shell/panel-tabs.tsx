import type { ReactNode } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SECTIONS, type SectionId } from './sections'

const TRIGGER =
  'flex-none px-2.5 py-2.5 text-xs after:bg-brand-line group-data-[orientation=horizontal]/tabs:after:bottom-[-1px] data-[state=active]:text-heading'

/** The sections of a session, as tabs across the top. */
export function PanelTabs({
  section,
  onSectionChange,
  disabled = [],
  shown,
  children
}: {
  /** The tabs to show, in order (all when unset). */
  shown?: SectionId[]
  section: SectionId
  onSectionChange: (id: SectionId) => void
  /** Sections that need code (Visualize, Map) while an idea has no folder yet. */
  disabled?: SectionId[]
  children: ReactNode
}) {
  return (
    <Tabs
      value={section}
      onValueChange={(v) => onSectionChange(v as SectionId)}
      className="min-h-0 flex-1 gap-0"
    >
      <TabsList variant="line" className="h-auto w-full justify-start gap-0 overflow-x-auto border-b border-divider px-2 py-0">
        {SECTIONS.filter((s) => !shown || shown.includes(s.id)).map(({ id, label, icon: Icon }) => (
          <TabsTrigger
            key={id}
            value={id}
            className={TRIGGER}
            disabled={disabled.includes(id)}
            title={disabled.includes(id) ? 'Link your project folder to use this' : undefined}
          >
            <Icon className="size-3.5" />
            {label}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value={section} className="flex min-h-0 flex-col">
        {children}
      </TabsContent>
    </Tabs>
  )
}
