import { defineConfig } from "vite";

export default defineConfig({
  root: "src",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
  server: {
    port: 3000,
    proxy: {
      "/rpc": "http://localhost:8546",
      "/faucet": "http://localhost:8546",
      "/ws": {
        target: "ws://localhost:8546",
        ws: true,
      },
      "/health": "http://localhost:8546",
      "/api": "http://localhost:8546",
    },
  },
});
