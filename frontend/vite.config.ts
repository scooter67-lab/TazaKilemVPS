import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // Не обновляемся молча: смену/заявку можно заполнять в этот момент.
      // Новая версия ставится по кнопке в тосте (см. src/PwaUpdate.tsx).
      registerType: "prompt",
      // Регистрируем воркер из React (useRegisterSW), автоскрипт в index.html не нужен.
      injectRegister: null,
      // Иконки уже попадают в precache по globPatterns (см. workbox ниже) —
      // иначе они добавились бы в список второй раз.
      includeManifestIcons: false,
      manifest: {
        id: "/",
        name: "Журнал ковромойки",
        short_name: "Журнал",
        description: "Учёт смен, заявок и ковров",
        lang: "ru",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#ffffff",
        theme_color: "#eef0f3",
        icons: [
          { src: "/pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512x512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/pwa-maskable-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable"
          }
        ]
      },
      workbox: {
        // manifest.webmanifest плагин добавляет в precache сам.
        globPatterns: ["**/*.{js,css,html,png,svg}"],
        // Офлайн-навигация отдаёт оболочку SPA, но /api должен идти в сеть:
        // иначе запрос к бэкенду получит index.html.
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true
      }
    })
  ],
  server: {
    port: 5173
  }
});
