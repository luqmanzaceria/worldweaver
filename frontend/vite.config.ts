import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/overshoot': {
        target: 'https://cluster1.overshoot.ai/api/v0.2',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/overshoot/, ''),
      }
    }
  }
})
