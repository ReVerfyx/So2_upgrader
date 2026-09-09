/** Управление коэффициентами апгрейда и параметрами пополнения. */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, apiRequest } from '../../lib/api';
import { useToast } from '../../hooks/useToast';
import { RowsSkeleton } from '../../components/Skeleton';
import type { RateInfo } from '../../types/api';

interface SettingsResponse {
  settings: {
    upgrade?: {
      houseEdge: number;
      minChance: number;
      maxChance: number;
      maxMultiplier: number;
      minStakeMinor?: string;
    };
    deposit?: { minDepositNano: string; ttlMinutes: number; minConfirmations: number };
    rates?: {
      minorPerTon: string;
      marketRubPerTon?: number | null;
      spreadPercent?: number;
      auto?: boolean;
      source: string;
      updatedAt: string | null;
    };
    site?: { maintenance: boolean; announcement: string };
  };
}

/** Нанотоны → строка TON (минимальная сумма пополнения). */
const nanoToTon = (nano?: string): string => (nano ? String(Number(nano) / 1e9) : '0');

/** Копейки → строка монет. */
const minorToCoins = (minor?: string): string => (minor ? String(Number(minor) / 100) : '0');

export function AdminSettings(): JSX.Element {
  const toast = useToast();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: () => apiRequest<SettingsResponse>('/admin/settings'),
  });

  const [upgrade, setUpgrade] = useState({ houseEdge: 8, minChance: 0.5, maxChance: 85, maxMultiplier: 100, minStake: '0.1' });
  const [deposit, setDeposit] = useState({ minDeposit: '0.88', ttlMinutes: 30, minConfirmations: 1 });
  const [site, setSite] = useState({ maintenance: false, announcement: '' });
  const [rateForm, setRateForm] = useState({ auto: true, spreadPercent: 3, coinsPerTon: '350' });

  useEffect(() => {
    const data = query.data?.settings;
    if (!data) return;
    if (data.upgrade) {
      setUpgrade({
        houseEdge: Math.round(data.upgrade.houseEdge * 10000) / 100,
        minChance: Math.round(data.upgrade.minChance * 10000) / 100,
        maxChance: Math.round(data.upgrade.maxChance * 10000) / 100,
        maxMultiplier: data.upgrade.maxMultiplier,
        minStake: minorToCoins(data.upgrade.minStakeMinor),
      });
    }
    if (data.deposit) {
      setDeposit({
        minDeposit: nanoToTon(data.deposit.minDepositNano),
        ttlMinutes: data.deposit.ttlMinutes,
        minConfirmations: data.deposit.minConfirmations,
      });
    }
    if (data.site) setSite(data.site);
    if (data.rates) {
      setRateForm({
        auto: data.rates.auto ?? true,
        spreadPercent: data.rates.spreadPercent ?? 3,
        coinsPerTon: String(Number(data.rates.minorPerTon) / 100),
      });
    }
  }, [query.data]);

  const saveUpgrade = useMutation({
    mutationFn: () =>
      apiRequest('/admin/settings/upgrade', {
        method: 'PUT',
        body: {
          houseEdge: upgrade.houseEdge / 100,
          minChance: upgrade.minChance / 100,
          maxChance: upgrade.maxChance / 100,
          maxMultiplier: upgrade.maxMultiplier,
          minStake: upgrade.minStake,
        },
      }),
    onSuccess: () => {
      toast.success('Коэффициенты сохранены');
      void queryClient.invalidateQueries({ queryKey: ['admin', 'settings'] });
      void queryClient.invalidateQueries({ queryKey: ['upgrade-settings'] });
    },
    onError: (error) => toast.error('Ошибка', error instanceof ApiError ? error.message : undefined),
  });

  const saveDeposit = useMutation({
    mutationFn: () =>
      apiRequest('/admin/settings/deposit', {
        method: 'PUT',
        body: {
          minDepositTon: deposit.minDeposit,
          ttlMinutes: Number(deposit.ttlMinutes),
          minConfirmations: Number(deposit.minConfirmations),
        },
      }),
    onSuccess: () => {
      toast.success('Настройки пополнения сохранены');
      void queryClient.invalidateQueries({ queryKey: ['admin', 'settings'] });
      void queryClient.invalidateQueries({ queryKey: ['deposit-info'] });
    },
    onError: (error) => toast.error('Ошибка', error instanceof ApiError ? error.message : undefined),
  });

  const rateQuery = useQuery({
    queryKey: ['admin', 'rate'],
    queryFn: () => apiRequest<{ rate: RateInfo }>('/admin/settings/rates'),
    refetchInterval: 60_000,
  });

  const invalidateRates = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['admin', 'settings'] });
    void queryClient.invalidateQueries({ queryKey: ['admin', 'rate'] });
    void queryClient.invalidateQueries({ queryKey: ['deposit-info'] });
  };

  const saveRates = useMutation({
    mutationFn: () =>
      apiRequest<{ refreshFailures: Array<{ provider: string; message: string }> }>('/admin/settings/rates', {
        method: 'PUT',
        body: {
          auto: rateForm.auto,
          spreadPercent: rateForm.spreadPercent,
          coinsPerTon: rateForm.auto ? undefined : Number(rateForm.coinsPerTon.replace(',', '.')),
        },
      }),
    onSuccess: (data) => {
      if (data.refreshFailures?.length) {
        toast.info('Настройки сохранены', `Источники недоступны: ${data.refreshFailures.map((f) => f.provider).join(', ')}`);
      } else {
        toast.success('Настройки курса сохранены');
      }
      invalidateRates();
    },
    onError: (error) => toast.error('Ошибка', error instanceof ApiError ? error.message : undefined),
  });

  const refreshRate = useMutation({
    mutationFn: () => apiRequest<{ updated: boolean; message: string }>('/admin/settings/rates/refresh', { method: 'POST' }),
    onSuccess: (data) => {
      if (data.updated) toast.success('Курс обновлён', data.message);
      else toast.error('Курс не обновлён', data.message);
      invalidateRates();
    },
    onError: (error) => toast.error('Ошибка', error instanceof ApiError ? error.message : undefined),
  });

  const saveSite = useMutation({
    mutationFn: () => apiRequest('/admin/settings/site', { method: 'PUT', body: site }),
    onSuccess: () => {
      toast.success('Настройки сайта сохранены');
      void queryClient.invalidateQueries({ queryKey: ['config'] });
    },
    onError: (error) => toast.error('Ошибка', error instanceof ApiError ? error.message : undefined),
  });

  if (query.isLoading) return <RowsSkeleton count={4} height="h-24" />;

  // Пример: при комиссии 8% апгрейд x2 даёт шанс 46%
  const exampleChance = ((1 / 2) * (1 - upgrade.houseEdge / 100) * 100).toFixed(2);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="panel p-4">
        <h2 className="mb-1 font-display text-sm font-bold">Коэффициенты апгрейда</h2>
        <p className="mb-3 text-xxs leading-relaxed text-muted">
          Формула шанса: <code className="text-accent">(ставка / цель) × (1 − комиссия)</code>. Один и тот же расчёт
          используется и в предпросмотре, и в реальной игре. При комиссии {upgrade.houseEdge}% апгрейд x2 даёт шанс{' '}
          {exampleChance}%.
        </p>

        <div className="space-y-3">
          <div>
            <label className="label" htmlFor="houseEdge">
              Комиссия площадки, % ({upgrade.houseEdge}%)
            </label>
            <input
              id="houseEdge"
              type="range"
              min={0}
              max={30}
              step={0.5}
              value={upgrade.houseEdge}
              onChange={(event) => setUpgrade({ ...upgrade, houseEdge: Number(event.target.value) })}
              className="range-accent"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="minChance">
                Мин. шанс, %
              </label>
              <input
                id="minChance"
                className="input"
                type="number"
                step="0.1"
                min="0.01"
                max="50"
                value={upgrade.minChance}
                onChange={(event) => setUpgrade({ ...upgrade, minChance: Number(event.target.value) })}
              />
            </div>
            <div>
              <label className="label" htmlFor="maxChance">
                Макс. шанс, %
              </label>
              <input
                id="maxChance"
                className="input"
                type="number"
                step="1"
                min="5"
                max="95"
                value={upgrade.maxChance}
                onChange={(event) => setUpgrade({ ...upgrade, maxChance: Number(event.target.value) })}
              />
            </div>
            <div>
              <label className="label" htmlFor="maxMultiplier">
                Макс. коэффициент
              </label>
              <input
                id="maxMultiplier"
                className="input"
                type="number"
                step="1"
                min="2"
                max="1000"
                value={upgrade.maxMultiplier}
                onChange={(event) => setUpgrade({ ...upgrade, maxMultiplier: Number(event.target.value) })}
              />
            </div>
            <div>
              <label className="label" htmlFor="minStake">
                Мин. ставка, монет
              </label>
              <input
                id="minStake"
                className="input"
                value={upgrade.minStake}
                onChange={(event) => setUpgrade({ ...upgrade, minStake: event.target.value.replace(/[^\d.,]/g, '') })}
              />
            </div>
          </div>

          <button
            type="button"
            className="btn-primary w-full"
            disabled={saveUpgrade.isPending}
            onClick={() => saveUpgrade.mutate()}
          >
            Сохранить коэффициенты
          </button>
        </div>
      </section>

      <div className="space-y-4">
        <section className="panel p-4">
          <div className="mb-1 flex items-center justify-between gap-2">
            <h2 className="font-display text-sm font-bold">Курс TON → монеты</h2>
            <button
              type="button"
              className="btn-secondary btn-sm"
              disabled={refreshRate.isPending}
              onClick={() => refreshRate.mutate()}
            >
              {refreshRate.isPending ? 'Обновляем…' : 'Обновить сейчас'}
            </button>
          </div>

          <p className="mb-3 text-xxs leading-relaxed text-muted">
            Внутренняя валюта — монеты: <strong className="text-white">1 монета = 1 ₽</strong>. В автоматическом
            режиме курс берётся с биржевых источников (CoinGecko → tonapi.io → Binance + ЦБ РФ) и обновляется сам.
            Курс фиксируется в момент создания счёта, поэтому его изменение не влияет на выставленные счета.
          </p>

          {rateQuery.data?.rate ? (
            <dl className="mb-3 space-y-1.5 rounded-lg bg-dark p-3 text-13">
              <div className="flex justify-between">
                <dt className="text-muted">Текущий курс</dt>
                <dd className="font-semibold">
                  1 TON = {Number(rateQuery.data.rate.coinsPerTon).toLocaleString('ru-RU')} монет
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">Рыночный курс</dt>
                <dd>
                  {rateQuery.data.rate.marketRubPerTon
                    ? `${rateQuery.data.rate.marketRubPerTon.toFixed(2)} ₽`
                    : '—'}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">Источник</dt>
                <dd className={rateQuery.data.rate.stale ? 'text-danger' : ''}>
                  {rateQuery.data.rate.auto ? rateQuery.data.rate.source : 'ручной'}
                  {rateQuery.data.rate.ageMinutes !== null ? ` · ${rateQuery.data.rate.ageMinutes} мин назад` : ''}
                  {rateQuery.data.rate.stale ? ' · устарел' : ''}
                </dd>
              </div>
            </dl>
          ) : null}

          <div className="space-y-3">
            <label className="flex items-center gap-2 text-13">
              <input
                type="checkbox"
                checked={rateForm.auto}
                onChange={(event) => setRateForm({ ...rateForm, auto: event.target.checked })}
                className="h-4 w-4 accent-[#fbd506]"
              />
              Обновлять курс автоматически
            </label>

            <div>
              <label className="label" htmlFor="spread">
                Спред площадки, % ({rateForm.spreadPercent}%)
              </label>
              <input
                id="spread"
                type="range"
                min={0}
                max={20}
                step={0.5}
                value={rateForm.spreadPercent}
                onChange={(event) => setRateForm({ ...rateForm, spreadPercent: Number(event.target.value) })}
                className="range-accent"
              />
              <p className="mt-1 text-xxs text-muted">
                Курс зачисления ниже рыночного на эту величину — покрывает комиссию сети и колебания цены.
              </p>
            </div>

            {!rateForm.auto ? (
              <div>
                <label className="label" htmlFor="coinsPerTon">
                  Монет за 1 TON (ручной курс)
                </label>
                <input
                  id="coinsPerTon"
                  className="input"
                  inputMode="decimal"
                  value={rateForm.coinsPerTon}
                  onChange={(event) =>
                    setRateForm({ ...rateForm, coinsPerTon: event.target.value.replace(/[^\d.,]/g, '') })
                  }
                />
              </div>
            ) : null}

            <button
              type="button"
              className="btn-primary w-full"
              disabled={saveRates.isPending}
              onClick={() => saveRates.mutate()}
            >
              Сохранить настройки курса
            </button>
          </div>
        </section>

        <section className="panel p-4">
          <h2 className="mb-3 font-display text-sm font-bold">Пополнение</h2>
          <div className="space-y-3">
            <div>
              <label className="label" htmlFor="minDeposit">
                Минимальная сумма пополнения, TON
              </label>
              <input
                id="minDeposit"
                className="input"
                value={deposit.minDeposit}
                onChange={(event) => setDeposit({ ...deposit, minDeposit: event.target.value.replace(/[^\d.,]/g, '') })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="ttl">
                  Время жизни счёта, мин
                </label>
                <input
                  id="ttl"
                  className="input"
                  type="number"
                  min="5"
                  max="720"
                  value={deposit.ttlMinutes}
                  onChange={(event) => setDeposit({ ...deposit, ttlMinutes: Number(event.target.value) })}
                />
              </div>
              <div>
                <label className="label" htmlFor="confirmations">
                  Подтверждений
                </label>
                <input
                  id="confirmations"
                  className="input"
                  type="number"
                  min="1"
                  max="30"
                  value={deposit.minConfirmations}
                  onChange={(event) => setDeposit({ ...deposit, minConfirmations: Number(event.target.value) })}
                />
              </div>
            </div>
            <button
              type="button"
              className="btn-primary w-full"
              disabled={saveDeposit.isPending}
              onClick={() => saveDeposit.mutate()}
            >
              Сохранить
            </button>
          </div>
        </section>

        <section className="panel p-4">
          <h2 className="mb-3 font-display text-sm font-bold">Сайт</h2>
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-13">
              <input
                type="checkbox"
                checked={site.maintenance}
                onChange={(event) => setSite({ ...site, maintenance: event.target.checked })}
                className="h-4 w-4 accent-[#fbd506]"
              />
              Режим обслуживания
            </label>
            <div>
              <label className="label" htmlFor="announcement">
                Объявление в шапке
              </label>
              <input
                id="announcement"
                className="input"
                value={site.announcement}
                onChange={(event) => setSite({ ...site, announcement: event.target.value })}
                maxLength={300}
              />
            </div>
            <button
              type="button"
              className="btn-primary w-full"
              disabled={saveSite.isPending}
              onClick={() => saveSite.mutate()}
            >
              Сохранить
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
