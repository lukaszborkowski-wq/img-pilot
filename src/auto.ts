import { mountImgPilot, type ImgPilotProps } from './client/ImgPilot';

declare global {
  interface Window {
    __IMG_PILOT__?: ImgPilotProps;
  }
}

// Side-effect entry: `import 'img-pilot/auto'` mounts the UI without touching the component tree.
if (typeof window !== 'undefined') {
  const start = () => mountImgPilot(window.__IMG_PILOT__ ?? {});
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
}

export {};
