import { DEFAULT_ENDPOINT } from './shared';
import { createNodeMiddleware, type NodeMiddlewareOptions } from './server/node';

export interface ImgPilotViteOptions extends NodeMiddlewareOptions {
  /** Mount the editor UI automatically, so no <ImgPilot /> is needed in the app. Defaults to true. */
  inject?: boolean;
  /** UI language. Defaults to the browser language. */
  lang?: 'pl' | 'en';
}

/**
 * Vite plugin: serves the img-pilot API from the dev server and injects the editor UI.
 *
 *   // vite.config.ts
 *   import imgPilot from 'img-pilot/vite';
 *   export default defineConfig({ plugins: [react(), imgPilot()] });
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function imgPilot(options: ImgPilotViteOptions = {}): any {
  const inject = options.inject !== false;
  const basePath = options.basePath ?? DEFAULT_ENDPOINT;
  let root = options.root;

  return {
    name: 'img-pilot',
    apply: 'serve',
    config() {
      return inject ? { optimizeDeps: { include: ['img-pilot/auto'] } } : undefined;
    },
    configResolved(config: { root: string; publicDir?: string }) {
      root ??= config.root;
      if (config.publicDir && !options.publicDir) options = { ...options, publicDir: config.publicDir };
    },
    configureServer(server: { middlewares: { use(fn: unknown): void } }) {
      server.middlewares.use(createNodeMiddleware({ ...options, root, basePath }));
    },
    transformIndexHtml: {
      order: 'pre',
      handler() {
        if (!inject) return [];
        const config = JSON.stringify({ endpoint: basePath, lang: options.lang });
        // Two tags: module imports are hoisted, so the config has to be set by an earlier script.
        return [
          { tag: 'script', children: `window.__IMG_PILOT__ = ${config};`, injectTo: 'body' },
          { tag: 'script', attrs: { type: 'module' }, children: `import 'img-pilot/auto';`, injectTo: 'body' },
        ];
      },
    },
  };
}

export { imgPilot };
