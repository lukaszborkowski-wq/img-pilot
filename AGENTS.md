# img-pilot - integration guide for AI coding agents

You have been asked to hook `img-pilot` into a React or Next.js project. Follow this file top to bottom.
It is self-contained; you do not need to read the library source.

## What it is

A **development-only** image tool. Once integrated, hovering any `<img>` in the running app shows a small
toolbar (Edit / Generate / Remove background). The editor can crop, rotate, flip, resize, adjust colors, erase
objects, remove backgrounds and generate images with OpenAI or Gemini. On **Confirm** the library writes the new
image file into the project and rewrites the references in the source code to point at it.

It has two halves, and both are required:

| Half   | What it does                                                        | Where it runs                 |
| ------ | ------------------------------------------------------------------- | ----------------------------- |
| Server | holds the API keys, calls OpenAI/Gemini, writes files, edits source | the project's own dev server  |
| Client | hover toolbar + editor UI, rendered in a shadow root                | the browser                   |

The client talks to the server at `/api/img-pilot` by default. The client shows nothing at all if that
endpoint does not answer, so a missing server half fails silently with one `console.info` line.

## Step 1 - install

The package is not on npm. Install the tarball built from this folder (replace the path with the real location
of the `img-pilot` folder; use the project's own package manager):

```bash
npm  install -D /absolute/path/to/img-pilot/img-pilot-0.1.0.tgz
pnpm add     -D /absolute/path/to/img-pilot/img-pilot-0.1.0.tgz
yarn add     -D file:/absolute/path/to/img-pilot/img-pilot-0.1.0.tgz
```

If the `.tgz` is missing, build it first: `cd /absolute/path/to/img-pilot && npm install && npm run pack:local`.

Do **not** install the folder itself (`npm i ../img-pilot`) and do not `npm link` it: that creates a symlink and
the library then fails to resolve `react` from the host project.

Requirements: React 18 or newer, Node 18.17 or newer.

## Step 2 - wire it up (pick the one section matching the project)

Detect the framework from `package.json` and the config files.

### A. Next.js, App Router (`app/` directory)

1. Create `app/api/img-pilot/[...action]/route.ts` (under `src/app/...` if the project uses `src/`):

   ```ts
   export { GET, POST, OPTIONS } from 'img-pilot/next';
   ```

2. Mount the UI once in the root layout `app/layout.tsx`, inside `<body>`:

   ```tsx
   import { ImgPilot } from 'img-pilot';

   export default function RootLayout({ children }: { children: React.ReactNode }) {
     return (
       <html lang="en">
         <body>
           {children}
           <ImgPilot />
         </body>
       </html>
     );
   }
   ```

   `ImgPilot` is already a client component; the layout can stay a server component.

### B. Next.js, Pages Router (`pages/` directory)

1. Create `pages/api/img-pilot/[...action].ts`:

   ```ts
   import { createNodeMiddleware } from 'img-pilot/server';

   export const config = { api: { bodyParser: false } };
   export default createNodeMiddleware();
   ```

2. Add `<ImgPilot />` (from `'img-pilot'`) next to `<Component {...pageProps} />` in `pages/_app.tsx`.

### C. Vite + React

Only the Vite config changes. The plugin serves the API and injects the UI by itself, so do **not** also add
`<ImgPilot />`.

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import imgPilot from 'img-pilot/vite';

export default defineConfig({
  plugins: [react(), imgPilot()],
});
```

### D. Anything else (Create React App, webpack, Remix, Astro, a separate backend...)

1. Add a script to the project's `package.json` and run it alongside the dev server, from the project root:

   ```json
   { "scripts": { "img-pilot": "img-pilot --port 4317" } }
   ```

2. Mount the UI once near the root of the React tree, pointing at that server:

   ```tsx
   import { ImgPilot } from 'img-pilot';

   <ImgPilot endpoint="http://localhost:4317/api/img-pilot" />
   ```

An Express/Connect dev server can instead mount the API directly: `app.use(createNodeMiddleware())` from
`'img-pilot/server'`. Do not put a JSON body parser in front of it with a small size limit.

## Step 3 - API keys

Add to the project's `.env.local` (create it if missing, and make sure it is git-ignored). At least one key is
needed for the AI features; cropping, colors and the other local tools work without any key.

```bash
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=...
```

Never put these keys in client code, in `NEXT_PUBLIC_*` / `VITE_*` variables, or in a committed file. Do not
invent keys: if the user has not provided one, leave the variable out and tell them which one to add.

Optional variables: `IMG_PILOT_OPENAI_MODEL` (default `gpt-image-1`), `IMG_PILOT_GEMINI_MODEL`
(default `gemini-2.5-flash-image`), `IMG_PILOT_OPENAI_QUALITY` (`low` | `medium` | `high`),
`IMG_PILOT_OUT_DIR` (default `public/img-pilot`), `IMG_PILOT_ALLOWED_HOSTS` (comma separated, see below).

The dev server has to be restarted after `.env.local` changes.

## Step 4 - verify

With the dev server running (adjust the port):

```bash
curl -s http://localhost:3000/api/img-pilot/status
# {"ok":true,"version":"0.1.0","providers":{"openai":true,"gemini":false},...}
```

- `providers` shows which keys the server can see.
- A 404 or an HTML page means the server half is not mounted (wrong route path, or dev server not restarted).
- `403 Host ... is not allowed` means the app is opened through a tunnel or custom domain; add that host name
  to `IMG_PILOT_ALLOWED_HOSTS`.

Then tell the user: open the app, hover an image, and the toolbar appears. A small `img-pilot` pill in the
corner toggles it (also `Alt+I`) and offers "New image".

## Things to know

- **Production**: nothing to remove. The API answers 404 when `NODE_ENV=production`, `<ImgPilot />` renders
  nothing in production builds, and the Vite plugin only applies to `vite dev`. The `img-pilot` imports stay in
  the code, so the package must be installed wherever the production build runs. `devDependencies` is fine as
  long as the build installs them (the default); if the build uses `npm ci --omit=dev`, put it in `dependencies`.
- **What Confirm writes**:
  - image found in the project (`public/hero.png`, `src/assets/hero.png`, `next/image` sources, hashed bundler
    URLs): a new file is saved next to it as `hero-edit.png` (`-2`, `-3`... if taken) and every string or import
    pointing at the old file is changed to the new name. The original file is kept.
  - "Overwrite the original" (Save tab) replaces the file in place and leaves the code alone.
  - remote image (`https://...`) or an image with no file in the project: saved to `public/img-pilot/` and
    literal occurrences of the old URL in the source are replaced with the new `/img-pilot/...` path.
  - URLs that come from a CMS, a database or are built at runtime cannot be relinked. The file is still saved
    and its path is copied to the clipboard.
- The user reviews the list of references in the Save tab and can untick any of them before confirming.
- CSS background images can be picked by holding `Alt` while hovering.
- `<ImgPilot />` props: `endpoint`, `enabled`, `lang` (`'pl' | 'en'`, default: browser language), `minSize`
  (default 40), `position` (`'bottom-right'` default, `'bottom-left'`, `'top-right'`, `'top-left'`).
- Server options (pass to `createNextHandlers(options)` from `'img-pilot/next'`, `imgPilot(options)` from
  `'img-pilot/vite'`, or `createNodeMiddleware(options)` / `createImgPilotHandler(options)` from
  `'img-pilot/server'`): `root`, `publicDir`, `outDir`, `openaiApiKey`, `geminiApiKey`, `openaiModel`,
  `geminiModel`, `allowedHosts`, `allowInProduction`. In a monorepo `root` defaults to the directory the dev
  server was started from, which is normally the app package and is what you want.

## Do not

- Do not expose the API in production or set `allowInProduction`; it writes to the source tree.
- Do not mount `<ImgPilot />` more than once, and not at all when using the Vite plugin.
- Do not wrap images or change existing components; no per-image setup is needed.
