/** Всплывающие уведомления. */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import clsx from 'clsx';

export type ToastKind = 'success' | 'error' | 'info' | 'warning';

interface Toast {
  id: string;
  kind: ToastKind;
  title: string;
  description?: string;
}

interface ToastContextValue {
  push: (toast: Omit<Toast, 'id'>) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const KIND_STYLES: Record<ToastKind, string> = {
  success: 'border-success/40 bg-success/10',
  error: 'border-danger/50 bg-danger/10',
  info: 'border-white/15 bg-card',
  warning: 'border-accent/40 bg-accent/10',
};

const KIND_ICONS: Record<ToastKind, string> = {
  success: '✓',
  error: '✕',
  info: 'i',
  warning: '!',
};

export function ToastProvider({ children }: { children: ReactNode }): JSX.Element {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const remove = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (toast: Omit<Toast, 'id'>) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setToasts((current) => [...current.slice(-3), { ...toast, id }]);
      window.setTimeout(() => remove(id), toast.kind === 'error' ? 7000 : 4500);
    },
    [remove],
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      push,
      success: (title, description) => push({ kind: 'success', title, description }),
      error: (title, description) => push({ kind: 'error', title, description }),
      info: (title, description) => push({ kind: 'info', title, description }),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 top-2 z-[100] flex flex-col items-center gap-2 px-3 nav:inset-x-auto nav:right-4 nav:top-4 nav:items-end"
        role="status"
        aria-live="polite"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={clsx(
              'pointer-events-auto w-full max-w-sm animate-slide-in-right rounded-lg border p-3 shadow-card backdrop-blur',
              KIND_STYLES[toast.kind],
            )}
          >
            <div className="flex items-start gap-3">
              <span
                className={clsx(
                  'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xxs font-bold',
                  toast.kind === 'success' && 'bg-success text-black',
                  toast.kind === 'error' && 'bg-danger text-white',
                  toast.kind === 'info' && 'bg-white/20 text-white',
                  toast.kind === 'warning' && 'bg-accent text-black',
                )}
              >
                {KIND_ICONS[toast.kind]}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-white">{toast.title}</p>
                {toast.description ? <p className="mt-0.5 text-13 text-muted">{toast.description}</p> : null}
              </div>
              <button
                type="button"
                onClick={() => remove(toast.id)}
                className="shrink-0 text-muted transition-colors hover:text-white"
                aria-label="Закрыть уведомление"
              >
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast должен использоваться внутри ToastProvider');
  return context;
}
