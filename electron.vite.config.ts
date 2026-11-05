import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {},
  // Sandboxed preloads must be CommonJS, even though the rest of the app is ESM.
  preload: {
    build: {
      rolldownOptions: {
        output: { format: 'cjs', entryFileNames: '[name].cjs' }
      }
    }
  },
  renderer: {
    resolve: {
      alias: { '@': resolve('src/renderer/src') }
    },
    plugins: [react(), tailwindcss()]
  }
})
