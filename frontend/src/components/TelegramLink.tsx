/** Кнопка-ссылка на Telegram-канал площадки. */
import clsx from 'clsx';
import { TELEGRAM_HANDLE, TELEGRAM_URL } from '../lib/config';

interface TelegramLinkProps {
  className?: string;
  label?: string;
  showHandle?: boolean;
}

export function TelegramIcon({ className }: { className?: string }): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className={clsx('h-4 w-4', className)} fill="currentColor" aria-hidden="true">
      <path d="M21.9 4.3 18.8 19c-.2 1-.9 1.3-1.7.8l-4.7-3.5-2.3 2.2c-.3.3-.5.5-1 .5l.4-4.9 8.9-8c.4-.3-.1-.5-.6-.2L6.9 12.6l-4.7-1.5c-1-.3-1-1 .2-1.5l18.3-7c.9-.3 1.6.2 1.2 1.7Z" />
    </svg>
  );
}

export function TelegramLink({ className, label = 'Telegram', showHandle = false }: TelegramLinkProps): JSX.Element {
  return (
    <a
      href={TELEGRAM_URL}
      target="_blank"
      rel="noreferrer noopener"
      className={clsx('inline-flex items-center gap-2', className)}
    >
      <TelegramIcon />
      <span>{showHandle ? TELEGRAM_HANDLE : label}</span>
    </a>
  );
}
