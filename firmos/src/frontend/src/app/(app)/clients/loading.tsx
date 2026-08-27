import { Skeleton } from '@/components/ui/skeleton'

/** Loading skeleton for /clients - mirrors the filter bar + 48px rows. */
export default function ClientsLoading() {
  return (
    <div className="space-y-5 pb-10" aria-busy="true" aria-label="Loading clients">
      <div className="space-y-1.5">
        <Skeleton className="h-6 w-28" />
        <Skeleton className="h-3.5 w-72" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-8 min-w-52 flex-1" />
        <Skeleton className="h-8 w-36" />
        <Skeleton className="h-8 w-36" />
        <Skeleton className="h-8 w-44" />
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <Skeleton className="h-3 w-full max-w-md" />
        </div>
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex h-12 items-center gap-4 border-b border-border px-4 last:border-b-0">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="h-6 w-12 rounded-full" />
            <Skeleton className="ml-auto h-4 w-8" />
            <Skeleton className="h-8 w-8 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  )
}
