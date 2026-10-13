import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DEFAULT_ENDPOINT, type ApplyResult, type StatusResult } from '../shared';
import { createApi } from './api';
import { Editor, type EditorAction, type EditorState, type Target } from './Editor';
import type { Dict } from './i18n';
import { dictFor, type Lang } from './i18n';
import { Icon } from './icons';
import { css } from './styles';

export interface ImgPilotProps {
  /** URL of the img-pilot API. Defaults to "/api/img-pilot". */
  endpoint?: string;
  /** Defaults to true outside of production builds. */
  enabled?: boolean;
  /** UI language. Defaults to the browser language. */
  lang?: Lang;
  /** Images smaller than this (in CSS pixels, on both axes) are ignored. Defaults to 40. */
  minSize?: number;
  /** Corner of the on/off pill. Defaults to "bottom-right". */
  position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
}

const HOST_ATTR = 'data-img-pilot-root';
const STORAGE_KEY = 'img-pilot:on';

function isProduction() {
  try {
    // Written so bundlers can replace process.env.NODE_ENV; where they do not, `process` is simply undefined.
    return process.env.NODE_ENV === 'production';
  } catch {
    return false;
  }
}

function readStoredToggle() {
  try {
    return localStorage.getItem(STORAGE_KEY) !== '0';
  } catch {
    return true;
  }
}

interface Hover {
  target: Target;
  rect: DOMRect;
}

/** One editor per image. Sessions outlive the editor window, so AI can finish while the user keeps browsing. */
interface Session extends EditorState {
  id: string;
  target: Target | null;
  action: EditorAction;
  label: string;
}

const sessionId = (target: Target | null) => target?.src ?? 'new';

function labelFor(target: Target | null, t: Dict) {
  if (!target) return t.newImage;
  if (target.src.startsWith('data:')) return t.title;
  try {
    const url = new URL(target.src, location.href);
    const inner = url.pathname.endsWith('/_next/image') ? url.searchParams.get('url') : null;
    return decodeURIComponent((inner ?? url.pathname).split('/').pop() ?? '') || t.title;
  } catch {
    return t.title;
  }
}

