import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import packageJson from './package.json' with { type: 'json' }

export default defineConfig({
  plugins: [react(), {
    name: 'development-csp',
    apply: 'serve',
    transformIndexHtml: { order: 'pre', handler: (html) => html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'") },
  }],
  base: './',
  define: { __APP_VERSION__: JSON.stringify(packageJson.version) },
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  build: { target: 'es2022' },
})
