/** Постраничная навигация. */
import clsx from 'clsx';

interface PaginationProps {
  total: number;
  limit: number;
  offset: number;
  onChange: (offset: number) => void;
}

export function Pagination({ total, limit, offset, onChange }: PaginationProps): JSX.Element | null {
  const pages = Math.ceil(total / limit);
  if (pages <= 1) return null;

  const current = Math.floor(offset / limit) + 1;
  const canPrev = current > 1;
  const canNext = current < pages;

  return (
    <div className="mt-4 flex items-center justify-center gap-2">
      <button
        type="button"
        className="btn-secondary btn-sm"
        disabled={!canPrev}
        onClick={() => onChange(Math.max(0, offset - limit))}
      >
        ← Назад
      </button>
      <span className={clsx('px-3 text-13 text-muted tabular-nums')}>
        {current} / {pages}
      </span>
      <button
        type="button"
        className="btn-secondary btn-sm"
        disabled={!canNext}
        onClick={() => onChange(offset + limit)}
      >
        Вперёд →
      </button>
    </div>
  );
}
