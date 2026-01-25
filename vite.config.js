import { defineConfig } from 'vite'
import path from 'path'

export default defineConfig({
  base: './',
  root: path.resolve(__dirname, 'src/renderer'),
  build: {
    outDir: path.resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'src/renderer/index.html'),
        homepage: path.resolve(__dirname, 'src/renderer/homepage.html'),
        modelSwitcher: path.resolve(__dirname, 'src/renderer/model-switcher.html'),
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
