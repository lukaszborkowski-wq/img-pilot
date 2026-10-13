import type { AiRequest, AiResult } from '../shared';

export interface ProviderConfig {
  openaiApiKey?: string;
  openaiModel: string;
  openaiBaseUrl: string;
  openaiQuality?: string;
  geminiApiKey?: string;
  geminiModel: string;
  geminiBaseUrl: string;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const TIMEOUT_MS = 240_000;

export function parseDataUrl(dataUrl: string | undefined, what = 'image') {
  const m = /^data:([^;,]+)?((?:;[^;,]+)*?)(;base64)?,(.*)$/s.exec(dataUrl ?? '');
  if (!m) throw new HttpError(400, `Missing or invalid ${what} data URL`);
  const buffer = m[3] ? Buffer.from(m[4], 'base64') : Buffer.from(decodeURIComponent(m[4]), 'utf8');
  return { mime: m[1] || 'application/octet-stream', buffer };
}

const ERASE_FILL =
  'Remove everything inside the marked area and fill it in so it blends seamlessly with the surrounding background, lighting and texture.';
const KEEP_REST = 'Do not change anything outside the marked area.';

function instruction(req: AiRequest) {
  const prompt = req.prompt?.trim();
  switch (req.op) {
    case 'generate':
    case 'edit':
      if (!prompt) throw new HttpError(400, 'A prompt is required');
      return prompt;
    case 'erase':
      return `${prompt ? `Inside the marked area: ${prompt}. Blend it seamlessly with the rest of the image.` : ERASE_FILL} ${KEEP_REST}`;
    case 'remove-bg':
      return req.provider === 'openai'
        ? 'Remove the background completely and return the main subject on a fully transparent background. Keep the subject exactly as it is: same shape, colors, details, position and scale. Do not add shadows or any new elements.'
        : `Replace the entire background with a perfectly flat, uniform solid color ${req.keyColor ?? '#00FF00'}, with no gradients, shadows, reflections or texture. Keep the main subject exactly as it is - same position, scale, colors and details - with clean, sharp edges.`;
  }
}

async function readError(res: Response, name: string) {
  const text = await res.text();
  let message = text.slice(0, 500);
  try {
    message = JSON.parse(text).error?.message ?? message;
  } catch {
    // not JSON
  }
  return new HttpError(502, `${name} (${res.status}): ${message}`);
}

async function openai(cfg: ProviderConfig, req: AiRequest): Promise<AiResult> {
  if (!cfg.openaiApiKey) throw new HttpError(400, 'OPENAI_API_KEY is not set');
  const auth = { Authorization: `Bearer ${cfg.openaiApiKey}` };
  const prompt = instruction(req);
  const size = req.size ?? 'auto';
  let res: Response;

  if (req.op === 'generate') {
    res = await fetch(`${cfg.openaiBaseUrl}/images/generations`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: cfg.openaiModel,
        prompt,
        size,
        n: 1,
        output_format: 'png',
        ...(cfg.openaiQuality ? { quality: cfg.openaiQuality } : {}),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } else {
    const image = parseDataUrl(req.image);
    const mask = req.op === 'erase' ? parseDataUrl(req.mask, 'mask') : null;
    const form = new FormData();
    form.append('model', cfg.openaiModel);
    form.append('prompt', prompt);
    form.append('size', size);
    form.append('output_format', 'png');
    if (cfg.openaiQuality) form.append('quality', cfg.openaiQuality);
    if (req.op === 'remove-bg') form.append('background', 'transparent');
    form.append('image', new Blob([image.buffer], { type: image.mime }), 'image.png');
    if (mask) form.append('mask', new Blob([mask.buffer], { type: 'image/png' }), 'mask.png');
    res = await fetch(`${cfg.openaiBaseUrl}/images/edits`, {
      method: 'POST',
      headers: auth,
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  }

  if (!res.ok) throw await readError(res, 'OpenAI');
  const json = (await res.json()) as { data?: { b64_json?: string }[] };
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) throw new HttpError(502, 'OpenAI returned no image');
  return { dataUrl: `data:image/png;base64,${b64}` };
}

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType?: string; data?: string };
  inline_data?: { mime_type?: string; data?: string };
}

async function gemini(cfg: ProviderConfig, req: AiRequest): Promise<AiResult> {
  if (!cfg.geminiApiKey) throw new HttpError(400, 'GEMINI_API_KEY is not set');
  const inline = (dataUrl: string | undefined, what?: string) => {
    const { mime, buffer } = parseDataUrl(dataUrl, what);
    return { inlineData: { mimeType: mime, data: buffer.toString('base64') } };
  };

  let text = instruction(req);
  const parts: object[] = [];
  if (req.op !== 'generate') {
    parts.push(inline(req.image));
    text += ' Return only the edited image, with the same framing and aspect ratio as the original.';
  }
  if (req.op === 'erase') {
    parts.push(inline(req.mask, 'mask'));
    text = `The first image is the photo to edit. The second image is a black and white mask of the same size: white marks the area to edit. ${text} Never include the mask in the result.`;
  }
  parts.push({ text });

  const res = await fetch(`${cfg.geminiBaseUrl}/models/${cfg.geminiModel}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': cfg.geminiApiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
        ...(req.op === 'generate' && req.aspect ? { imageConfig: { aspectRatio: req.aspect } } : {}),
      },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) throw await readError(res, 'Gemini');
  const json = (await res.json()) as {
    candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
    promptFeedback?: { blockReason?: string };
  };
  const candidate = json.candidates?.[0];
  const out = candidate?.content?.parts ?? [];
  for (const part of out) {
    const data = part.inlineData?.data ?? part.inline_data?.data;
    if (data) {
      const mime = part.inlineData?.mimeType ?? part.inline_data?.mime_type ?? 'image/png';
      return { dataUrl: `data:${mime};base64,${data}` };
    }
  }
  const reason =
    out.map((p) => p.text).filter(Boolean).join(' ').slice(0, 300) ||
    json.promptFeedback?.blockReason ||
    candidate?.finishReason ||
    'no image in the response';
  throw new HttpError(502, `Gemini returned no image: ${reason}`);
}

export function runAi(cfg: ProviderConfig, req: AiRequest): Promise<AiResult> {
  if (!['generate', 'edit', 'erase', 'remove-bg'].includes(req.op)) throw new HttpError(400, `Unknown operation "${req.op}"`);
  if (req.provider === 'openai') return openai(cfg, req);
  if (req.provider === 'gemini') return gemini(cfg, req);
  throw new HttpError(400, `Unknown provider "${req.provider}"`);
}
