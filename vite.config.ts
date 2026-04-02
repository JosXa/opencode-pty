import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  root: 'src/web/client',
  resolve: {
    alias: {
      '@josxa/opencode-pty': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: '../../../dist/web',
    emptyOutDir: true,
    minify: process.env.NODE_ENV === 'test' ? false : 'esbuild', // Enable minification for production
  },
  server: {
    port: 3000,
    host: true,
  },
})
