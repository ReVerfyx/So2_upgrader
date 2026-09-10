/**
 * Круг апгрейда со стрелкой.
 *
 * ВАЖНО: анимация НИЧЕГО не решает. Результат (позиция броска в миллионных
 * долях) приходит с сервера и передаётся в проп `result`. Стрелка лишь
 * доезжает до этой позиции:
 *
 *   угол = 360° × (бросок / 1 000 000)
 *
 * Зелёный сектор — заявленный шанс. Если стрелка остановилась внутри сектора,
 * значит бросок оказался меньше шанса, то есть апгрейд успешен. Пользователь
 * видит это глазами и может перепроверить расчёт в разделе честности.
 *
 * Фазы анимации повторяют оригинал: быстрое вращение → замедление → остановка.
 */
import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { formatPercent } from '../lib/format';

export type WheelPhase = 'idle' | 'spinning' | 'slowing' | 'result';

interface UpgradeWheelProps {
  /** Шанс успеха в процентах (0–100) — размер зелёного сектора. */
  chancePercent: number;
  /** Позиция броска в процентах (0–100). Приходит с сервера. */
  resultPercent: number | null;
  /** Успешен ли апгрейд (решает сервер). */
  success: boolean | null;
  /** Запустить анимацию (увеличивайте счётчик для повторного запуска). */
  runId: number;
  onPhaseChange?: (phase: WheelPhase) => void;
  onFinish?: () => void;
  size?: number;
  children?: React.ReactNode;
}

/** Длительности фаз, мс. */
const FAST_SPIN_MS = 1100;
const SLOWDOWN_MS = 2400;
/** Сколько полных оборотов «накручивается» до остановки. */
const EXTRA_TURNS = 4;

const easeOutQuart = (t: number): number => 1 - Math.pow(1 - t, 4);

export function UpgradeWheel({
  chancePercent,
  resultPercent,
  success,
  runId,
  onPhaseChange,
  onFinish,
  size = 260,
  children,
}: UpgradeWheelProps): JSX.Element {
  const [angle, setAngle] = useState(0);
  const [phase, setPhase] = useState<WheelPhase>('idle');
  const frameRef = useRef<number | null>(null);
  const startAngleRef = useRef(0);

  useEffect(() => {
    if (runId === 0 || resultPercent === null) return undefined;

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const finalAngle = (resultPercent / 100) * 360;
    const startAngle = startAngleRef.current % 360;
    const targetAngle = startAngle + EXTRA_TURNS * 360 + ((finalAngle - startAngle) % 360 + 360) % 360;

    if (prefersReducedMotion) {
      setAngle(finalAngle);
      startAngleRef.current = finalAngle;
      setPhase('result');
      onPhaseChange?.('result');
      onFinish?.();
      return undefined;
    }

    const startTime = performance.now();
    setPhase('spinning');
    onPhaseChange?.('spinning');

    // Угол, до которого дойдёт быстрая фаза (равномерное вращение).
    const fastPortion = 0.55;
    const fastEndAngle = startAngle + (targetAngle - startAngle) * fastPortion;

    const tick = (now: number): void => {
      const elapsed = now - startTime;

      if (elapsed < FAST_SPIN_MS) {
        const progress = elapsed / FAST_SPIN_MS;
        setAngle(startAngle + (fastEndAngle - startAngle) * progress);
        frameRef.current = requestAnimationFrame(tick);
        return;
      }

      const slowElapsed = elapsed - FAST_SPIN_MS;
      if (slowElapsed < SLOWDOWN_MS) {
        if (phase !== 'slowing') {
          setPhase('slowing');
          onPhaseChange?.('slowing');
        }
        const progress = easeOutQuart(slowElapsed / SLOWDOWN_MS);
        setAngle(fastEndAngle + (targetAngle - fastEndAngle) * progress);
        frameRef.current = requestAnimationFrame(tick);
        return;
      }

      setAngle(targetAngle);
      startAngleRef.current = targetAngle;
      setPhase('result');
      onPhaseChange?.('result');
      onFinish?.();
    };

    frameRef.current = requestAnimationFrame(tick);

    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  const radius = size / 2 - 14;
  const circumference = 2 * Math.PI * radius;
  const chanceLength = (Math.min(Math.max(chancePercent, 0), 100) / 100) * circumference;
  const isSpinning = phase === 'spinning' || phase === 'slowing';

  return (
    <div
      className="relative select-none"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`Круг апгрейда, шанс ${formatPercent(chancePercent)}`}
    >
      <svg viewBox={`0 0 ${size} ${size}`} className="h-full w-full -rotate-90">
        {/* Фон круга */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#202022"
          strokeWidth={12}
          strokeLinecap="round"
        />
        {/* Сектор шанса */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="url(#wheel-gradient)"
          strokeWidth={12}
          strokeLinecap="round"
          strokeDasharray={`${chanceLength} ${circumference - chanceLength}`}
          className="transition-[stroke-dasharray] duration-500 ease-out"
        />
        <defs>
          <linearGradient id="wheel-gradient" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#fbd506" />
            <stop offset="50%" stopColor="#ffdd23" />
            <stop offset="100%" stopColor="#fbd506" />
          </linearGradient>
        </defs>
      </svg>

      {/* Стрелка */}
      <div
        className="absolute inset-0 flex items-start justify-center"
        style={{
          transform: `rotate(${angle}deg)`,
          willChange: 'transform',
        }}
      >
        <div className="flex flex-col items-center" style={{ marginTop: 1 }}>
          <div
            className={clsx(
              'h-0 w-0 border-x-[7px] border-b-[16px] border-x-transparent transition-colors duration-300',
              phase === 'result' && success === true && 'border-b-success',
              phase === 'result' && success === false && 'border-b-danger',
              (phase !== 'result' || success === null) && 'border-b-white',
            )}
          />
          <div
            className={clsx(
              'h-3 w-[3px] rounded-b transition-colors duration-300',
              phase === 'result' && success === true && 'bg-success',
              phase === 'result' && success === false && 'bg-danger',
              (phase !== 'result' || success === null) && 'bg-white',
            )}
          />
        </div>
      </div>

      {/* Центр круга */}
      <div className="absolute inset-0 flex flex-col items-center justify-center px-8 text-center">
        {children ?? (
          <>
            <span
              className={clsx(
                'font-display text-3xl font-bold tabular-nums transition-colors duration-300',
                phase === 'result' && success === true && 'text-success',
                phase === 'result' && success === false && 'text-danger',
                (phase !== 'result' || success === null) && 'text-gradient-accent',
              )}
            >
              {formatPercent(chancePercent)}
            </span>
            <span className="mt-1 text-xxs uppercase tracking-widest text-muted">
              {isSpinning ? 'Определяем результат' : 'Шанс успеха'}
            </span>
          </>
        )}
      </div>

      {/* Свечение во время вращения */}
      {isSpinning ? (
        <div className="pointer-events-none absolute inset-0 animate-pulse-glow rounded-full" aria-hidden="true" />
      ) : null}
    </div>
  );
}
