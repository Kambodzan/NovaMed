import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// HTTPS dev: certy z scripts/make-cert.py (wymagane przez getUserMedia
// przy wejściu z innych urządzeń w LAN). Brak certów = zwykłe HTTP.
const certFile = fileURLToPath(new URL('../certs/dev-cert.pem', import.meta.url))
const keyFile = fileURLToPath(new URL('../certs/dev-key.pem', import.meta.url))
const https = fs.existsSync(certFile) && fs.existsSync(keyFile)
  ? { cert: fs.readFileSync(certFile), key: fs.readFileSync(keyFile) }
  : undefined

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    https,
    // API przez ten sam origin co strona (/api → backend :8000):
    // jedna akceptacja certyfikatu, zero CORS, działa też dla WebSocketów.
    proxy: {
      '/api': {
        target: 'https://localhost:8000',
        changeOrigin: true,
        secure: false, // backend ma self-signed cert dev
        ws: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
