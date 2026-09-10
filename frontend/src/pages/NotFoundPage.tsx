/** Страница 404. */
import { Link } from 'react-router-dom';

export function NotFoundPage(): JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <p className="font-display text-6xl font-extrabold text-gradient-accent">404</p>
      <h1 className="mt-3 font-display text-lg font-bold">Страница не найдена</h1>
      <p className="mt-1 max-w-sm text-13 text-muted">
        Возможно, ссылка устарела или страница была перемещена.
      </p>
      <Link to="/" className="btn-primary mt-5">
        На главную
      </Link>
    </div>
  );
}
