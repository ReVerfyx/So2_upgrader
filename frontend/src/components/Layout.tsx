/**
 * Каркас приложения: шапка, боковое меню на десктопе,
 * нижняя навигация на мобильных (крупные зоны нажатия).
 */
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import clsx from 'clsx';
import { useAuth } from '../hooks/useAuth';
import { Logo } from './Logo';
import { TelegramLink } from './TelegramLink';
import { BRAND_NAME } from '../lib/config';
import { Money } from './Money';
import { Skeleton } from './Skeleton';

interface NavItem {
  to: string;
  label: string;
  icon: JSX.Element;
  /** Показывать в нижней навигации мобильной версии. */
  mobile?: boolean;
  authOnly?: boolean;
}

const icon = (path: string): JSX.Element => (
  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
    <path d={path} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Главная', icon: icon('M3 10.5 12 3l9 7.5M5 9.5V21h14V9.5'), mobile: true },
  { to: '/upgrade', label: 'Апгрейд', icon: icon('M12 20V6m0 0-6 6m6-6 6 6'), mobile: true },
  { to: '/inventory', label: 'Инвентарь', icon: icon('M3 7h18v13H3zM3 7l2-3h14l2 3M9 12h6'), mobile: true, authOnly: true },
  { to: '/balance', label: 'Баланс', icon: icon('M3 7h18v10H3zM3 11h18M7 15h3'), mobile: true, authOnly: true },
  { to: '/profile', label: 'Профиль', icon: icon('M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21a8 8 0 0 1 16 0'), mobile: true, authOnly: true },
  { to: '/deposit', label: 'Пополнение', icon: icon('M12 4v12m0 0-4-4m4 4 4-4M4 20h16'), authOnly: true },
  { to: '/withdraw', label: 'Вывод', icon: icon('M12 20V8m0 0-4 4m4-4 4 4M4 4h16'), authOnly: true },
  { to: '/history', label: 'История', icon: icon('M12 7v5l3 2M3 12a9 9 0 1 0 9-9 9 9 0 0 0-9 9Z'), authOnly: true },
];

function NavIconLink({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }): JSX.Element {
  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      onClick={onNavigate}
      className={({ isActive }) =>
        clsx(
          'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
          isActive ? 'bg-white/[0.07] text-accent' : 'text-muted hover:bg-white/5 hover:text-white',
        )
      }
    >
      {item.icon}
      <span>{item.label}</span>
    </NavLink>
  );
}

export function Layout(): JSX.Element {
  const { me, isAuthenticated, isAdmin, isLoading, config } = useAuth();
  const location = useLocation();

  const visibleItems = NAV_ITEMS.filter((item) => !item.authOnly || isAuthenticated);
  const mobileItems = visibleItems.filter((item) => item.mobile).slice(0, 5);

  return (
    <div className="flex min-h-[100dvh] flex-col bg-night">
      {/* Объявление администрации */}
      {config?.announcement ? (
        <div className="bg-gradient-accent px-3 py-1.5 text-center text-13 font-semibold text-black">
          {config.announcement}
        </div>
      ) : null}

      {config?.testMode ? (
        <div className="bg-danger/20 px-3 py-1 text-center text-xxs font-semibold uppercase tracking-wide text-red-300">
          Тестовый режим — операции не настоящие
        </div>
      ) : null}

      {/* Шапка */}
      <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-block/95 backdrop-blur">
        <div className="container-app flex h-14 items-center justify-between gap-3">
          <Logo />

          <nav className="hidden items-center gap-1 nav:flex">
            {visibleItems.slice(0, 6).map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  clsx(
                    'rounded-lg px-3 py-2 text-13 font-semibold transition-colors',
                    isActive ? 'bg-white/[0.07] text-accent' : 'text-muted hover:text-white',
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            {isLoading ? (
              <Skeleton className="h-9 w-28 rounded-lg" />
            ) : isAuthenticated && me ? (
              <>
                <NavLink
                  to="/balance"
                  className="flex h-9 items-center gap-2 rounded-lg border border-white/10 bg-dark px-3 transition-colors hover:border-accent/40"
                >
                  <Money value={me.balance} size="sm" />
                </NavLink>
                <NavLink to="/deposit" className="btn-primary btn-sm hidden sm:inline-flex">
                  Пополнить
                </NavLink>
                <NavLink
                  to="/profile"
                  className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-dark"
                  aria-label="Профиль"
                >
                  {me.user.avatarUrl ? (
                    <img src={me.user.avatarUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="font-display text-13 font-bold text-accent">
                      {me.user.displayName.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                </NavLink>
              </>
            ) : (
              <NavLink to="/login" state={{ from: location.pathname }} className="btn-primary btn-sm">
                Войти
              </NavLink>
            )}
          </div>
        </div>
      </header>

      <div className="container-app flex flex-1 gap-4 py-4">
        {/* Боковое меню только на широких экранах */}
        <aside className="hidden w-52 shrink-0 xl:block">
          <div className="panel sticky top-[4.5rem] p-2">
            <nav className="flex flex-col gap-0.5">
              {visibleItems.map((item) => (
                <NavIconLink key={item.to} item={item} />
              ))}
              {isAdmin ? (
                <NavLink
                  to="/admin"
                  className={({ isActive }) =>
                    clsx(
                      'mt-2 flex items-center gap-3 rounded-lg border border-accent/30 px-3 py-2.5 text-sm font-semibold transition-colors',
                      isActive ? 'bg-accent/10 text-accent' : 'text-accent/80 hover:bg-accent/10',
                    )
                  }
                >
                  {icon('M12 3 4 7v6c0 4.4 3.4 7.6 8 8 4.6-.4 8-3.6 8-8V7l-8-4Z')}
                  <span>Админ-панель</span>
                </NavLink>
              ) : null}
            </nav>
          </div>
        </aside>

        <main className="min-w-0 flex-1 pb-20 nav:pb-4">
          <Outlet />
        </main>
      </div>

      {/* Подвал */}
      <footer className="border-t border-white/[0.06] bg-block pb-20 pt-6 nav:pb-6">
        <div className="container-app flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Logo />
            <p className="mt-2 max-w-md text-xxs leading-relaxed text-muted">
              Развлекательная площадка апгрейда игровых предметов. Вероятности рассчитываются сервером и доступны
              для самостоятельной проверки. Выдача предметов выполняется оператором вручную.
            </p>
          </div>

          <div className="flex flex-col gap-2 text-13 sm:items-end">
            <TelegramLink className="btn-secondary btn-sm" label="Наш Telegram" />
            <span className="text-xxs text-muted">© {new Date().getFullYear()} {BRAND_NAME}</span>
          </div>
        </div>
      </footer>

      {/* Нижняя навигация для мобильных */}
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-white/[0.06] bg-block/95 backdrop-blur nav:hidden">
        <div className="flex items-stretch justify-around">
          {mobileItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                clsx(
                  'flex flex-1 flex-col items-center justify-center gap-1 py-2 text-xxs font-medium transition-colors',
                  isActive ? 'text-accent' : 'text-muted',
                )
              }
              // Крупная зона нажатия: не меньше 56px по высоте
              style={{ minHeight: '3.5rem' }}
            >
              {item.icon}
              <span>{item.label}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
