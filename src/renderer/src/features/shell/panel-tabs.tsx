import type { ReactNode } from 'react'
import { Code2, MessageSquare } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

/** A narrow window has no room for the coach beside VS Code, so the two become tabs. */
export type NarrowTab = 'code' | 'coach'

const TABS = [
  { id: 'code', label: 'Code', icon: Code2 },
  { id: 'coach', label: 'Coach', icon: MessageSquare }
] as const

const TRIGGER =
  'flex-none px-2.5 py-2.5 text-xs after:bg-brand-line group-data-[orientation=horizontal]/tabs:after:bottom-[-1px] data-[state=active]:text-heading'

export function PanelTabs({ tab, onTabChange, children }: { tab: NarrowTab; onTabChange: (tab: NarrowTab) => void; children: ReactNode }) {
  return (
    <Tabs value={tab} onValueChange={(v) => onTabChange(v as NarrowTab)} className="min-h-0 flex-1 gap-0">
      <TabsList variant="line" className="h-auto w-full justify-start gap-0 overflow-x-auto border-b border-divider px-2 py-0">
        {TABS.map(({ id, label, icon: Icon }) => (
          <TabsTrigger key={id} value={id} className={TRIGGER}>
            <Icon className="size-3.5" />
            {label}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value={tab} className="flex min-h-0 flex-col">
        {children}
      </TabsContent>
    </Tabs>
  )
}
