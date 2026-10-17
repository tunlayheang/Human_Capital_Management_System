import path from 'path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const configDir = path.dirname(fileURLToPath(import.meta.url));

/** Read `PORT=` from backend/.env so the dev proxy matches `npm --prefix backend run dev` without manual sync. */
function backendOriginFromBackendDotenv(): string | null {
  const candidates = [
    path.resolve(configDir, '../backend/.env'),
    path.resolve(process.cwd(), 'backend/.env'),
    path.resolve(process.cwd(), '../backend/.env'),
  ];
  for (const envPath of candidates) {
    try {
      const raw = fs.readFileSync(envPath, 'utf8');
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const m = trimmed.match(/^PORT\s*=\s*(\d+)\s*$/i);
        if (m) return `http://127.0.0.1:${m[1]}`;
      }
    } catch {
      /* try next candidate */
    }
  }
  return null;
}

/** If loadEnv misses .env (edge cases), read VITE_DEV_BACKEND_URL from frontend/.env directly. */
function viteDevBackendUrlFromFs(): string | null {
  try {
    const raw = fs.readFileSync(path.resolve(configDir, '.env'), 'utf8');
    const m = raw.match(/^\s*VITE_DEV_BACKEND_URL\s*=\s*(\S+)/im);
    if (!m) return null;
    const v = m[1].trim().replace(/^["']|["']$/g, '');
    return v || null;
  } catch {
    return null;
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, configDir, '');
  const explicitBackend =
    (env.VITE_DEV_BACKEND_URL || '').trim() || (viteDevBackendUrlFromFs() || '').trim();
  const fromDotenv = backendOriginFromBackendDotenv();
  // Never default proxy to :3000 — Vite often listens there; proxying to self yields 404 on /api/*.
  const backendTarget = explicitBackend || fromDotenv || 'http://127.0.0.1:4000';

  if (!explicitBackend && !fromDotenv) {
    console.warn(
      '[vite] Could not read backend URL from .env or backend/.env; proxying /api to',
      backendTarget,
      '(set VITE_DEV_BACKEND_URL=http://127.0.0.1:<API_PORT> in frontend/.env)'
    );
  }

  const apiProxy = {
    '/api': {
      target: backendTarget,
      changeOrigin: true,
      configure(proxy: any) {
        proxy.on('error', (err: Error, _req: unknown, res: { writeHead?: Function; end?: Function; headersSent?: boolean }) => {
          if (res && typeof res.writeHead === 'function' && !res.headersSent) {
            res.writeHead!(503, { 'Content-Type': 'application/json' });
            res.end!(
              JSON.stringify({
                status: 'unavailable',
                database: 'disconnected',
                message: 'HR API not reachable',
                detail: err.message,
              })
            );
            return;
          }
          console.error('[vite] /api proxy error (is the HR API running?):', err.message);
        });
      },
    },
    // Avatar/document files saved to backend/uploads are served from the backend's
    // /uploads static handler. Proxy them through Vite so <img src="/uploads/..."> works.
    '/uploads': {
      target: backendTarget,
      changeOrigin: true,
    },
  };

  return {
    root: configDir,
    envDir: configDir,
    server: {
      port: 3000,
      strictPort: true,
      host: true,
      proxy: apiProxy,
      hmr: {
        overlay: false,
      },
      watch: {
        usePolling: false,
        interval: 100,
      },
    },
    // Preview (`vite preview`) does not inherit `server.proxy`; mirror it so `/api` works on prod-like builds.
    preview: {
      host: '0.0.0.0',
      proxy: apiProxy,
    },
    plugins: [
      react(),
      {
        name: 'log-dev-api-proxy',
        configureServer() {
          console.log(`\n  [vite] API proxy  /api  →  ${backendTarget}`);
          console.log(`  [vite] Open the UI at the "Local" URL below so /api requests use this proxy.\n`);
        },
      },
    ],
    define: {
      'process.env.API_KEY': JSON.stringify(env.API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(configDir, './src'),
      },
    },
    build: {
      sourcemap: false,
      minify: 'terser',
      terserOptions: {
        compress: {
          drop_console: true,
          drop_debugger: true,
          passes: 3,
          pure_funcs: ['console.log', 'console.info', 'console.debug', 'console.warn'],
        },
        mangle: {
          toplevel: true,
        },
      },
      rollupOptions: {
        output: {
          manualChunks: {
            vendor: ['react', 'react-dom', 'react-router-dom'],
            ui: ['lucide-react', 'recharts', 'framer-motion'],
            forms: ['react-hook-form', 'zod'],
            utils: ['jspdf', 'html2canvas', 'xlsx'],
            maps: ['leaflet'],
            dates: ['date-fns'],
          },
          chunkFileNames: 'assets/[name]-[hash].js',
          entryFileNames: 'assets/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash].[ext]',
        },
      },
      chunkSizeWarningLimit: 1000,
      reportCompressedSize: false,
      target: 'es2020',
    },
    optimizeDeps: {
      include: ['react', 'react-dom', 'react-router-dom', 'lucide-react', 'recharts'],
      exclude: ['jspdf', 'html2canvas', 'xlsx'],
    },
  };
});
