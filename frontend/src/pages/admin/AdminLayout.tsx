/** Каркас админ-панели с боковым меню. */
import { NavLink, Outlet } from 'react-router-dom';
import clsx from 'clsx';
import { Link } from 'react-router-dom';

const ADMIN_LINKS = [
  { to: '/admin', label: 'Сводка', end: true },
  { to: '/admin/users', label: 'Пользователи' },
  { to: '/admin/withdrawals', label: 'Выводы' },
  { to: '/admin/deposits', label: 'Пополнения' },
  { to: '/admin/items', label: 'Предметы' },
  { to: '/admin/upgrades', label: 'Апгрейды' },
  { to: '/admin/settings', label: 'Коэффициенты' },
  { to: '/admin/logs', label: 'Журналы' },
];

export function AdminLayout(): JSX.Element {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-xl font-extrabold">
          Админ-панель <span className="text-gradient-accent">STOCK2</span>
        </h1>
        <Link to="/" className="btn-secondary btn-sm">
          ← На сайт
        </Link>
      </div>

      <nav className="no-scrollbar -mx-3 flex gap-2 overflow-x-auto px-3 sm:mx-0 sm:px-0">
        {ADMIN_LINKS.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            end={link.end}
            className={({ isActive }) =>
              clsx(
                'shrink-0 rounded-lg px-3.5 py-2 text-13 font-semibold transition-colors',
                isActive ? 'bg-gradient-accent text-black' : 'bg-dark text-muted hover:text-white',
              )
            }
          >
            {link.label}
          </NavLink>
        ))}
      </nav>

      <Outlet />
    </div>
  );
}
