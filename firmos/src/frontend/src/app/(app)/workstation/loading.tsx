import { Skeleton } from '@/components/ui/skeleton'

/**
 * Row-shaped skeletons while the unified queue loads (DESIGN_MANDATE §2:
 * skeletons, never spinners).
 */
export default function WorkstationLoading() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading workstation">
      <div className="flex items-center justify-between">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-7 w-24" />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-14 rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-9 w-full max-w-xl rounded-lg" />
      <div className="overflow-hidden rounded-xl border border-border">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="flex h-12 items-center gap-3 border-b border-border px-4 last:border-b-0">
            <Skeleton className="h-6 w-6 rounded-md" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="hidden h-4 w-24 sm:block" />
            <Skeleton className="h-5 w-20 rounded" />
            <Skeleton className="h-6 w-6 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  )
}
