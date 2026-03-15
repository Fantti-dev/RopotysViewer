import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      target: 'node18',
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      target: 'node18',
    }
  },
  renderer: {
    publicDir: resolve(__dirname, 'maps'),
    build: {
      target: 'chrome108',
    },
    plugins: [react()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer/src')
      }
    }
  }
})