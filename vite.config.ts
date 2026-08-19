import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'

const API_TARGET = process.env.FANCYDECK_API ?? 'http://localhost:8787'

/**
 * 开发时把 /console 与 /console/* 指到 console.html。
 * 生产构建是两个独立入口，由 Node 服务端做同样的事。
 */
function consoleRoutes(): Plugin {
  return {
    name: 'fancydeck-console-routes',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url === '/console' || req.url?.startsWith('/console/')) req.url = '/console.html'
        next()
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), consoleRoutes()],
  build: {
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, 'index.html'),
        console: resolve(import.meta.dirname, 'console.html'),
      },
    },
  },
  server: {
    /**
     * 别盯着这两个目录看。
     *
     * data/config.json 是服务端在运行时写的：后台每拖一下卡片就落一次盘。
     * Vite 的文件监听发现它变了、又在模块图里找不到它，就会给页面发 full-reload——
     * 于是拖一次卡片刷新一次，正在编辑的布局页面被冲掉。
     *
     * 配置本来就通过应用自己的 WebSocket 实时广播给所有页面，不需要 Vite 插手。
     * dist 同理：一边开着 dev 一边 pnpm build 不该把页面刷掉。
     */
    watch: { ignored: ['**/data/**', '**/dist/**'] },
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
      '/ws': { target: API_TARGET, ws: true },
    },
  },
})
