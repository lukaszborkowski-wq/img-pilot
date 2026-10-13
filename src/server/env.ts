import fs from 'node:fs';
import path from 'node:path';

/** Minimal .env reader so the Vite plugin and the standalone CLI see the same keys Next.js does. */
export function loadEnvFiles(dir: string, mode = 'development'): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of ['.env', '.env.local', `.env.${mode}`, `.env.${mode}.local`]) {
    let text: string;
    try {
      text = fs.readFileSync(path.join(dir, name), 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?([\w.-]+)\s*=\s*(.*)$/.exec(line);
      if (!m) continue;
      let value = m[2].trim();
      const quote = value[0];
      if ((quote === '"' || quote === "'") && value.lastIndexOf(quote) > 0) {
        value = value.slice(1, value.lastIndexOf(quote));
      } else {
        value = value.replace(/\s+#.*$/, '');
      }
      out[m[1]] = value;
    }
  }
  return out;
}
