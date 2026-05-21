import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@server-types": path.resolve(__dirname, "../server/src/types"),
    },
  },
  server: {
    port: 3200,
    proxy: {
      "/api": "http://localhost:3100",
      "/assets": "http://localhost:3100",
      "/ws": {
        target: "ws://localhost:3100",
        ws: true,
      },
    },
  },
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "react",
  },
});
