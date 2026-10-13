export type Cv = HTMLCanvasElement;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const MAX_SIDE = 4096;

export function make(w: number, h: number): Cv {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

export function ctx(c: Cv) {
  const x = c.getContext('2d')!;
  x.imageSmoothingEnabled = true;
  x.imageSmoothingQuality = 'high';
  return x;
}

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (!/^(data|blob):/.test(url)) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load the image'));
    img.src = url;
  });
}

export async function fromUrl(url: string): Promise<Cv> {
  const img = await loadImage(url);
  // SVGs without intrinsic size report 0
  const w = img.naturalWidth || 1024;
  const h = img.naturalHeight || 1024;
  const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
  const c = make(w * scale, h * scale);
  ctx(c).drawImage(img, 0, 0, c.width, c.height);
  return c;
}

export function clone(c: Cv): Cv {
  const out = make(c.width, c.height);
  ctx(out).drawImage(c, 0, 0);
  return out;
}

export function rotate90(c: Cv, dir: 1 | -1): Cv {
  const out = make(c.height, c.width);
  const x = ctx(out);
  x.translate(out.width / 2, out.height / 2);
  x.rotate((dir * Math.PI) / 2);
  x.drawImage(c, -c.width / 2, -c.height / 2);
  return out;
}

export function flip(c: Cv, horizontal: boolean): Cv {
  const out = make(c.width, c.height);
  const x = ctx(out);
  x.translate(horizontal ? c.width : 0, horizontal ? 0 : c.height);
  x.scale(horizontal ? -1 : 1, horizontal ? 1 : -1);
  x.drawImage(c, 0, 0);
  return out;
}

export function crop(c: Cv, r: Rect): Cv {
  const out = make(r.w, r.h);
  ctx(out).drawImage(c, r.x, r.y, r.w, r.h, 0, 0, out.width, out.height);
  return out;
}

export function resize(c: Cv, w: number, h: number): Cv {
  const out = make(w, h);
  ctx(out).drawImage(c, 0, 0, out.width, out.height);
  return out;
}

/** Shrinks the image so its longer side fits `maxSide`. */
export function limit(c: Cv, maxSide: number): Cv {
  const scale = maxSide / Math.max(c.width, c.height);
  return scale < 1 ? resize(c, c.width * scale, c.height * scale) : c;
}

/** Centre-crops to the given aspect ratio. */
export function coverCrop(c: Cv, aspect: number): Cv {
  const current = c.width / c.height;
  if (Math.abs(current / aspect - 1) < 0.01) return c;
  const w = current > aspect ? c.height * aspect : c.width;
  const h = current > aspect ? c.height : c.width / aspect;
  return crop(c, { x: (c.width - w) / 2, y: (c.height - h) / 2, w, h });
}

/** Centre-crops an AI result to the working aspect ratio and never returns less resolution than before. */
export function fitResult(result: Cv, w: number, h: number): Cv {
  const c = coverCrop(result, w / h);
  return c.width < w ? resize(c, w, h) : c;
}

export function applyFilter(c: Cv, filter: string): Cv {
  const out = make(c.width, c.height);
  const x = ctx(out);
  x.filter = filter;
  x.drawImage(c, 0, 0);
  return out;
}

export function hasAlpha(c: Cv): boolean {
  const small = resize(c, Math.min(c.width, 96), Math.min(c.height, 96));
  const data = ctx(small).getImageData(0, 0, small.width, small.height).data;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 250) return true;
  return false;
}

export function toDataUrl(c: Cv, mime: string, quality = 0.92): string {
  if (mime !== 'image/jpeg') return c.toDataURL(mime, quality);
  // JPEG has no alpha: flatten onto white instead of the default black
  const flat = make(c.width, c.height);
  const x = ctx(flat);
  x.fillStyle = '#fff';
  x.fillRect(0, 0, flat.width, flat.height);
  x.drawImage(c, 0, 0);
  return flat.toDataURL(mime, quality);
}

export const toPng = (c: Cv) => c.toDataURL('image/png');

