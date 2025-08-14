
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Proxy for public endpoints and Spot/Margin/Wallet signed endpoints
      '/proxy-spot': {
        target: 'https://api.binance.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/proxy-spot/, ''),
      },
      // Proxy for signed Futures endpoints
      '/proxy-futures': {
        target: 'https://fapi.binance.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/proxy-futures/, ''),
      },
      // Proxy for WebSocket Streams to fix cross-origin issues in dev
      '/proxy-spot-ws': {
        target: 'wss://stream.binance.com',
        ws: true,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/proxy-spot-ws/, ''),
      },
      // CORRECTED: The target for futures does not use port 9443.
      '/proxy-futures-ws': {
        target: 'wss://fstream.binance.com',
        ws: true,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/proxy-futures-ws/, ''),
      },
    },
  },
})