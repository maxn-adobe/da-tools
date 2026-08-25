import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

// Self-contained Vite app for the "template-generator" tool. Builds into
// template-generator/dist/ and is served by AEM Edge Delivery at that subfolder path
// (mirrors the doc-generator / hello pattern in this repo).
//
// Built entry:  template-generator/dist/index.html  ->  /template-generator/dist/index.html
// da.live app:  https://da.live/app/maxn-adobe/pdp-document-generator/template-generator/dist/index
export default defineConfig(({ command }) => {
  const base = command === 'serve' ? '/' : '/template-generator/dist/'

  return {
    plugins: [react(), tailwindcss()],
    base,
    build: {
      rollupOptions: {
        output: {
          entryFileNames: 'assets/[name].js',
          chunkFileNames: 'assets/[name].js',
          assetFileNames: 'assets/[name].[ext]',
        },
      },
    },
    server: {
      // Distinct port from doc-generator (3000) and hello (3001) so all can run at once.
      port: 3002,
    },
  }
})
