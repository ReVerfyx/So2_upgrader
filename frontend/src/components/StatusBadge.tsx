/** Цветной значок статуса заявки, платежа или операции. */
import clsx from 'clsx';

type Status = 'pending' | 'processing' | 'completed' | 'rejected' | 'confirmed' | 'failed' | 'expired';

const STYLES: Record<Status, string> = {
  pending: 'bg-accent/15 text-accent',
  processing: 'bg-blue-500/15 text-blue-400',
  completed: 'bg-success/15 text-success',
  confirmed: 'bg-success/15 text-success',
  rejected: 'bg-danger/20 text-red-400',
  failed: 'bg-danger/20 text-red-400',
  expired: 'bg-white/10 text-muted',
};

export function StatusBadge({ status, label }: { status: string; label: string }): JSX.Element {
  return <span className={clsx('badge', STYLES[status as Status] ?? 'bg-white/10 text-muted')}>{label}</span>;
}
