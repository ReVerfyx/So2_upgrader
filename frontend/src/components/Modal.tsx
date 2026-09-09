/**
 * Модальное окно.
 * На мобильных открывается «шторкой» снизу, на десктопе — по центру.
 * Закрывается по Esc, клику по фону и кнопке.
 */
import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /** Запретить закрытие (например, во время анимации апгрейда). */
  locked?: boolean;
}

const SIZES = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-3xl',
} as const;

export function Modal({ open, onClose, title, children, footer, size = 'md', locked = false }: ModalProps): JSX.Element | null {
  useEffect(() => {
    if (!open) return undefined;

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !locked) onClose();
    };

    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose, locked]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
      <div
        className="absolute inset-0 animate-fade-in bg-black/50 backdrop-blur-sm"
        onClick={() => !locked && onClose()}
        aria-hidden="true"
      />
      <div
        className={clsx(
          'relative z-10 flex max-h-[92dvh] w-full animate-scale-in flex-col overflow-hidden',
          'rounded-t-2xl border border-white/10 bg-block sm:rounded-2xl',
          SIZES[size],
        )}
      >
        {title ? (
          <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
            <h2 className="font-display text-base font-bold">{title}</h2>
            {!locked ? (
              <button
                type="button"
                onClick={onClose}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-white/5 hover:text-white"
                aria-label="Закрыть"
              >
                ✕
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="scrollbar-thin flex-1 overflow-y-auto p-4">{children}</div>

        {footer ? <div className="border-t border-white/[0.06] p-4">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
