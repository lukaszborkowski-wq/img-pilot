import fs from 'node:fs';
import path from 'node:path';
import type { Reference } from '../shared';

export interface ProjectConfig {
  root: string;
  publicDir: string;
  outDir: string;
}

export interface Resolved {
  kind: 'file' | 'remote' | 'inline' | 'unknown';
  abs?: string;
  url?: string;
}

export interface FoundReference extends Reference {
  abs: string;
  start: number;
  end: number;
}

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'out', 'coverage', 'vendor']);
const SOURCE_EXT = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.mts', '.cts', '.vue', '.svelte', '.astro',
  '.html', '.css', '.scss', '.sass', '.less', '.md', '.mdx', '.json', '.yaml', '.yml',
]);
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.svg', '.bmp', '.ico']);
const SKIP_FILES = /^(package(-lock)?|tsconfig.*|jsconfig.*|composer|components)\.json$|^pnpm-lock\.yaml$/;
const MAX_SOURCE_SIZE = 1_500_000;

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.avif': 'image/avif', '.svg': 'image/svg+xml', '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
};
const EXT_BY_MIME: Record<string, string> = {
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif',
  'image/avif': '.avif', 'image/svg+xml': '.svg',
};

export const mimeForFile = (file: string) => MIME_BY_EXT[path.extname(file).toLowerCase()] ?? null;
export const extForMime = (mime: string) => EXT_BY_MIME[mime] ?? '.png';
export const toPosix = (p: string) => p.split(path.sep).join('/');
export const rel = (cfg: ProjectConfig, abs: string) => toPosix(path.relative(cfg.root, abs));

export function isInside(dir: string, target: string) {
  const r = path.relative(dir, target);
  return !!r && !r.startsWith('..') && !path.isAbsolute(r);
}

export function isLocalHost(hostname: string) {
  const h = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return (
    h === 'localhost' || h.endsWith('.localhost') || h === '::1' || h === '0.0.0.0' ||
    /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)
  );
}

function* walk(dir: string, exts: Set<string>): Generator<string> {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) yield* walk(path.join(dir, entry.name), exts);
    } else if (entry.isFile() && exts.has(path.extname(entry.name).toLowerCase())) {
      yield path.join(dir, entry.name);
    }
  }
}

const isFile = (p: string) => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};

/** Maps the URL an <img> was rendered with back to a file inside the project. */
export function resolveSrc(cfg: ProjectConfig, src: string | null | undefined, pageUrl?: string): Resolved {
  if (!src) return { kind: 'unknown' };
  if (src.startsWith('data:')) return { kind: 'inline' };
  if (src.startsWith('blob:')) return { kind: 'unknown' };

  let url: URL;
  let page: URL | null = null;
  try {
    page = pageUrl ? new URL(pageUrl) : null;
    url = new URL(src, page ?? 'http://localhost');
  } catch {
    return { kind: 'unknown' };
  }
  if (!/^https?:$/.test(url.protocol)) return { kind: 'unknown' };

  // next/image optimizer: the real source sits in ?url=
  const inner = url.searchParams.get('url');
  if (inner && url.pathname.endsWith('/_next/image')) return resolveSrc(cfg, inner, url.href);

  if (!isLocalHost(url.hostname) && !(page && url.host === page.host)) return { kind: 'remote', url: url.href };

  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    pathname = url.pathname;
  }

  const candidates = [path.join(cfg.publicDir, pathname), path.join(cfg.root, pathname)];
  if (pathname.startsWith('/@fs/')) candidates.unshift(pathname.slice(4));
  for (const candidate of candidates) {
    const abs = path.resolve(candidate);
    if (isInside(cfg.root, abs) && IMAGE_EXT.has(path.extname(abs).toLowerCase()) && isFile(abs)) {
      return { kind: 'file', abs };
    }
  }

  // Bundler output (/_next/static/media/hero.3f2a1b9c.png, /assets/hero-3f2a1b9c.png): look the file up by name.
  const base = path.basename(pathname);
  if (!IMAGE_EXT.has(path.extname(base).toLowerCase())) return { kind: 'unknown' };
  const names = new Set([base, base.replace(/[.-][A-Za-z0-9_~]{6,20}(?=\.[^.]+$)/, '')]);
  const matches: string[] = [];
  for (const file of walk(cfg.root, IMAGE_EXT)) {
    if (names.has(path.basename(file))) matches.push(file);
  }
  if (!matches.length) return { kind: 'unknown' };
  matches.sort((a, b) => a.length - b.length);
  return { kind: 'file', abs: matches[0] };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function specMatches(cfg: ProjectConfig, spec: string, fromFile: string, target: string) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(spec) || spec.startsWith('//')) return false;
  const same = (p: string) => path.resolve(p) === target;
  const posixTarget = toPosix(target);

  // `${base}/img/hero.png` - only the static tail can be compared
  if (spec.includes('}')) {
    const tail = spec.slice(spec.lastIndexOf('}') + 1);
    return tail.startsWith('/') && posixTarget.endsWith(tail);
  }
  if (spec.startsWith('.')) return same(path.join(path.dirname(fromFile), spec));
  if (spec.startsWith('/')) return same(path.join(cfg.publicDir, spec)) || same(path.join(cfg.root, spec));
  // In scripts a bare path to a public file is a page-relative URL ("images/hero.png"), never a file system path;
  // without this, tooling such as fs.readFileSync('public/images/hero.png') would be relinked too.
  if (same(path.join(cfg.publicDir, spec))) return true;
  if (isInside(cfg.publicDir, target) && /\.[cm]?[jt]sx?$/.test(fromFile)) return false;
  if (same(path.join(path.dirname(fromFile), spec))) return true;

  // import aliases: @/assets/hero.png, ~/assets/hero.png, src/assets/hero.png
  const slash = spec.indexOf('/');
  if (slash < 0) return false;
  const rest = spec.slice(slash + 1);
  return (
    same(path.join(cfg.root, spec)) ||
    same(path.join(cfg.root, rest)) ||
    same(path.join(cfg.root, 'src', rest)) ||
    (rest.includes('/') && posixTarget.endsWith('/' + rest))
  );
}

