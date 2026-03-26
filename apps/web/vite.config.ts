import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  resolve: {
    alias: {
      "@evo-world-sim/core": path.resolve(__dirname, "../../packages/core/src/index.ts"),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