/** Approximate byte size of a base64 data URL. */
export const dataUrlBytes = (url: string) => Math.round(((url.length - url.indexOf(',') - 1) * 3) / 4);

// --- AI helpers -------------------------------------------------------------------------------

const OPENAI_SIZES: [number, number][] = [
  [1024, 1024],
  [1536, 1024],
  [1024, 1536],
];
const GEMINI_ASPECTS = ['1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5', '16:9', '9:16', '21:9'];

const ratioDistance = (a: number, b: number) => Math.abs(Math.log(a / b));

export function nearestOpenAiSize(aspect: number): [number, number] {
  return OPENAI_SIZES.reduce((best, s) => (ratioDistance(s[0] / s[1], aspect) < ratioDistance(best[0] / best[1], aspect) ? s : best));
}

export function nearestGeminiAspect(aspect: number): string {
  const value = (a: string) => Number(a.split(':')[0]) / Number(a.split(':')[1]);
  return GEMINI_ASPECTS.reduce((best, a) => (ratioDistance(value(a), aspect) < ratioDistance(value(best), aspect) ? a : best));
}

/**
 * OpenAI only produces three output sizes. Letterboxing the image into the closest one keeps the result
 * pixel-aligned with the input, which masks and compositing rely on.
 */
export function padForOpenAi(c: Cv): { canvas: Cv; rect: Rect } {
  const [W, H] = nearestOpenAiSize(c.width / c.height);
  const scale = Math.min(W / c.width, H / c.height);
  const w = Math.round(c.width * scale);
  const h = Math.round(c.height * scale);
  const rect = { x: Math.floor((W - w) / 2), y: Math.floor((H - h) / 2), w, h };
  const canvas = make(W, H);
  ctx(canvas).drawImage(c, rect.x, rect.y, w, h);
  return { canvas, rect };
}

export function isMaskEmpty(mask: Cv): boolean {
  const small = resize(mask, Math.min(mask.width, 256), Math.min(mask.height, 256));
  const data = ctx(small).getImageData(0, 0, small.width, small.height).data;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 8) return false;
  return true;
}

/** OpenAI mask: opaque everywhere, transparent where the image may change. */
export function openAiMask(mask: Cv, W: number, H: number, rect: Rect): Cv {
  const out = make(W, H);
  const x = ctx(out);
  x.fillStyle = '#000';
  x.fillRect(0, 0, W, H);
  x.globalCompositeOperation = 'destination-out';
  x.drawImage(mask, rect.x, rect.y, rect.w, rect.h);
  return out;
}

/** Gemini mask: white where the image may change, black elsewhere. */
export function blackWhiteMask(mask: Cv, w: number, h: number): Cv {
  const white = make(w, h);
  const wx = ctx(white);
  wx.drawImage(mask, 0, 0, w, h);
  wx.globalCompositeOperation = 'source-in';
  wx.fillStyle = '#fff';
  wx.fillRect(0, 0, w, h);
  const out = make(w, h);
  const x = ctx(out);
  x.fillStyle = '#000';
  x.fillRect(0, 0, w, h);
  x.drawImage(white, 0, 0);
  return out;
}

/** Puts `result` over `base` only where the mask is painted, so untouched pixels stay exactly as they were. */
export function compositeMasked(base: Cv, result: Cv, mask: Cv): Cv {
  const w = base.width;
  const h = base.height;
  const layer = make(w, h);
  const x = ctx(layer);
  x.filter = `blur(${Math.max(2, Math.round(Math.max(w, h) / 300))}px)`;
  x.drawImage(mask, 0, 0, w, h);
  x.filter = 'none';
  x.drawImage(mask, 0, 0, w, h);
  x.globalCompositeOperation = 'source-in';
  x.drawImage(result, 0, 0, w, h);
  const out = clone(base);
  ctx(out).drawImage(layer, 0, 0);
  return out;
}

/** Makes the painted area transparent. */
export function cutMask(base: Cv, mask: Cv): Cv {
  const out = clone(base);
  const x = ctx(out);
  x.globalCompositeOperation = 'destination-out';
  x.drawImage(mask, 0, 0, out.width, out.height);
  return out;
}

