import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Статические файлы (изображения предметов) лежат в общей папке /public
// в корне репозитория, чтобы их могли использовать и бэкенд, и фронтенд.
export default defineConfig({
  plugins: [react()],
  publicDir: path.resolve(__dirname, '..', 'public'),
  server: {
    port: 5173,
    host: true,
    proxy: {
      // В разработке API проксируется, чтобы cookie считались «своими».
      '/api': {
        target: process.env.VITE_API_PROXY || 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          query: ['@tanstack/react-query'],
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
