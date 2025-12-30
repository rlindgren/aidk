import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

// Workspace root (example/frontend-react -> root)
const workspaceRoot = resolve(__dirname, "../..");

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      // aidk-client subpaths
      {
        find: /^aidk-client\/(.*)$/,
        replacement: resolve(workspaceRoot, "packages/client/src/$1"),
      },
      // aidk-react subpaths
      { find: /^aidk-react\/(.*)$/, replacement: resolve(workspaceRoot, "packages/react/src/$1") },
      // Package main exports
      { find: "aidk-client", replacement: resolve(workspaceRoot, "packages/client/src/index.ts") },
      { find: "aidk-react", replacement: resolve(workspaceRoot, "packages/react/src/index.ts") },
    ],
  },
  server: {
    port: 3001,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
});