function readSource(file: string): string | null {
  if (SKIP_FILES.test(path.basename(file))) return null;
  try {
    if (fs.statSync(file).size > MAX_SOURCE_SIZE) return null;
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function makeRef(cfg: ProjectConfig, abs: string, content: string, start: number, end: number): FoundReference {
  const lineStart = content.lastIndexOf('\n', start - 1) + 1;
  let lineEnd = content.indexOf('\n', start);
  if (lineEnd < 0) lineEnd = content.length;
  const line = content.slice(0, start).split('\n').length;
  const file = rel(cfg, abs);
  return {
    id: `${file}:${start}`,
    abs,
    file,
    line,
    column: start - lineStart + 1,
    snippet: content.slice(lineStart, lineEnd).trim().slice(0, 200),
    start,
    end,
  };
}

/** Finds every place in the source that points at a project file. `start..end` covers the file name only. */
export function findFileReferences(cfg: ProjectConfig, target: string): FoundReference[] {
  const base = path.basename(target);
  const re = new RegExp(`[^"'\`()\\s<>=,;]*${escapeRe(base)}(?=["'\`)\\s?#<>,;]|$)`, 'g');
  const out: FoundReference[] = [];
  for (const file of walk(cfg.root, SOURCE_EXT)) {
    const content = readSource(file);
    if (!content || !content.includes(base)) continue;
    for (const m of content.matchAll(re)) {
      if (!specMatches(cfg, m[0], file, target)) continue;
      const end = m.index! + m[0].length;
      out.push(makeRef(cfg, file, content, end - base.length, end));
    }
  }
  return out;
}

/** Finds literal occurrences of a URL that has no file in the project. `start..end` covers the whole URL. */
export function findUrlReferences(cfg: ProjectConfig, urls: (string | null | undefined)[]): FoundReference[] {
  const needles = [...new Set(urls.filter((u): u is string => !!u && u.length >= 5 && !u.startsWith('data:')))].sort(
    (a, b) => b.length - a.length,
  );
  if (!needles.length) return [];
  const before = /["'`(\s=]/;
  const after = /["'`)\s]/;
  const out: FoundReference[] = [];
  for (const file of walk(cfg.root, SOURCE_EXT)) {
    const content = readSource(file);
    if (!content) continue;
    const taken: [number, number][] = [];
    for (const needle of needles) {
      for (let i = content.indexOf(needle); i >= 0; i = content.indexOf(needle, i + 1)) {
        const end = i + needle.length;
        if (i > 0 && !before.test(content[i - 1])) continue;
        if (end < content.length && !after.test(content[end])) continue;
        if (taken.some(([s, e]) => i < e && end > s)) continue;
        taken.push([i, end]);
        out.push(makeRef(cfg, file, content, i, end));
      }
    }
  }
  return out;
}

/** Rewrites the given references, last one first so earlier offsets stay valid. */
export function rewriteReferences(refs: FoundReference[], replacement: string) {
  const byFile = new Map<string, FoundReference[]>();
  for (const ref of refs) byFile.set(ref.abs, [...(byFile.get(ref.abs) ?? []), ref]);
  for (const [file, list] of byFile) {
    let content = fs.readFileSync(file, 'utf8');
    for (const ref of list.sort((a, b) => b.start - a.start)) {
      content = content.slice(0, ref.start) + replacement + content.slice(ref.end);
    }
    fs.writeFileSync(file, content);
  }
}

export function sanitizeStem(name: string) {
  const stem = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w.-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 80);
  return stem || 'image';
}

function takenStems(dir: string) {
  const taken = new Set<string>();
  try {
    for (const f of fs.readdirSync(dir)) taken.add(path.parse(f).name.toLowerCase());
  } catch {
    // directory does not exist yet
  }
  return taken;
}

/** First free name in `dir`, regardless of extension, so hero-edit.png never shadows hero-edit.jpg. */
export function uniqueStem(dir: string, stem: string) {
  const taken = takenStems(dir);
  if (!taken.has(stem.toLowerCase())) return stem;
  const m = /^(.*?)-(\d+)$/.exec(stem);
  const base = m ? m[1] : stem;
  for (let i = m ? Number(m[2]) + 1 : 2; ; i++) {
    if (!taken.has(`${base}-${i}`.toLowerCase())) return `${base}-${i}`;
  }
}

export function editStem(original: string) {
  const stem = path.parse(original).name.replace(/-edit(-\d+)?$/, '');
  return uniqueStem(path.dirname(original), `${sanitizeStem(stem)}-edit`);
}

export function stemFromUrl(src: string | null | undefined) {
  if (!src || src.startsWith('data:') || src.startsWith('blob:')) return 'image';
  try {
    const u = new URL(src, 'http://localhost');
    const inner = u.pathname.endsWith('/_next/image') ? u.searchParams.get('url') : null;
    const name = path.posix.basename(decodeURIComponent(inner ? new URL(inner, u).pathname : u.pathname));
    return sanitizeStem(path.parse(name).name);
  } catch {
    return 'image';
  }
}

/** URL a file is served from, or null when it is not inside the public directory. */
export function publicPathFor(cfg: ProjectConfig, abs: string) {
  return isInside(cfg.publicDir, abs) ? '/' + toPosix(path.relative(cfg.publicDir, abs)) : null;
}
