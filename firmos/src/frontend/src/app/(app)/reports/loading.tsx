import { Skeleton } from '@/components/ui/skeleton'

/**
 * Loading skeleton for every /reports/* page - header row plus a table with
 * row-shaped skeletons (DESIGN_MANDATE §2: skeletons, never spinners).
 */
export default function ReportsLoading() {
  return (
    <div className="space-y-5 pb-10" aria-busy="true" aria-label="Loading report">
      <div className="flex items-center justify-between">
        <div className="space-y-1.5">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-3.5 w-64" />
        </div>
        <Skeleton className="h-8 w-52" />
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex h-9 items-center gap-4 border-b border-border px-4">
          <Skeleton className="h-3 w-36" />
          <Skeleton className="ml-auto h-3 w-16" />
          <Skeleton className="h-3 w-16" />
        </div>
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="flex h-11 items-center gap-4 border-b border-border px-4 last:border-b-0">
            <Skeleton className="h-4 w-44" />
            <Skeleton className="ml-auto h-4 w-14" />
            <Skeleton className="h-4 w-14" />
            <Skeleton className="h-4 w-14" />
          </div>
        ))}
      </div>
    </div>
  )
}
