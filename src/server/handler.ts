import fs from 'node:fs';
import path from 'node:path';
import {
  VERSION,
  type AiRequest,
  type ApplyRequest,
  type ApplyResult,
  type InspectRequest,
  type InspectResult,
  type StatusResult,
} from '../shared';
import { loadEnvFiles } from './env';
import {
  editStem,
  extForMime,
  findFileReferences,
  findUrlReferences,
  isInside,
  isLocalHost,
  mimeForFile,
  publicPathFor,
  rel,
  resolveSrc,
  rewriteReferences,
  sanitizeStem,
  stemFromUrl,
  uniqueStem,
  type FoundReference,
  type ProjectConfig,
  type Resolved,
} from './project';
import { HttpError, parseDataUrl, runAi, type ProviderConfig } from './providers';

export interface ImgPilotServerOptions {
  /** Project root. Defaults to process.cwd(). */
  root?: string;
  /** Directory served at "/". Defaults to "public". */
  publicDir?: string;
  /** Where images without a known source file are saved. Defaults to "<publicDir>/img-pilot". */
  outDir?: string;
  openaiApiKey?: string;
  geminiApiKey?: string;
  openaiModel?: string;
  geminiModel?: string;
  /** Extra host names allowed to call the API (tunnels, custom dev domains). */
  allowedHosts?: string[];
  /** The API writes into your source tree, so it refuses to run with NODE_ENV=production unless this is set. */
  allowInProduction?: boolean;
  /** Extra environment values, taking precedence over process.env and .env files. */
  env?: Record<string, string | undefined>;
}

type Config = ProjectConfig & ProviderConfig & { allowedHosts: string[] };

const MAX_BODY = 80 * 1024 * 1024;
const MAX_REMOTE = 40 * 1024 * 1024;

function resolveConfig(options: ImgPilotServerOptions): Config {
  const root = path.resolve(options.root ?? process.cwd());
  const env: Record<string, string | undefined> = { ...loadEnvFiles(root) };
  for (const source of [process.env, options.env ?? {}]) {
    for (const [key, value] of Object.entries(source)) if (value !== undefined) env[key] = value;
  }
  const publicDir = path.resolve(root, options.publicDir ?? 'public');
  return {
    root,
    publicDir,
    outDir: path.resolve(root, options.outDir ?? env.IMG_PILOT_OUT_DIR ?? path.join(publicDir, 'img-pilot')),
    openaiApiKey: options.openaiApiKey ?? env.OPENAI_API_KEY,
    openaiModel: options.openaiModel ?? env.IMG_PILOT_OPENAI_MODEL ?? 'gpt-image-1',
    openaiBaseUrl: (env.IMG_PILOT_OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, ''),
    openaiQuality: env.IMG_PILOT_OPENAI_QUALITY,
    geminiApiKey: options.geminiApiKey ?? env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY ?? env.GOOGLE_GENERATIVE_AI_API_KEY,
    geminiModel: options.geminiModel ?? env.IMG_PILOT_GEMINI_MODEL ?? 'gemini-2.5-flash-image',
    geminiBaseUrl: (env.IMG_PILOT_GEMINI_BASE_URL ?? 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, ''),
    allowedHosts: [...(options.allowedHosts ?? []), ...(env.IMG_PILOT_ALLOWED_HOSTS ?? '').split(',')]
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  };
}

function hostAllowed(host: string, cfg: Config) {
  const name = host.replace(/:\d+$/, '').toLowerCase();
  return isLocalHost(name) || cfg.allowedHosts.includes(name);
}

function status(cfg: Config): StatusResult {
  return {
    ok: true,
    version: VERSION,
    providers: { openai: !!cfg.openaiApiKey, gemini: !!cfg.geminiApiKey },
    models: { openai: cfg.openaiModel, gemini: cfg.geminiModel },
    outDir: rel(cfg, cfg.outDir),
  };
}

function references(cfg: Config, resolved: Resolved, body: { src?: string | null; attr?: string | null }) {
  if (resolved.kind === 'file') return findFileReferences(cfg, resolved.abs!);
  if (resolved.kind === 'inline') return [];
  const urls = [body.attr, body.src, resolved.url];
  try {
    const u = new URL(body.src ?? '', 'http://localhost');
    urls.push(u.pathname + u.search, u.searchParams.get('url'));
  } catch {
    // not a URL
  }
  return findUrlReferences(cfg, urls);
}

const toDataUrl = (mime: string, buffer: Buffer) => `data:${mime};base64,${buffer.toString('base64')}`;
const stripRef = ({ id, file, line, column, snippet }: FoundReference) => ({ id, file, line, column, snippet });

async function inspect(cfg: Config, body: InspectRequest): Promise<InspectResult> {
  const resolved = resolveSrc(cfg, body.src, body.pageUrl);
  const result: InspectResult = {
    kind: resolved.kind,
    file: null,
    dir: rel(cfg, cfg.outDir),
    stem: uniqueStem(cfg.outDir, stemFromUrl(body.src)),
    mime: null,
    dataUrl: null,
    references: references(cfg, resolved, body).map(stripRef),
  };

  if (resolved.kind === 'file') {
    const abs = resolved.abs!;
    result.file = rel(cfg, abs);
    result.dir = rel(cfg, path.dirname(abs)) || '.';
    result.stem = editStem(abs);
    result.mime = mimeForFile(abs);
    if (result.mime) result.dataUrl = toDataUrl(result.mime, fs.readFileSync(abs));
  } else if (resolved.kind === 'remote') {
    // Fetched server-side so the browser canvas is not tainted by cross-origin pixels.
    try {
      const res = await fetch(resolved.url!, { signal: AbortSignal.timeout(20_000) });
      const mime = (res.headers.get('content-type') ?? '').split(';')[0].trim();
      const buffer = Buffer.from(await res.arrayBuffer());
      if (res.ok && mime.startsWith('image/') && buffer.length <= MAX_REMOTE) {
        result.mime = mime;
        result.dataUrl = toDataUrl(mime, buffer);
      }
    } catch {
      // the client falls back to loading the URL itself
    }
  }
  return result;
}

