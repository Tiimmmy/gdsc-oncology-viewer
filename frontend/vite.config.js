import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Frontend dev server proxies /api to the FastAPI backend on :8000
export default defineConfig({
  plugins: [react()],
  server: {
    // Fixed port so the URL is stable; override with `npm run dev -- --port N`.
    port: Number(process.env.FRONTEND_PORT) || 5273,
    strictPort: false,
    proxy: {
      '/api': {
        target: process.env.VITE_API_BASE || 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: Number(process.env.FRONTEND_PORT) || 5273,
  },
});
