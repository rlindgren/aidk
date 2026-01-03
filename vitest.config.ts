import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "aidk",
  },
  test: {
    globals: true,
    environment: "node",
    include: ["packages/*/src/**/*.spec.{ts,tsx}", "packages/adapters/*/src/**/*.spec.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    testTimeout: 30000,
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**/*.{ts,tsx}", "packages/adapters/*/src/**/*.{ts,tsx}"],
      exclude: ["**/*.spec.ts", "**/*.spec.tsx", "**/testing/**"],
      reporter: ["text", "json", "html"],
    },
  },
  resolve: {
    alias: {
      "aidk/jsx-runtime": "./packages/core/src/jsx/jsx-runtime.ts",
      "aidk/jsx-dev-runtime": "./packages/core/src/jsx/jsx-runtime.ts",
    },
  },
});
