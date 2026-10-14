import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'sw-notify.js'],
      workbox: {
        importScripts: ['sw-notify.js'],
        // المصمم صفحة مستقلة: لا نعرض مكانها التطبيق عند فتحها
        navigateFallbackDenylist: [/^\/designer/],
        // ملفات كبيرة لا يحتاجها الجميع: تُحمَّل عند الحاجة فقط
        globIgnores: ['**/designer/**', '**/xlsx-*.js'],
      },
      manifest: {
        name: 'CHER MEUBLE',
        short_name: 'CHER MEUBLE',
        lang: 'ar',
        dir: 'rtl',
        start_url: '/',
        display: 'standalone',
        background_color: '#f4eee7',
        theme_color: '#7a4a2b',
        orientation: 'portrait',
        icons: [{ src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
    }),
  ],
})
