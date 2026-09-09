/** Заглушка для пустых списков. */
import type { ReactNode } from 'react';

interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: string;
  action?: ReactNode;
}

export function EmptyState({ title, description, icon = '📦', action }: EmptyStateProps): JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-white/10 px-4 py-10 text-center">
      <span className="mb-3 text-3xl opacity-60" aria-hidden="true">
        {icon}
      </span>
      <p className="font-display text-sm font-semibold text-white">{title}</p>
      {description ? <p className="mt-1 max-w-sm text-13 text-muted">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
