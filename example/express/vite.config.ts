import { defineConfig } from 'vite';
import { resolve } from 'path';

// Workspace root (example/backend -> root)
const workspaceRoot = resolve(__dirname, '../..');

export default defineConfig({
  resolve: {
    alias: [
      // aidk subpath imports (order matters - more specific first)
      { find: 'aidk/jsx-dev-runtime', replacement: resolve(workspaceRoot, 'packages/core/src/jsx/jsx-runtime.ts') },
      { find: 'aidk/jsx-runtime', replacement: resolve(workspaceRoot, 'packages/core/src/jsx/jsx-runtime.ts') },
      { find: /^aidk\/(.*)$/, replacement: resolve(workspaceRoot, 'packages/core/src/$1') },
      // aidk-kernel subpath imports
      { find: /^aidk-kernel\/(.*)$/, replacement: resolve(workspaceRoot, 'packages/kernel/src/$1') },
      // Package aliases (exact matches)
      { find: 'aidk', replacement: resolve(workspaceRoot, 'packages/core/src/index.ts') },
      { find: 'aidk-kernel', replacement: resolve(workspaceRoot, 'packages/kernel/src/index.ts') },
      { find: 'aidk-ai-sdk', replacement: resolve(workspaceRoot, 'packages/adapters/ai-sdk/src/index.ts') },
      { find: 'aidk-express', replacement: resolve(workspaceRoot, 'packages/express/src/index.ts') },
      { find: 'aidk-openai', replacement: resolve(workspaceRoot, 'packages/adapters/openai/src/index.ts') },
      { find: 'aidk-google', replacement: resolve(workspaceRoot, 'packages/adapters/google/src/index.ts') },
    ],
  },
  // For vite-node SSR
  ssr: {
    external: ['express', 'cors'],
    noExternal: [/^aidk/],
  },
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'aidk',
  },
});
