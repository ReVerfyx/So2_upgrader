/**
 * Дизайн-система Upgrader Standoff 2.
 * Палитра и типографика соответствуют референсу upgrader.vip:
 * тёмный фон #101012, блоки #17181c, карточки #232325, акцент — жёлтый #fbd506.
 */
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        night: '#101012',
        block: '#17181c',
        card: '#232325',
        dark: '#202022',
        line: '#2c2c30',
        muted: '#a7a7a7',
        accent: {
          DEFAULT: '#fbd506',
          light: '#ffdd23',
          dark: '#d3b300',
        },
        danger: '#c20000',
        success: '#4ade80',
        // Цвета редкости предметов Standoff 2
        rarity: {
          common: '#9aa4b8',
          rare: '#4d8cff',
          epic: '#a259ff',
          legendary: '#ff9d2e',
          arcane: '#ff4d6d',
          contraband: '#ffdd55',
        },
      },
      fontFamily: {
        sans: ['"Exo 2"', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        display: ['Tektur', '"Exo 2"', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        xxs: ['0.625rem', { lineHeight: '0.875rem' }],
        13: ['0.8125rem', { lineHeight: '1.125rem' }],
      },
      screens: {
        // Ключевой брейкпоинт референса: ниже 860px — мобильная компоновка
        nav: '860px',
      },
      backgroundImage: {
        'gradient-accent': 'linear-gradient(93deg, #fbd506 0%, #ffdd23 50%, #fbd506 100%)',
        'gradient-chosen': 'linear-gradient(93deg, rgba(211,179,0,0.4) 1.16%, rgba(168,142,0,0.4) 50%, rgba(211,179,0,0.4) 100%)',
        'gradient-card': 'linear-gradient(180deg, rgba(254,219,27,0) 0%, rgba(254,219,27,0.35) 100%)',
        'gradient-block': 'linear-gradient(180deg, #1c1d22 0%, #17181c 100%)',
      },
      boxShadow: {
        glow: '0 4px 20px rgba(255, 215, 0, 0.4)',
        'glow-strong': '0 4px 28px rgba(255, 215, 0, 0.6)',
        card: '0 8px 24px rgba(0, 0, 0, 0.45)',
      },
      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '100%' },
          '100%': { backgroundPosition: '-100%' },
        },
        'pulse-glow': {
          '0%, 100%': { boxShadow: '0 4px 20px rgba(255,215,0,0.4)' },
          '50%': { boxShadow: '0 4px 25px rgba(255,215,0,0.6)' },
        },
        'pulse-accent': {
          '0%, 100%': { borderColor: 'rgba(255,255,255,0.1)', boxShadow: 'none' },
          '50%': { borderColor: '#fbd506', boxShadow: '0 0 10px rgba(251,213,6,0.3)' },
        },
        'win-card': {
          '0%': { transform: 'scale(0)' },
          '50%': { transform: 'scale(1.35)' },
          '100%': { transform: 'scale(1)' },
        },
        'win-image': {
          '0%': { transform: 'scale(0)' },
          '50%': { transform: 'scale(1.8)' },
          '100%': { transform: 'scale(1)' },
        },
        'overlay-fade': {
          '0%': { opacity: '1' },
          '50%': { opacity: '0.8' },
          '100%': { opacity: '0' },
        },
        'result-shake': {
          '0%': { transform: 'rotate(0deg)' },
          '33%': { transform: 'rotate(-10deg)' },
          '66%': { transform: 'rotate(10deg)' },
          '100%': { transform: 'rotate(0deg)' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'scale-in': {
          '0%': { opacity: '0', transform: 'scale(0.9) translateY(16px)' },
          '100%': { opacity: '1', transform: 'scale(1) translateY(0)' },
        },
        'slide-up': {
          '0%': { opacity: '0', transform: 'translateY(24px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in-right': {
          '0%': { opacity: '0', transform: 'translateX(32px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
      },
      animation: {
        shimmer: 'shimmer 1.2s infinite linear',
        'pulse-glow': 'pulse-glow 2s ease-in-out infinite',
        'pulse-accent': 'pulse-accent 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'win-card': 'win-card 0.9s ease-in-out',
        'win-image': 'win-image 0.9s ease-in-out',
        'overlay-fade': 'overlay-fade 1s ease-in-out forwards',
        'result-shake': 'result-shake 2.4s cubic-bezier(0.25,0.46,0.45,0.94) 0.9s',
        'fade-in': 'fade-in 0.3s cubic-bezier(0.4,0,0.2,1) forwards',
        'scale-in': 'scale-in 0.3s cubic-bezier(0.4,0,0.2,1) forwards',
        'slide-up': 'slide-up 0.4s cubic-bezier(0.4,0,0.2,1) forwards',
        'slide-in-right': 'slide-in-right 0.3s cubic-bezier(0.4,0,0.2,1) forwards',
      },
    },
  },
  plugins: [],
};
