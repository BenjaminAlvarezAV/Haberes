import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const chequesTarget = env.VITE_CHEQUES_PROXY_TARGET || 'http://server35.abc.gov.ar'

  return {
    plugins: [react(), tailwindcss()],
    server: {
      proxy: {
        '/wsstestsigue/cheques': {
          target: chequesTarget,
          changeOrigin: true,
          secure: false,
        },
      },
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      globals: true,
      include: ['src/**/*.test.ts'],
    },
  }
})
