export const VERSION = '0.1.0';
export const DEFAULT_ENDPOINT = '/api/img-pilot';

export type Provider = 'openai' | 'gemini';
export type AiOp = 'generate' | 'edit' | 'erase' | 'remove-bg';

export interface StatusResult {
  ok: true;
  version: string;
  providers: Record<Provider, boolean>;
  models: Record<Provider, string>;
  /** Project-relative directory where images without a known source file are saved. */
  outDir: string;
}

export interface Reference {
  id: string;
  file: string;
  line: number;
  column: number;
  snippet: string;
}

export interface InspectRequest {
  src: string;
  attr?: string | null;
  pageUrl?: string;
}

export interface InspectResult {
  /** file = found on disk, remote = external URL, inline = data URL, unknown = not resolvable */
  kind: 'file' | 'remote' | 'inline' | 'unknown';
  /** Project-relative path of the original file, when found. */
  file: string | null;
  /** Project-relative directory the edited image will be written to. */
  dir: string;
  /** Suggested file name without extension. */
  stem: string;
  mime: string | null;
  dataUrl: string | null;
  references: Reference[];
}

export interface AiRequest {
  provider: Provider;
  op: AiOp;
  prompt?: string;
  /** PNG data URL of the image to edit. */
  image?: string;
  /** OpenAI: PNG whose transparent pixels mark the editable area. Gemini: white = editable. */
  mask?: string;
  /** OpenAI output size, e.g. 1536x1024. */
  size?: string;
  /** Gemini aspect ratio, e.g. 16:9. */
  aspect?: string;
  /** Flat backdrop colour Gemini should paint for background removal. */
  keyColor?: string;
}

export interface AiResult {
  dataUrl: string;
}

export interface ApplyRequest {
  src?: string | null;
  attr?: string | null;
  pageUrl?: string;
  dataUrl: string;
  mode?: 'new' | 'overwrite';
  fileName?: string;
  /** Reference ids to relink. Omit to relink all of them. */
  refs?: string[];
}

export interface ApplyResult {
  file: string;
  /** URL the saved file is served from, when it lives in the public directory. */
  publicPath: string | null;
  overwritten: boolean;
  updated: { file: string; line: number }[];
}
