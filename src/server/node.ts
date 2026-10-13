import type { IncomingMessage, ServerResponse } from 'node:http';
import { DEFAULT_ENDPOINT } from '../shared';
import { createImgPilotHandler, type ImgPilotServerOptions } from './handler';

export interface NodeMiddlewareOptions extends ImgPilotServerOptions {
  /** URL prefix the API is mounted on. Defaults to "/api/img-pilot". */
  basePath?: string;
}

const MAX_BODY = 80 * 1024 * 1024;

/** Connect-style middleware: works with Vite, Express, plain http and Next.js pages/api routes. */
export function createNodeMiddleware(options: NodeMiddlewareOptions = {}) {
  const handler = createImgPilotHandler(options);
  const basePath = (options.basePath ?? DEFAULT_ENDPOINT).replace(/\/$/, '');

  return async function imgPilotMiddleware(req: IncomingMessage, res: ServerResponse, next?: (err?: unknown) => void) {
    const rawUrl = (req as IncomingMessage & { originalUrl?: string }).originalUrl ?? req.url ?? '/';
    const pathname = rawUrl.split('?')[0];
    if (pathname !== basePath && !pathname.startsWith(basePath + '/')) {
      if (next) return next();
      res.statusCode = 404;
      return res.end();
    }

    try {
      let body: Buffer | undefined;
      if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
        const parsed = (req as IncomingMessage & { body?: unknown }).body;
        if (parsed !== undefined && !req.readable) {
          body = Buffer.from(typeof parsed === 'string' ? parsed : JSON.stringify(parsed));
        } else {
          const chunks: Buffer[] = [];
          let size = 0;
          for await (const chunk of req) {
            size += chunk.length;
            if (size > MAX_BODY) {
              res.statusCode = 413;
              res.setHeader('Content-Type', 'application/json');
              return res.end(JSON.stringify({ error: 'Payload too large' }));
            }
            chunks.push(chunk);
          }
          body = Buffer.concat(chunks);
        }
      }

      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (value !== undefined && key !== 'content-length') headers.set(key, Array.isArray(value) ? value.join(', ') : value);
      }
      const response = await handler(
        new Request(`http://${req.headers.host ?? 'localhost'}${rawUrl}`, {
          method: req.method,
          headers,
          body: body && new Uint8Array(body),
        }),
      );
      res.statusCode = response.status;
      response.headers.forEach((value, key) => res.setHeader(key, value));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (err) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    }
  };
}
