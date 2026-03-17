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
      "/rpc": "http://localhost:8545",
      "/faucet": "http://localhost:8545",
      "/ws": {
        target: "ws://localhost:8545",
        ws: true,
      },
    },
  },
});
