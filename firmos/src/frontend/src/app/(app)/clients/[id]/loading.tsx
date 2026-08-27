import { Skeleton } from '@/components/ui/skeleton'

/** Loading skeleton for /clients/[id] - mirrors the header + tab bar. */
export default function ClientDetailLoading() {
  return (
    <div className="space-y-5 pb-10" aria-busy="true" aria-label="Loading client">
      <Skeleton className="h-4 w-24" />
      <div className="rounded-xl border border-border bg-card px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <Skeleton className="h-6 w-56" />
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
            <Skeleton className="h-3.5 w-40" />
          </div>
          <div className="flex items-center gap-6">
            <Skeleton className="h-7 w-16 rounded-full" />
            <Skeleton className="h-9 w-28" />
            <Skeleton className="h-9 w-24" />
          </div>
        </div>
      </div>
      <Skeleton className="h-9 w-full max-w-xl" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-56 rounded-xl" />
        <Skeleton className="h-56 rounded-xl" />
      </div>
    </div>
  )
}
