import type { TraceValue } from '../../../../shared/trace'
import { cn } from '@/lib/utils'

/** A value drawn as a picture: lists as indexed boxes, objects as labelled cards. */
export function ValueView({ value, depth = 0 }: { value: TraceValue; depth?: number }) {
  switch (value.t) {
    case 'none':
      return <span className="font-mono text-[12px] text-muted-foreground">None</span>
    case 'bool':
      return <span className="font-mono text-[12px] text-status-progress">{value.v ? 'True' : 'False'}</span>
    case 'num':
      return <span className="font-mono text-[12px] text-sky-300">{String(value.v)}</span>
    case 'str':
      return <span className="font-mono text-[12px] text-status-done">"{value.v}"</span>
    case 'func':
      return <span className="font-mono text-[11px] text-muted-foreground">ƒ {value.name}</span>
    case 'repr':
      return <span className="font-mono text-[12px]">{value.v}</span>
    case 'list':
      if (value.items.length === 0) {
        return <span className="font-mono text-[12px] text-muted-foreground">{value.kind === 'list' ? '[ ] empty' : 'empty'}</span>
      }
      // A list of equal-length lists (a 2D array, a grid) is drawn as rows under each other.
      if (value.items.length > 1 && value.items.every((r) => r.t === 'list' && r.items.length > 0 && r.items.every((c) => c.t !== 'list'))) {
        const rows = value.items as Array<Extract<TraceValue, { t: 'list' }>>
        const cols = Math.max(...rows.map((r) => r.items.length))
        return (
          <div className="inline-flex flex-col gap-0.5">
            {value.label && <span className="text-[9.5px] text-muted-foreground">{value.label}</span>}
            <table className="border-separate border-spacing-0.5">
              <thead>
                <tr>
                  <th />
                  {Array.from({ length: cols }, (_, c) => (
                    <th key={c} className="font-mono text-[9.5px] font-normal text-muted-foreground">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, ri) => (
                  <tr key={ri}>
                    <th className="pr-1 font-mono text-[9.5px] font-normal text-muted-foreground">{ri}</th>
                    {r.items.map((cell, ci) => (
                      <td key={ci} className="min-w-7 rounded border border-brand-line/40 bg-brand-tint/50 px-1 py-0.5 text-center">
                        <ValueView value={cell} depth={depth + 2} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {value.more ? <span className="text-[10px] text-muted-foreground">+{value.more} more rows</span> : null}
          </div>
        )
      }
      return (
        <div className="inline-flex flex-col gap-0.5">
          {(value.label || value.kind !== 'list') && (
            <span className="text-[9.5px] text-muted-foreground">{value.label ?? value.kind}</span>
          )}
          <div className="inline-flex flex-wrap items-stretch gap-1">
            {value.items.map((item, i) => (
              <div key={i} className="flex flex-col items-center gap-0.5">
                <div className="flex min-h-7 min-w-8 items-center justify-center rounded border border-brand-line/50 bg-brand-tint/60 px-1.5 py-1">
                  <ValueView value={item} depth={depth + 1} />
                </div>
                {value.kind !== 'set' && <span className="font-mono text-[9.5px] text-muted-foreground">{i}</span>}
              </div>
            ))}
            {value.more ? <span className="self-center text-[10px] text-muted-foreground">+{value.more} more</span> : null}
          </div>
        </div>
      )
    case 'dict':
      if (value.entries.length === 0) return <span className="font-mono text-[12px] text-muted-foreground">{'{ }'} empty</span>
      return (
        <div className="inline-grid grid-cols-[auto_auto] gap-x-2 gap-y-0.5 rounded border border-border bg-muted/60 px-2 py-1">
          {value.entries.map(([k, v], i) => (
            <div key={i} className="contents">
              <span className="text-right">
                <ValueView value={k} depth={depth + 1} />
              </span>
              <span>
                <ValueView value={v} depth={depth + 1} />
              </span>
            </div>
          ))}
          {value.more ? <span className="col-span-2 text-[10px] text-muted-foreground">+{value.more} more</span> : null}
        </div>
      )
    case 'obj':
      return (
        <div className="inline-flex flex-col rounded border border-border bg-muted/60">
          <span className="border-b px-2 py-0.5 font-mono text-[10.5px] text-brand-text">{value.cls}</span>
          <div className="flex flex-col gap-1 px-2 py-1">
            {value.fields.length === 0 && <span className="text-[11px] text-muted-foreground">no fields</span>}
            {value.fields.map(([k, v]) => (
              <div key={k} className={cn('flex items-start gap-2', depth > 1 && 'text-[11px]')}>
                <span className="pt-0.5 font-mono text-[11.5px] text-muted-foreground">{k}</span>
                <ValueView value={v} depth={depth + 1} />
              </div>
            ))}
          </div>
        </div>
      )
  }
}
