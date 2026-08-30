import { Skeleton } from '@/components/ui/skeleton'

/**
 * Heatmap-shaped skeleton while the firm progression board loads
 * (DESIGN_MANDATE §2: skeletons, never spinners).
 */
export default function ProgressLoading() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading firm progression board">
      <div className="space-y-1.5">
        <Skeleton className="h-7 w-28" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="flex items-center justify-between">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-5 w-96" />
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-8 w-44 rounded-md" />
        <Skeleton className="h-8 w-36 rounded-md" />
        <Skeleton className="h-8 w-32 rounded-md" />
      </div>
      <div className="overflow-hidden rounded-xl border border-border p-3">
        <div className="mb-2 grid grid-cols-[13rem_repeat(12,1fr)] gap-1">
          <Skeleton className="h-4 w-16" />
          {Array.from({ length: 12 }, (_, i) => (
            <Skeleton key={i} className="mx-auto h-4 w-8" />
          ))}
        </div>
        {Array.from({ length: 7 }, (_, r) => (
          <div key={r} className="mb-1 grid grid-cols-[13rem_repeat(12,1fr)] items-center gap-1">
            <div className="flex items-center gap-2.5">
              <Skeleton className="h-[30px] w-[30px] rounded-full" />
              <div className="flex-1 space-y-1">
                <Skeleton className="h-3.5 w-3/4" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </div>
            {Array.from({ length: 12 }, (_, c) => (
              <Skeleton key={c} className="h-9 rounded-md" />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