function apply(cfg: Config, body: ApplyRequest): ApplyResult {
  const { mime, buffer } = parseDataUrl(body.dataUrl);
  if (!/^image\/(png|jpeg|webp|gif|avif)$/.test(mime)) throw new HttpError(400, `Unsupported image type "${mime}"`);
  const ext = extForMime(mime);
  const resolved = resolveSrc(cfg, body.src, body.pageUrl);

  if (body.mode === 'overwrite') {
    if (resolved.kind !== 'file') throw new HttpError(400, 'The original file was not found in the project, cannot overwrite it');
    const abs = resolved.abs!;
    if (mimeForFile(abs) !== mime) throw new HttpError(400, 'Cannot overwrite: the image format changed. Save it as a new file instead');
    fs.writeFileSync(abs, buffer);
    return { file: rel(cfg, abs), publicPath: publicPathFor(cfg, abs), overwritten: true, updated: [] };
  }

  const dir = resolved.kind === 'file' ? path.dirname(resolved.abs!) : cfg.outDir;
  const requested = body.fileName ? sanitizeStem(path.parse(path.basename(body.fileName)).name) : null;
  const stem = requested
    ? uniqueStem(dir, requested)
    : resolved.kind === 'file'
      ? editStem(resolved.abs!)
      : uniqueStem(dir, stemFromUrl(body.src));
  const target = path.join(dir, stem + ext);
  if (!isInside(cfg.root, target)) throw new HttpError(400, 'Refusing to write outside of the project root');

  // Collect references before the new file exists, then write the image first so the code never points at nothing.
  let refs = references(cfg, resolved, body);
  if (body.refs) refs = refs.filter((r) => body.refs!.includes(r.id));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(target, buffer);

  const publicPath = publicPathFor(cfg, target);
  if (resolved.kind === 'file') {
    rewriteReferences(refs, path.basename(target));
  } else if (publicPath) {
    rewriteReferences(refs, publicPath);
  } else {
    refs = [];
  }
  return {
    file: rel(cfg, target),
    publicPath,
    overwritten: false,
    updated: refs.map((r) => ({ file: r.file, line: r.line })),
  };
}

/** Framework-agnostic request handler (Fetch API Request -> Response). */
export function createImgPilotHandler(options: ImgPilotServerOptions = {}) {
  return async function handle(req: Request): Promise<Response> {
    const headers: Record<string, string> = { 'Cache-Control': 'no-store' };
    const send = (data: unknown, code = 200) =>
      new Response(JSON.stringify(data), {
        status: code,
        headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' },
      });

    if (process.env.NODE_ENV === 'production' && !options.allowInProduction) {
      return send({ error: 'img-pilot is a development tool and is disabled in production' }, 404);
    }

    try {
      const cfg = resolveConfig(options);
      const url = new URL(req.url);
      const host = req.headers.get('host') ?? url.host;
      // Host + Origin checks keep other websites (CSRF, DNS rebinding) away from an API that writes files.
      if (!hostAllowed(host, cfg)) {
        return send({ error: `Host "${host}" is not allowed. Add it to allowedHosts / IMG_PILOT_ALLOWED_HOSTS.` }, 403);
      }
      const origin = req.headers.get('origin');
      if (origin) {
        let originHost = '';
        try {
          originHost = new URL(origin).host;
        } catch {
          // malformed origin stays rejected
        }
        if (!hostAllowed(originHost, cfg)) return send({ error: `Origin "${origin}" is not allowed` }, 403);
        headers['Access-Control-Allow-Origin'] = origin;
        headers['Access-Control-Allow-Headers'] = 'Content-Type';
        headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
        headers['Vary'] = 'Origin';
      }
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
      if (req.method === 'GET') return send(status(cfg));
      if (req.method !== 'POST') return send({ error: 'Method not allowed' }, 405);
      if (!/application\/json/i.test(req.headers.get('content-type') ?? '')) {
        return send({ error: 'Expected application/json' }, 415);
      }
      if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY) return send({ error: 'Payload too large' }, 413);

      const body = await req.json();
      const action = url.pathname.split('/').filter(Boolean).pop();
      if (action === 'inspect') return send(await inspect(cfg, body as InspectRequest));
      if (action === 'ai') return send(await runAi(cfg, body as AiRequest));
      if (action === 'apply') return send(apply(cfg, body as ApplyRequest));
      return send({ error: `Unknown action "${action}"` }, 404);
    } catch (err) {
      const timedOut = err instanceof Error && err.name === 'TimeoutError';
      const message = timedOut ? 'The AI provider timed out' : err instanceof Error ? err.message : String(err);
      return send({ error: message }, err instanceof HttpError ? err.status : 500);
    }
  };
}
