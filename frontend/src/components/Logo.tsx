/** Логотип площадки. */
import { Link } from 'react-router-dom';
import { BRAND_NAME, BRAND_TAGLINE } from '../lib/config';

export function Logo({ compact = false }: { compact?: boolean }): JSX.Element {
  return (
    <Link to="/" className="flex items-center gap-2" aria-label="На главную">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-accent">
        <svg viewBox="0 0 24 24" className="h-5 w-5 text-black" aria-hidden="true">
          <path d="M12 3.5 20 14h-5v6.5H9V14H4l8-10.5Z" fill="currentColor" />
        </svg>
      </span>
      {!compact ? (
        <span className="font-display text-base font-extrabold leading-none">
          {BRAND_NAME}
          <span className="mt-0.5 block whitespace-nowrap text-[0.5rem] font-medium tracking-[0.14em] text-muted sm:text-xxs sm:tracking-[0.18em]">
            {BRAND_TAGLINE}
          </span>
        </span>
      ) : null}
    </Link>
  );
}
