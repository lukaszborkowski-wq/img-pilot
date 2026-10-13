import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: { index: 'src/client/index.ts', auto: 'src/auto.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    clean: true,
    splitting: false,
    platform: 'browser',
    target: 'es2020',
    external: ['react', 'react-dom'],
    banner: { js: '"use client";' },
    esbuildOptions(options) {
      // Keep the check alive so the host bundler decides dev vs production.
      options.define = { ...options.define, 'process.env.NODE_ENV': 'process.env.NODE_ENV' };
    },
  },
  {
    entry: {
      server: 'src/server/index.ts',
      next: 'src/next.ts',
      vite: 'src/vite.ts',
      cli: 'src/cli.ts',
    },
    format: ['esm', 'cjs'],
    dts: true,
    splitting: false,
    platform: 'node',
    target: 'node18',
  },
]);
