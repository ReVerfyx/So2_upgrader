/** Состояния загрузки: анимированные заглушки в стиле референса. */
import clsx from 'clsx';

export function Skeleton({ className }: { className?: string }): JSX.Element {
  return <div className={clsx('skeleton', className)} aria-hidden="true" />;
}

export function ItemCardSkeleton(): JSX.Element {
  return (
    <div className="panel-card overflow-hidden p-2">
      <Skeleton className="mb-2 aspect-[4/3] w-full rounded-md" />
      <Skeleton className="mb-1.5 h-3 w-3/4" />
      <Skeleton className="h-4 w-1/2" />
    </div>
  );
}

export function ItemGridSkeleton({ count = 8 }: { count?: number }): JSX.Element {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {Array.from({ length: count }).map((_, index) => (
        <ItemCardSkeleton key={index} />
      ))}
    </div>
  );
}

export function RowsSkeleton({ count = 5, height = 'h-14' }: { count?: number; height?: string }): JSX.Element {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, index) => (
        <Skeleton key={index} className={clsx('w-full rounded-lg', height)} />
      ))}
    </div>
  );
}

export function StatSkeleton(): JSX.Element {
  return (
    <div className="panel p-4">
      <Skeleton className="mb-2 h-3 w-24" />
      <Skeleton className="h-6 w-32" />
    </div>
  );
}
