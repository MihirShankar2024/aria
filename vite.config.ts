import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  worker: {
    format: 'es',
  },
  // Vite 8 natively supports top-level await and WASM in ES module workers
  optimizeDeps: {
    exclude: ['@spotify/basic-pitch'],
  },
})
