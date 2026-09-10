/**
 * Вход и регистрация.
 *
 * Доступные способы:
 *  - Google (OAuth 2.0) — если настроен на сервере;
 *  - логин и пароль площадки;
 *  - быстрый тестовый вход — только в тестовом режиме.
 *
 * Форма НИКОГДА не запрашивает пароль от игрового аккаунта Standoff 2.
 */
import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { ApiError, apiRequest, googleLoginUrl } from '../lib/api';
import { Logo } from '../components/Logo';

type Mode = 'login' | 'register';

export function LoginPage(): JSX.Element {
  const { isAuthenticated, config, login, register, refresh } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();

  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const from = (location.state as { from?: string } | null)?.from ?? '/';

  if (isAuthenticated) return <Navigate to={from} replace />;

  const handleSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      if (mode === 'login') {
        await login(username.trim(), password);
        toast.success('С возвращением!');
      } else {
        await register(username.trim(), password);
        toast.success('Аккаунт создан', 'Добро пожаловать в Upgrader Standoff 2');
      }
      navigate(from, { replace: true });
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'Не удалось выполнить вход';
      toast.error(mode === 'login' ? 'Ошибка входа' : 'Ошибка регистрации', message);
    } finally {
      setBusy(false);
    }
  };

  const handleTestLogin = async (): Promise<void> => {
    setBusy(true);
    try {
      const nickname = `tester${Math.floor(Math.random() * 10000)}`;
      await apiRequest('/auth/test-login', { method: 'POST', body: { username: nickname } });
      await refresh();
      toast.info('Вход в тестовом режиме', `Аккаунт ${nickname}`);
      navigate(from, { replace: true });
    } catch (error) {
      toast.error('Не удалось войти', error instanceof ApiError ? error.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center py-6">
      <div className="mb-6 scale-125">
        <Logo />
      </div>

      <div className="panel w-full p-5">
        <div className="mb-5 flex rounded-lg bg-dark p-1">
          {(['login', 'register'] as Mode[]).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setMode(value)}
              className={`flex-1 rounded-md py-2 text-13 font-semibold transition-colors ${
                mode === value ? 'bg-gradient-accent text-black' : 'text-muted hover:text-white'
              }`}
            >
              {value === 'login' ? 'Вход' : 'Регистрация'}
            </button>
          ))}
        </div>

        {config?.googleAuthEnabled ? (
          <>
            <a href={googleLoginUrl(from)} className="btn-secondary w-full">
              <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
                <path
                  fill="#4285F4"
                  d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.8-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8Z"
                />
                <path
                  fill="#34A853"
                  d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9H1.4v3.1C3.4 21.4 7.4 24 12 24Z"
                />
                <path fill="#FBBC05" d="M5.4 14.4c-.2-.7-.4-1.5-.4-2.4s.1-1.6.4-2.4V6.6H1.4A12 12 0 0 0 0 12c0 1.9.5 3.8 1.4 5.4l4-3Z" />
                <path
                  fill="#EA4335"
                  d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4C17.9 1.2 15.2 0 12 0 7.4 0 3.4 2.6 1.4 6.6l4 3.1C6.3 6.9 8.9 4.8 12 4.8Z"
                />
              </svg>
              Продолжить с Google
            </a>

            <div className="my-4 flex items-center gap-3">
              <span className="h-px flex-1 bg-white/10" />
              <span className="text-xxs uppercase tracking-widest text-muted">или</span>
              <span className="h-px flex-1 bg-white/10" />
            </div>
          </>
        ) : null}

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="label" htmlFor="username">
              Логин
            </label>
            <input
              id="username"
              className="input"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="от 3 до 32 символов"
              autoComplete="username"
              minLength={3}
              maxLength={32}
              required
            />
          </div>

          <div>
            <label className="label" htmlFor="password">
              Пароль
            </label>
            <input
              id="password"
              type="password"
              className="input"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="не менее 8 символов"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              minLength={8}
              maxLength={128}
              required
            />
          </div>

          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy ? 'Подождите…' : mode === 'login' ? 'Войти' : 'Создать аккаунт'}
          </button>
        </form>

        {config?.testMode ? (
          <button type="button" onClick={handleTestLogin} className="btn-ghost mt-3 w-full" disabled={busy}>
            Быстрый вход для теста
          </button>
        ) : null}

        <p className="mt-5 text-center text-xxs leading-relaxed text-muted">
          Это отдельный аккаунт площадки. Мы никогда не запрашиваем пароль от вашего игрового аккаунта Standoff 2
          и не имеем доступа к нему.
        </p>
      </div>
    </div>
  );
}
