// End-to-end test of the server half against a throwaway project and fake AI providers.
// Run with: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createImgPilotHandler } from '../dist/server.js';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const pngUrl = `data:image/png;base64,${PNG.toString('base64')}`;

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'img-pilot-test-'));
const write = (file, content) => {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), content);
};
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

write('public/images/hero.png', PNG);
write('src/assets/logo.png', PNG);
write('src/assets/other/logo.png', PNG);
write('node_modules/pkg/hero.png', PNG);
write(
  'src/App.tsx',
  `import logo from './assets/logo.png';
import aliased from '@/assets/logo.png';
import other from './assets/other/logo.png';
export const App = () => (
  <>
    <img src="/images/hero.png" alt="hero" />
    <img src={\`\${base}/images/hero.png\`} />
    <img src="https://cdn.example.com/images/hero.png" />
    <img src="https://cdn.example.com/photo.jpg?w=800" />
    <img src={logo} />
  </>
);
`,
);
write('src/app.css', `.hero { background: url(/images/hero.png) center; }\n.x { background: url("../public/images/hero.png"); }\n`);
write('scripts/check.mjs', `fs.readFileSync('public/images/hero.png');\n`);
write('index.html', `<img src="images/hero.png">\n`);
write('.env.local', 'OPENAI_API_KEY="sk-test"\nGEMINI_API_KEY=g-test # comment\n');

// Fake OpenAI + Gemini
const seen = [];
const fake = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks).toString('latin1');
  seen.push({ url: req.url, headers: req.headers, body });
  res.setHeader('Content-Type', 'application/json');
  if (req.url.includes('fail')) {
    res.statusCode = 400;
    return res.end(JSON.stringify({ error: { message: 'bad prompt' } }));
  }
  if (req.url.includes('generateContent')) {
    return res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }, { inlineData: { mimeType: 'image/png', data: PNG.toString('base64') } }] } }] }));
  }
  res.end(JSON.stringify({ data: [{ b64_json: PNG.toString('base64') }] }));
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));
const fakeUrl = `http://127.0.0.1:${fake.address().port}`;

