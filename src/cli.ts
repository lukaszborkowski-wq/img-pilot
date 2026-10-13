#!/usr/bin/env node
import http from 'node:http';
import path from 'node:path';
import { DEFAULT_ENDPOINT, VERSION } from './shared';
import { createNodeMiddleware } from './server/node';

const args = process.argv.slice(2);
const flag = (...names: string[]) => {
  const i = args.findIndex((a) => names.includes(a));
  return i >= 0 ? args[i + 1] : undefined;
};

if (args.includes('--help') || args.includes('-h')) {
  console.log(`img-pilot ${VERSION} - standalone dev server

Usage: img-pilot [--port 4317] [--root .] [--public public]

Run it from the project you are working on, then mount the UI with
  <ImgPilot endpoint="http://localhost:4317${DEFAULT_ENDPOINT}" />

API keys are read from OPENAI_API_KEY / GEMINI_API_KEY (environment, .env or .env.local).`);
  process.exit(0);
}

const port = Number(flag('--port', '-p') ?? process.env.IMG_PILOT_PORT ?? 4317);
const root = path.resolve(flag('--root', '-r') ?? process.cwd());
const middleware = createNodeMiddleware({ root, publicDir: flag('--public') });

http
  .createServer((req, res) => void middleware(req, res))
  .listen(port, '127.0.0.1', () => {
    console.log(`img-pilot ${VERSION} listening on http://localhost:${port}${DEFAULT_ENDPOINT}`);
    console.log(`project root: ${root}`);
  });
