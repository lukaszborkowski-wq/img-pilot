import { createImgPilotHandler, type ImgPilotServerOptions } from './server/handler';

/**
 * Next.js App Router handlers.
 *
 *   // app/api/img-pilot/[...action]/route.ts
 *   export { GET, POST, OPTIONS } from 'img-pilot/next';
 */
export function createNextHandlers(options: ImgPilotServerOptions = {}) {
  const handler = createImgPilotHandler(options);
  const route = (req: Request) => handler(req);
  return { GET: route, POST: route, OPTIONS: route };
}

export const { GET, POST, OPTIONS } = createNextHandlers();
export type { ImgPilotServerOptions };
