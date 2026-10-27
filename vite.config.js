import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

export default defineConfig({
  plugins: [svelte()],
  base: '',
  build: {
    rollupOptions: {
      input: { popup: 'popup.html', dashboard: 'dashboard.html', background: 'src/background.js' },
      // The manifest points at a fixed service worker path.
      output: { entryFileNames: c => (c.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js') },
    },
  },
})