/** Picks the backdrop colour that clashes least with the image, for Gemini background removal. */
export function pickKeyColor(c: Cv): string {
  const small = resize(c, Math.min(c.width, 128), Math.min(c.height, 128));
  const data = ctx(small).getImageData(0, 0, small.width, small.height).data;
  let green = 0;
  let magenta = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 1] - Math.max(data[i], data[i + 2]) > 30) green++;
    if (Math.min(data[i], data[i + 2]) - data[i + 1] > 30) magenta++;
  }
  return green <= magenta ? '#00FF00' : '#FF00FF';
}

/** Turns the flat backdrop of an image (sampled from its border) transparent. */
export function removeFlatBackground(c: Cv): Cv {
  const out = clone(c);
  const x = ctx(out);
  const w = out.width;
  const h = out.height;
  const image = x.getImageData(0, 0, w, h);
  const p = image.data;

  const samples: number[][] = [[], [], []];
  const step = Math.max(1, Math.floor(Math.max(w, h) / 200));
  const sample = (px: number, py: number) => {
    const i = (py * w + px) * 4;
    for (let k = 0; k < 3; k++) samples[k].push(p[i + k]);
  };
  for (let px = 0; px < w; px += step) {
    sample(px, 0);
    sample(px, h - 1);
  }
  for (let py = 0; py < h; py += step) {
    sample(0, py);
    sample(w - 1, py);
  }
  const key = samples.map((s) => s.sort((a, b) => a - b)[s.length >> 1]);

  const LOW = 48;
  const HIGH = 120;
  for (let i = 0; i < p.length; i += 4) {
    const dist = Math.hypot(p[i] - key[0], p[i + 1] - key[1], p[i + 2] - key[2]);
    if (dist >= HIGH) continue;
    const a = dist <= LOW ? 0 : (dist - LOW) / (HIGH - LOW);
    // remove the backdrop's contribution from edge pixels so they do not keep a coloured fringe
    if (a > 0) for (let k = 0; k < 3; k++) p[i + k] = Math.max(0, Math.min(255, (p[i + k] - key[k] * (1 - a)) / a));
    p[i + 3] = Math.round(p[i + 3] * a);
  }
  x.putImageData(image, 0, 0);
  return out;
}

/** Magic wand: makes the connected area of similar colour around (sx, sy) transparent. */
export function floodErase(c: Cv, sx: number, sy: number, tolerance: number): Cv {
  const out = clone(c);
  const x = ctx(out);
  const w = out.width;
  const h = out.height;
  sx = Math.max(0, Math.min(w - 1, Math.floor(sx)));
  sy = Math.max(0, Math.min(h - 1, Math.floor(sy)));
  const image = x.getImageData(0, 0, w, h);
  const p = image.data;
  const seed = (sy * w + sx) * 4;
  if (p[seed + 3] === 0) return out;
  const r = p[seed];
  const g = p[seed + 1];
  const b = p[seed + 2];
  const limitSq = (tolerance * 4.42) ** 2; // 100 covers the whole RGB cube
  const seen = new Uint8Array(w * h);
  const stack = [sy * w + sx];
  seen[stack[0]] = 1;
  while (stack.length) {
    const n = stack.pop()!;
    const i = n * 4;
    const d = (p[i] - r) ** 2 + (p[i + 1] - g) ** 2 + (p[i + 2] - b) ** 2;
    if (d > limitSq || p[i + 3] === 0) continue;
    p[i + 3] = 0;
    const px = n % w;
    if (px > 0 && !seen[n - 1]) (seen[n - 1] = 1), stack.push(n - 1);
    if (px < w - 1 && !seen[n + 1]) (seen[n + 1] = 1), stack.push(n + 1);
    if (n >= w && !seen[n - w]) (seen[n - w] = 1), stack.push(n - w);
    if (n < w * (h - 1) && !seen[n + w]) (seen[n + w] = 1), stack.push(n + w);
  }
  x.putImageData(image, 0, 0);
  return out;
}