const handler = createImgPilotHandler({
  root,
  env: { IMG_PILOT_OPENAI_BASE_URL: fakeUrl, IMG_PILOT_GEMINI_BASE_URL: fakeUrl },
});
const call = async (action, body, headers = {}) => {
  const res = await handler(
    new Request(`http://localhost:3000/api/img-pilot/${action}`, {
      method: body ? 'POST' : 'GET',
      headers: { host: 'localhost:3000', ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    }),
  );
  return { status: res.status, json: await res.json(), headers: res.headers };
};
const page = 'http://localhost:3000/';

let passed = 0;
const test = async (name, fn) => {
  await fn();
  passed++;
  console.log(`  ok  ${name}`);
};

await test('status reports keys from .env.local', async () => {
  const { json } = await call('status');
  assert.deepEqual(json.providers, { openai: true, gemini: true });
  assert.equal(json.outDir, 'public/img-pilot');
});

await test('rejects foreign hosts and origins', async () => {
  assert.equal((await call('status', null, { host: 'evil.example.com' })).status, 403);
  assert.equal((await call('inspect', { src: '/x.png' }, { origin: 'https://evil.example.com' })).status, 403);
  const ok = await call('status', null, { origin: 'http://localhost:5173' });
  assert.equal(ok.headers.get('access-control-allow-origin'), 'http://localhost:5173');
});

await test('refuses to run in production', async () => {
  process.env.NODE_ENV = 'production';
  assert.equal((await call('status')).status, 404);
  delete process.env.NODE_ENV;
});

await test('inspect resolves a public file and finds only real references', async () => {
  const { json } = await call('inspect', { src: 'http://localhost:3000/images/hero.png', pageUrl: page });
  assert.equal(json.kind, 'file');
  assert.equal(json.file, 'public/images/hero.png');
  assert.equal(json.stem, 'hero-edit');
  assert.ok(json.dataUrl.startsWith('data:image/png;base64,'));
  const where = json.references.map((r) => `${r.file}:${r.line}`).sort();
  assert.deepEqual(where, ['index.html:1', 'src/App.tsx:6', 'src/App.tsx:7', 'src/app.css:1', 'src/app.css:2']);
});

await test('inspect resolves next/image and hashed bundler URLs', async () => {
  const next = await call('inspect', { src: 'http://localhost:3000/_next/image?url=%2Fimages%2Fhero.png&w=1080&q=75', pageUrl: page });
  assert.equal(next.json.file, 'public/images/hero.png');
  const media = await call('inspect', { src: 'http://localhost:3000/_next/static/media/logo.3f2a1b9c.png', pageUrl: page });
  assert.equal(media.json.file, 'src/assets/logo.png');
  const vite = await call('inspect', { src: 'http://localhost:5173/src/assets/logo.png?t=123', pageUrl: 'http://localhost:5173/' });
  assert.equal(vite.json.file, 'src/assets/logo.png');
  assert.deepEqual(vite.json.references.map((r) => r.line), [1, 2]);
});

await test('apply saves next to the original and relinks the selected references', async () => {
  const inspected = (await call('inspect', { src: '/images/hero.png', pageUrl: page })).json;
  const keep = inspected.references.find((r) => r.file === 'src/app.css' && r.line === 2).id;
  const refs = inspected.references.filter((r) => r.id !== keep).map((r) => r.id);
  const { json } = await call('apply', { src: '/images/hero.png', pageUrl: page, dataUrl: pngUrl.replace('image/png', 'image/webp'), fileName: 'hero-edit.webp', refs });
  assert.equal(json.file, 'public/images/hero-edit.webp');
  assert.equal(json.publicPath, '/images/hero-edit.webp');
  assert.equal(json.updated.length, 4);
  assert.ok(read('scripts/check.mjs').includes(`'public/images/hero.png'`), 'file system paths in scripts are untouched');
  assert.ok(fs.existsSync(path.join(root, 'public/images/hero.png')), 'original is kept');
  const app = read('src/App.tsx');
  assert.ok(app.includes('<img src="/images/hero-edit.webp" alt="hero" />'));
  assert.ok(app.includes('${base}/images/hero-edit.webp'));
  assert.ok(app.includes('https://cdn.example.com/images/hero.png'), 'remote URL with the same name is untouched');
  const cssText = read('src/app.css');
  assert.ok(cssText.includes('url(/images/hero-edit.webp)'));
  assert.ok(cssText.includes('url("../public/images/hero.png")'), 'deselected reference is untouched');
});

await test('apply never overwrites another file', async () => {
  const { json } = await call('apply', { src: '/images/hero.png', pageUrl: page, dataUrl: pngUrl, fileName: 'hero-edit.png', refs: [] });
  assert.equal(json.file, 'public/images/hero-edit-2.png');
});

await test('apply relinks imports of bundled assets', async () => {
  const { json } = await call('apply', { src: 'http://localhost:5173/src/assets/logo.png', pageUrl: 'http://localhost:5173/', dataUrl: pngUrl });
  assert.equal(json.file, 'src/assets/logo-edit.png');
  assert.equal(json.publicPath, null);
  const app = read('src/App.tsx');
  assert.ok(app.includes(`import logo from './assets/logo-edit.png';`));
  assert.ok(app.includes(`import aliased from '@/assets/logo-edit.png';`));
  assert.ok(app.includes(`import other from './assets/other/logo.png';`), 'same file name in another folder is untouched');
});

await test('overwrite replaces the original and leaves the code alone', async () => {
  const before = read('src/App.tsx');
  const { json } = await call('apply', { src: '/images/hero-edit-2.png', pageUrl: page, dataUrl: pngUrl, mode: 'overwrite' });
  assert.equal(json.overwritten, true);
  assert.equal(read('src/App.tsx'), before);
  const changed = await call('apply', { src: '/images/hero-edit-2.png', pageUrl: page, dataUrl: pngUrl.replace('image/png', 'image/jpeg'), mode: 'overwrite' });
  assert.equal(changed.status, 400);
});

await test('remote images are saved to the public folder and their URL is replaced', async () => {
  const src = 'https://cdn.example.com/photo.jpg?w=800';
  const inspected = (await call('inspect', { src, attr: src, pageUrl: page })).json;
  assert.equal(inspected.kind, 'remote');
  assert.equal(inspected.stem, 'photo');
  assert.equal(inspected.references.length, 1);
  const { json } = await call('apply', { src, attr: src, pageUrl: page, dataUrl: pngUrl });
  assert.equal(json.file, 'public/img-pilot/photo.png');
  assert.ok(read('src/App.tsx').includes('<img src="/img-pilot/photo.png" />'));
});

await test('a brand new image is saved without touching the code', async () => {
  const { json } = await call('apply', { src: null, dataUrl: pngUrl, fileName: 'Kawa na stole!.png' });
  assert.equal(json.file, 'public/img-pilot/Kawa-na-stole.png');
  assert.deepEqual(json.updated, []);
});

await test('apply cannot escape the project root', async () => {
  const { json } = await call('apply', { src: null, dataUrl: pngUrl, fileName: '../../../etc/evil.png' });
  assert.equal(json.file, 'public/img-pilot/evil.png');
});

await test('OpenAI: generate, masked edit and background removal', async () => {
  seen.length = 0;
  const gen = await call('ai', { provider: 'openai', op: 'generate', prompt: 'a cat', size: '1536x1024' });
  assert.equal(gen.json.dataUrl, pngUrl);
  assert.equal(seen[0].url, '/images/generations');
  assert.equal(seen[0].headers.authorization, 'Bearer sk-test');
  assert.deepEqual(JSON.parse(seen[0].body), { model: 'gpt-image-1', prompt: 'a cat', size: '1536x1024', n: 1, output_format: 'png' });

  await call('ai', { provider: 'openai', op: 'erase', image: pngUrl, mask: pngUrl, size: '1024x1024' });
  assert.equal(seen[1].url, '/images/edits');
  assert.match(seen[1].headers['content-type'], /^multipart\/form-data/);
  assert.match(seen[1].body, /name="mask"; filename="mask.png"/);
  assert.match(seen[1].body, /name="image"; filename="image.png"/);

  await call('ai', { provider: 'openai', op: 'remove-bg', image: pngUrl });
  assert.match(seen[2].body, /name="background"\r\n\r\ntransparent/);
});

await test('Gemini: generate with aspect ratio, edit with image + mask', async () => {
  seen.length = 0;
  const gen = await call('ai', { provider: 'gemini', op: 'generate', prompt: 'a dog', aspect: '16:9' });
  assert.equal(gen.json.dataUrl, pngUrl);
  assert.equal(seen[0].url, '/models/gemini-2.5-flash-image:generateContent');
  assert.equal(seen[0].headers['x-goog-api-key'], 'g-test');
  assert.equal(JSON.parse(seen[0].body).generationConfig.imageConfig.aspectRatio, '16:9');

  await call('ai', { provider: 'gemini', op: 'erase', image: pngUrl, mask: pngUrl });
  const parts = JSON.parse(seen[1].body).contents[0].parts;
  assert.equal(parts.length, 3);
  assert.equal(parts[0].inlineData.mimeType, 'image/png');
  assert.match(parts[2].text, /white marks the area to edit/);
});

await test('provider errors and missing prompts come back as readable messages', async () => {
  const missing = await call('ai', { provider: 'openai', op: 'generate' });
  assert.equal(missing.status, 400);
  const failing = createImgPilotHandler({ root, env: { IMG_PILOT_OPENAI_BASE_URL: `${fakeUrl}/fail` } });
  const res = await failing(
    new Request('http://localhost/api/img-pilot/ai', {
      method: 'POST',
      headers: { host: 'localhost', 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'openai', op: 'generate', prompt: 'x' }),
    }),
  );
  assert.equal(res.status, 502);
  assert.match((await res.json()).error, /OpenAI \(400\): bad prompt/);
});

fake.close();
fs.rmSync(root, { recursive: true, force: true });
console.log(`\n${passed} tests passed`);