function App({ host, endpoint = DEFAULT_ENDPOINT, lang, minSize = 40, position = 'bottom-right' }: ImgPilotProps & { host: HTMLElement }) {
  const api = useMemo(() => createApi(endpoint), [endpoint]);
  const t = useMemo(() => dictFor(lang), [lang]);
  const [status, setStatus] = useState<StatusResult | null>(null);
  const [on, setOn] = useState(readStoredToggle);
  const [hover, setHover] = useState<Hover | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ title: string; text: string; session?: string } | null>(null);
  const openRef = useRef(openId);
  openRef.current = openId;
  const editor = openId !== null;
  const hideTimer = useRef<number>();

  useEffect(() => {
    // No reachable API (production build, route not mounted) means no UI at all.
    api.status().then(setStatus, (e) => console.info('[img-pilot] disabled:', e instanceof Error ? e.message : e));
  }, [api]);

  const toggle = useCallback(() => {
    setOn((value) => {
      try {
        localStorage.setItem(STORAGE_KEY, value ? '0' : '1');
      } catch {
        // storage unavailable
      }
      return !value;
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.code === 'KeyI') toggle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);

  const active = !!status && on && !editor;

  useEffect(() => {
    if (!active) {
      setHover(null);
      return;
    }
    let frame = 0;
    let last: MouseEvent | null = null;

    const find = (e: MouseEvent): Hover | null => {
      for (const el of document.elementsFromPoint(e.clientX, e.clientY)) {
        if (el === host) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width < minSize || rect.height < minSize) continue;
        if (el instanceof HTMLImageElement) {
          const src = el.currentSrc || el.src;
          if (src) return { target: { el, kind: 'img', src, attr: el.getAttribute('src') }, rect };
        } else if (e.altKey && el instanceof HTMLElement) {
          const match = /url\((["']?)(.+?)\1\)/.exec(getComputedStyle(el).backgroundImage);
          if (match) return { target: { el, kind: 'bg', src: new URL(match[2], location.href).href, attr: match[2] }, rect };
        }
      }
      return null;
    };

    const tick = () => {
      frame = 0;
      const e = last!;
      // Pointer is over our own toolbar: keep the current target.
      if (document.elementFromPoint(e.clientX, e.clientY) === host) return window.clearTimeout(hideTimer.current);
      const found = find(e);
      window.clearTimeout(hideTimer.current);
      if (found) setHover((prev) => (prev?.target.el === found.target.el && prev.rect.top === found.rect.top && prev.rect.left === found.rect.left ? prev : found));
      else hideTimer.current = window.setTimeout(() => setHover(null), 250);
    };
    const onMove = (e: MouseEvent) => {
      last = e;
      frame ||= requestAnimationFrame(tick);
    };
    const onScroll = () => setHover(null);

    document.addEventListener('mousemove', onMove, true);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(hideTimer.current);
      document.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [active, host, minSize]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 7000);
    return () => window.clearTimeout(id);
  }, [toast]);

  const open = (target: Target | null, action: EditorAction) => {
    const id = sessionId(target);
    setHover(null);
    setSessions((list) =>
      list.some((s) => s.id === id)
        ? list
        : [...list, { id, target, action, label: labelFor(target, t), working: false, dirty: false, failed: false }],
    );
    setOpenId(id);
  };

  const close = (id: string, keep: boolean) => {
    setOpenId((current) => (current === id ? null : current));
    if (!keep) setSessions((list) => list.filter((s) => s.id !== id));
  };

  const report = (id: string, state: EditorState) => {
    setSessions((list) =>
      list.map((s) => {
        if (s.id !== id) return s;
        // AI finished while the editor was closed: tell the user where the result is.
        if (s.working && !state.working && openRef.current !== id) {
          setToast({ title: `${state.failed ? t.aiFailed : t.aiReady}: ${s.label}`, text: t.clickToOpen, session: id });
        }
        return { ...s, ...state };
      }),
    );
  };

  const done = (id: string, target: Target | null, result: ApplyResult) => {
    close(id, false);

    // Show the new image straight away; the framework's hot reload follows with the real markup.
    if (target?.el && result.publicPath) {
      const url = `${result.publicPath}?v=${Date.now()}`;
      if (target.kind === 'bg') {
        target.el.style.backgroundImage = `url("${url}")`;
      } else {
        const img = target.el as HTMLImageElement;
        img.removeAttribute('srcset');
        img.closest('picture')?.querySelectorAll('source').forEach((source) => source.setAttribute('srcset', url));
        img.src = url;
      }
    }

    const lines = result.updated.map((u) => `${t.relinked}: ${u.file}:${u.line}`);
    if (!result.overwritten && !result.updated.length) {
      const path = result.publicPath ?? result.file;
      navigator.clipboard?.writeText(path).catch(() => {});
      lines.push(`${t.copied}: ${path}`);
    }
    setToast({ title: `${t.savedAs} ${result.file}`, text: lines.join('\n') });
  };

  if (!status) return null;

  const barLeft = hover ? Math.max(8, Math.min(hover.rect.left + 8, window.innerWidth - 330)) : 0;
  const barTop = hover ? Math.max(8, Math.min(hover.rect.top + 8, window.innerHeight - 48)) : 0;

  return (
    <>
      {hover && !editor && (
        <>
          <div className="outline" style={{ left: hover.rect.left, top: hover.rect.top, width: hover.rect.width, height: hover.rect.height }} />
          <div className="hoverbar" style={{ left: barLeft, top: barTop }}>
            {sessions.some((s) => s.id === sessionId(hover.target)) ? (
              <button onClick={() => open(hover.target, 'edit')}>
                <Icon name="pencil" />
                {t.resume}
              </button>
            ) : (
              <>
                <button onClick={() => open(hover.target, 'edit')}>
                  <Icon name="pencil" />
                  {t.edit}
                </button>
                <button onClick={() => open(hover.target, 'generate')}>
                  <Icon name="sparkles" />
                  {t.generate}
                </button>
                <button onClick={() => open(hover.target, 'remove-bg')}>
                  <Icon name="layers" />
                  {t.removeBg}
                </button>
              </>
            )}
          </div>
        </>
      )}

      {!editor && (
        <div className={`launcher ${position}`}>
          <button title={t.toggleHint} onClick={toggle}>
            <span className={on ? 'dot on' : 'dot'} />
            img-pilot
          </button>
          {sessions.map((s) => (
            <button
              key={s.id}
              className="chip"
              title={`${s.label} · ${s.working ? t.stateWorking : s.failed ? t.aiFailed : t.stateDraft}`}
              onClick={() => setOpenId(s.id)}
            >
              {s.working ? <span className="spin" /> : <span className={s.failed ? 'dot fail' : 'dot draft'} />}
              <span>{s.label}</span>
            </button>
          ))}
          {!sessions.some((s) => s.id === 'new') && (
            <button title={t.newImage} onClick={() => open(null, 'generate')}>
              <Icon name="plus" />
              {t.newImage}
            </button>
          )}
        </div>
      )}

      {sessions.map((s) => (
        <Editor
          key={s.id}
          api={api}
          status={status}
          t={t}
          target={s.target}
          action={s.action}
          hidden={s.id !== openId}
          onClose={(keep) => close(s.id, keep)}
          onState={(state) => report(s.id, state)}
          onDone={(result) => done(s.id, s.target, result)}
        />
      ))}

      {toast && (
        <div
          className={toast.session ? 'toast link' : 'toast'}
          onClick={() => {
            if (toast.session && sessions.some((s) => s.id === toast.session)) setOpenId(toast.session);
            setToast(null);
          }}
        >
          <b>{toast.title}</b>
          {toast.text && `\n${toast.text}`}
        </div>
      )}
    </>
  );
}

export interface ImgPilotHandle {
  update(props: ImgPilotProps): void;
  unmount(): void;
}

/** Mounts the editor UI outside of your React tree, inside a shadow root so page styles cannot leak in. */
export function mountImgPilot(props: ImgPilotProps = {}): ImgPilotHandle {
  if (typeof document === 'undefined' || document.querySelector(`[${HOST_ATTR}]`)) {
    return { update() {}, unmount() {} };
  }
  const host = document.createElement('div');
  host.setAttribute(HOST_ATTR, '');
  host.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = css;
  const mount = document.createElement('div');
  mount.className = 'ip';
  shadow.append(style, mount);
  document.body.appendChild(host);

  // Own root inside the shadow tree: React's event delegation does not work through a portal into one.
  const root = createRoot(mount);
  const render = (next: ImgPilotProps) => root.render(<App {...next} host={host} />);
  render(props);

  return {
    update: render,
    unmount() {
      host.remove();
      // deferred: React forbids unmounting a root synchronously while another one is rendering
      setTimeout(() => root.unmount(), 0);
    },
  };
}

/** Drop this once near the root of your app. Renders nothing itself and is inert in production builds. */
export function ImgPilot(props: ImgPilotProps) {
  const enabled = props.enabled ?? !isProduction();
  const handle = useRef<ImgPilotHandle | null>(null);
  const { endpoint, lang, minSize, position } = props;

  useEffect(() => {
    if (!enabled) return;
    const mounted = mountImgPilot({ endpoint, lang, minSize, position });
    handle.current = mounted;
    return () => {
      handle.current = null;
      mounted.unmount();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  useEffect(() => {
    handle.current?.update({ endpoint, lang, minSize, position });
  }, [endpoint, lang, minSize, position]);

  return null;
}
