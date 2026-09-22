import { defineConfig } from 'vitest/config';

export default defineConfig({
  build: {
    target: 'es2022',
    // three.js in its own long-lived chunk: app-code updates ship small while
    // the ~600 KB vendor chunk stays cache-hot (SW cache included).
    rollupOptions: { output: { manualChunks: { three: ['three'] } } },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
