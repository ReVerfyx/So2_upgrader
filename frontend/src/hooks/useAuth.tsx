/** Контекст авторизации: текущий пользователь, баланс, вход и выход. */
import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest, ApiError } from '../lib/api';
import type { AppConfig, Me } from '../types/api';

interface AuthContextValue {
  me: Me | null;
  config: AppConfig | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isAdmin: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string, displayName?: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const queryClient = useQueryClient();

  const configQuery = useQuery({
    queryKey: ['config'],
    queryFn: () => apiRequest<AppConfig>('/config'),
    staleTime: 5 * 60_000,
  });

  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await apiRequest<Me>('/user');
      } catch (error) {
        // 401 — просто «не авторизован», это не ошибка приложения.
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    staleTime: 15_000,
    retry: false,
  });

  const loginMutation = useMutation({
    mutationFn: (input: { username: string; password: string }) =>
      apiRequest('/auth/login', { method: 'POST', body: input }),
    onSuccess: () => queryClient.invalidateQueries(),
  });

  const registerMutation = useMutation({
    mutationFn: (input: { username: string; password: string; displayName?: string }) =>
      apiRequest('/auth/register', { method: 'POST', body: input }),
    onSuccess: () => queryClient.invalidateQueries(),
  });

  const logoutMutation = useMutation({
    mutationFn: () => apiRequest('/auth/logout', { method: 'POST' }),
    onSuccess: () => {
      queryClient.setQueryData(['me'], null);
      queryClient.invalidateQueries();
    },
  });

  const login = useCallback(
    async (username: string, password: string) => {
      await loginMutation.mutateAsync({ username, password });
    },
    [loginMutation],
  );

  const register = useCallback(
    async (username: string, password: string, displayName?: string) => {
      await registerMutation.mutateAsync({ username, password, displayName });
    },
    [registerMutation],
  );

  const logout = useCallback(async () => {
    await logoutMutation.mutateAsync();
  }, [logoutMutation]);

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['me'] });
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({
      me: meQuery.data ?? null,
      config: configQuery.data ?? null,
      isLoading: meQuery.isLoading || configQuery.isLoading,
      isAuthenticated: Boolean(meQuery.data),
      isAdmin: meQuery.data?.user.role === 'admin',
      login,
      register,
      logout,
      refresh,
    }),
    [meQuery.data, meQuery.isLoading, configQuery.data, configQuery.isLoading, login, register, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth должен использоваться внутри AuthProvider');
  return context;
}
