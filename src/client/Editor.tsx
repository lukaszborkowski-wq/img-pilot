import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import type { ApplyResult, InspectResult, Provider, StatusResult } from '../shared';
import type { Api } from './api';
import * as cv from './canvas';
import type { Cv, Rect } from './canvas';
import type { Dict } from './i18n';
import { Icon } from './icons';

export interface Target {
  el: HTMLElement | null;
  kind: 'img' | 'bg';
  src: string;
  attr: string | null;
}

export type EditorAction = 'edit' | 'generate' | 'remove-bg';

interface Props {
  api: Api;
  status: StatusResult;
  t: Dict;
  target: Target | null;
  action: EditorAction;
  /** A hidden editor stays mounted, so its history and any running AI request survive closing the window. */
  hidden: boolean;
  /** `keep` is true when there is something worth coming back to (edits or AI still working). */
  onClose(keep: boolean): void;
  onState(state: EditorState): void;
  onDone(result: ApplyResult): void;
}

export interface EditorState {
  working: boolean;
  dirty: boolean;
  failed: boolean;
}

type Tab = 'crop' | 'adjust' | 'erase' | 'ai' | 'save';

const FORMATS = [
  { mime: 'image/png', ext: 'png', label: 'PNG' },
  { mime: 'image/jpeg', ext: 'jpg', label: 'JPEG' },
  { mime: 'image/webp', ext: 'webp', label: 'WebP' },
];
const CROP_ASPECTS = ['free', 'orig', '1:1', '4:3', '3:2', '16:9', '9:16'];
const GEN_ASPECTS = ['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16'];
const ADJUST = { brightness: 100, contrast: 100, saturate: 100, hue: 0, blur: 0, grayscale: 0, sepia: 0 };
const HISTORY_LIMIT = 25;

const filterCss = (a: typeof ADJUST, blurScale = 1) =>
  `brightness(${a.brightness}%) contrast(${a.contrast}%) saturate(${a.saturate}%) hue-rotate(${a.hue}deg) ` +
  `grayscale(${a.grayscale}%) sepia(${a.sepia}%)${a.blur ? ` blur(${a.blur * blurScale}px)` : ''}`;

const parseAspect = (value: string) => Number(value.split(':')[0]) / Number(value.split(':')[1]);
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function slugify(text: string) {
  const slug = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.split('-').slice(0, 5).join('-') || 'image';
}

function Slider(props: { label: string; value: number; min: number; max: number; unit?: string; onChange(v: number): void }) {
  return (
    <label className="field">
      <span>
        {props.label}
        <b>
          {props.value}
          {props.unit}
        </b>
      </span>
      <input type="range" min={props.min} max={props.max} value={props.value} onChange={(e) => props.onChange(Number(e.target.value))} />
    </label>
  );
}

function Field(props: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{props.label}</span>
      {props.children}
    </label>
  );
}

export function Editor({ api, status, t, target, action, hidden, onClose, onState, onDone }: Props) {
  const [info, setInfo] = useState<InspectResult | null>(null);
  const [hist, setHist] = useState<{ list: Cv[]; idx: number }>({ list: [], idx: -1 });
  const [tab, setTab] = useState<Tab>(target && action !== 'generate' ? 'crop' : 'ai');
  const [busy, setBusy] = useState<string | null>(target ? t.loading : null);
  const [error, setError] = useState<string | null>(null);
  const [provider, setProvider] = useState<Provider>(status.providers.openai || !status.providers.gemini ? 'openai' : 'gemini');

  const [adjust, setAdjust] = useState(ADJUST);
  const [cropRect, setCropRect] = useState<Rect | null>(null);
  const [cropAspect, setCropAspect] = useState('free');
  const [size, setSize] = useState({ w: 0, h: 0, lock: true });
  const [eraseTool, setEraseTool] = useState<'brush' | 'wand'>('brush');
  const [brush, setBrush] = useState(40);
  const [tolerance, setTolerance] = useState(18);
  const [fillPrompt, setFillPrompt] = useState('');
  const [editPrompt, setEditPrompt] = useState('');
  const [genPrompt, setGenPrompt] = useState('');
  const [genAspect, setGenAspect] = useState(target ? 'orig' : '1:1');

  const [format, setFormat] = useState('image/png');
  const [quality, setQuality] = useState(90);
  const [stem, setStem] = useState('image');
  const [mode, setMode] = useState<'new' | 'overwrite'>('new');
  const [refs, setRefs] = useState<Set<string>>(new Set());
  const [stage, setStage] = useState({ w: 0, h: 0 });

  const original = useRef<Cv | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<HTMLCanvasElement>(null);
  const maskRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ type: 'move'; ox: number; oy: number } | { type: 'size'; ax: number; ay: number } | null>(null);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);

  const current = hist.list[hist.idx] ?? null;
  const W = current?.width ?? 1;
  const H = current?.height ?? 1;
  const scale = current && stage.w ? Math.min((stage.w - 48) / W, (stage.h - 48) / H, 4) : 1;
  const adjustDirty = (Object.keys(ADJUST) as (keyof typeof ADJUST)[]).some((k) => adjust[k] !== ADJUST[k]);
  const hasAi = status.providers.openai || status.providers.gemini;
  const fmt = FORMATS.find((f) => f.mime === format)!;
  const originalExt = info?.file?.split('.').pop()?.toLowerCase().replace('jpeg', 'jpg');
  const canOverwrite = info?.kind === 'file' && originalExt === fmt.ext;
  const overwrite = mode === 'overwrite' && canOverwrite;
  const dir = info?.dir ?? status.outDir;
  const destination = overwrite ? info!.file! : `${dir}/${stem || 'image'}.${fmt.ext}`;
  const references = info?.references ?? [];

  const push = (c: Cv) => {
    if (!original.current) original.current = c;
    if (format === 'image/jpeg' && cv.hasAlpha(c)) setFormat('image/png');
    setHist((h) => {
      const list = [...h.list.slice(0, h.idx + 1), c].slice(-HISTORY_LIMIT);
      return { list, idx: list.length - 1 };
    });
  };

  const run = async (label: string, fn: () => Promise<void> | void) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  /** Bakes pending slider changes into the image so every other tool works on what the user sees. */
  const commitAdjust = (): Cv | null => {
    if (!current || !adjustDirty) return current;
    const out = cv.applyFilter(current, filterCss(adjust));
    setAdjust(ADJUST);
    push(out);
    return out;
  };

  const selectTab = (next: Tab) => {
    commitAdjust();
    setTab(next);
  };

  // ---- AI ------------------------------------------------------------------------------------

  const removeBackground = async (source: Cv) => {
    const { width: w, height: h } = source;
    if (provider === 'openai') {
      const pad = cv.padForOpenAi(source);
      const res = await api.ai({ provider, op: 'remove-bg', image: cv.toPng(pad.canvas), size: `${pad.canvas.width}x${pad.canvas.height}` });
      const result = await cv.fromUrl(res.dataUrl);
      const k = result.width / pad.canvas.width;
      const part = cv.crop(result, { x: pad.rect.x * k, y: pad.rect.y * k, w: pad.rect.w * k, h: pad.rect.h * k });
      push(part.width < w ? cv.resize(part, w, h) : part);
    } else {
      // Gemini cannot output transparency: ask for a flat backdrop and key it out locally.
      const res = await api.ai({ provider, op: 'remove-bg', image: cv.toPng(cv.limit(source, 2048)), keyColor: cv.pickKeyColor(source) });
      push(cv.removeFlatBackground(cv.fitResult(await cv.fromUrl(res.dataUrl), w, h)));
    }
  };

  const eraseSelection = async (source: Cv) => {
    const mask = maskRef.current!;
    if (cv.isMaskEmpty(mask)) throw new Error(t.needMask);
    const prompt = fillPrompt.trim() || undefined;
    let result: Cv;
    if (provider === 'openai') {
      const pad = cv.padForOpenAi(source);
      const { width: pw, height: ph } = pad.canvas;
      const res = await api.ai({
        provider,
        op: 'erase',
        prompt,
        image: cv.toPng(pad.canvas),
        mask: cv.toPng(cv.openAiMask(mask, pw, ph, pad.rect)),
        size: `${pw}x${ph}`,
      });
      const full = await cv.fromUrl(res.dataUrl);
      const k = full.width / pw;
      result = cv.crop(full, { x: pad.rect.x * k, y: pad.rect.y * k, w: pad.rect.w * k, h: pad.rect.h * k });
    } else {
      const image = cv.limit(source, 2048);
      const res = await api.ai({
        provider,
        op: 'erase',
        prompt,
        image: cv.toPng(image),
        mask: cv.toPng(cv.blackWhiteMask(mask, image.width, image.height)),
      });
      result = cv.coverCrop(await cv.fromUrl(res.dataUrl), source.width / source.height);
    }
    push(cv.compositeMasked(source, result, mask));
  };

  const editWithPrompt = async (source: Cv) => {
    const prompt = editPrompt.trim();
    if (!prompt) throw new Error(t.needPrompt);
    const image = cv.limit(source, provider === 'openai' ? 1536 : 2048);
    const [sw, sh] = cv.nearestOpenAiSize(source.width / source.height);
    const res = await api.ai({ provider, op: 'edit', prompt, image: cv.toPng(image), size: `${sw}x${sh}` });
    push(cv.fitResult(await cv.fromUrl(res.dataUrl), source.width, source.height));
  };

  const generate = async () => {
    const prompt = genPrompt.trim();
    if (!prompt) throw new Error(t.needPrompt);
    const base = original.current;
    const aspect = genAspect === 'orig' ? (base ? base.width / base.height : 1) : parseAspect(genAspect);
    const [sw, sh] = cv.nearestOpenAiSize(aspect);
    const res = await api.ai({ provider, op: 'generate', prompt, size: `${sw}x${sh}`, aspect: cv.nearestGeminiAspect(aspect) });
    push(cv.coverCrop(await cv.fromUrl(res.dataUrl), aspect));
    if (!target) setStem(slugify(prompt));
  };

  const ai = (fn: (source: Cv) => Promise<void>) =>
    run(t.working, async () => {
      const source = commitAdjust();
      if (source) await fn(source);
    });

  // ---- lifecycle -----------------------------------------------------------------------------

  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    (async () => {
      try {
        const inspected = await api.inspect({ src: target.src, attr: target.attr, pageUrl: location.href });
        let image: Cv;
        try {
          image = await cv.fromUrl(inspected.dataUrl ?? target.src);
        } catch {
          image = await cv.fromUrl(target.src);
        }
        if (cancelled) return;
        setInfo(inspected);
        setStem(inspected.stem);
        setRefs(new Set(inspected.references.map((r) => r.id)));
        setFormat(FORMATS.some((f) => f.mime === inspected.mime) ? inspected.mime! : 'image/png');
        original.current = image;
        setHist({ list: [image], idx: 0 });
        if (action === 'remove-bg') {
          setTab('erase');
          setBusy(t.working);
          await removeBackground(image);
        }
      } catch (e) {
        if (!cancelled) setError(errorText(e));
      } finally {
        if (!cancelled) setBusy(null);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = stageRef.current!;
    const observer = new ResizeObserver(() => setStage({ w: el.clientWidth, h: el.clientHeight }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const draw = (source: Cv | null) => {
    const view = viewRef.current;
    if (!view || !source) return;
    view.width = source.width;
    view.height = source.height;
    view.getContext('2d')!.drawImage(source, 0, 0);
  };

  useEffect(() => {
    if (!current) return;
    draw(current);
    const mask = maskRef.current!;
    mask.width = current.width; // also clears it
    mask.height = current.height;
    setCropRect({ x: 0, y: 0, w: current.width, h: current.height });
    setCropAspect('free');
    setSize((s) => ({ ...s, w: current.width, h: current.height }));
  }, [current]);

  const working = busy === t.working;
  const dirty = adjustDirty || hist.list.length > (target ? 1 : 0);
  const failed = !!error;
  const requestClose = () => onClose(working || dirty);
  const closeRef = useRef(requestClose);
  closeRef.current = requestClose;

  useEffect(() => {
    onState({ working, dirty, failed });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [working, dirty, failed]);

  useEffect(() => {
    if (hidden) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.composedPath()[0] as HTMLElement)?.tagName ?? '');
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing) {
        e.preventDefault();
        setHist((h) => ({ ...h, idx: clamp(h.idx + (e.shiftKey ? 1 : -1), 0, h.list.length - 1) }));
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [hidden]);

  // ---- pointer tools -------------------------------------------------------------------------

  const point = (e: ReactPointerEvent) => {
    const r = wrapRef.current!.getBoundingClientRect();
    return { x: clamp(((e.clientX - r.left) * W) / r.width, 0, W), y: clamp(((e.clientY - r.top) * H) / r.height, 0, H) };
  };

  const cropRatio = cropAspect === 'free' ? null : cropAspect === 'orig' ? W / H : parseAspect(cropAspect);

  const chooseCropAspect = (value: string) => {
    setCropAspect(value);
    const ratio = value === 'free' || value === 'orig' ? null : parseAspect(value);
    if (!ratio) return setCropRect({ x: 0, y: 0, w: W, h: H });
    const w = W / H > ratio ? H * ratio : W;
    const h = W / H > ratio ? H : W / ratio;
    setCropRect({ x: (W - w) / 2, y: (H - h) / 2, w, h });
  };

  const cropDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!cropRect) return;
    const handle = (e.target as HTMLElement).dataset.h;
    const p = point(e);
    e.currentTarget.setPointerCapture(e.pointerId);
    if (handle === 'move') {
      drag.current = { type: 'move', ox: p.x - cropRect.x, oy: p.y - cropRect.y };
    } else if (handle) {
      // resizing keeps the opposite corner fixed
      drag.current = {
        type: 'size',
        ax: handle.includes('w') ? cropRect.x + cropRect.w : cropRect.x,
        ay: handle.includes('n') ? cropRect.y + cropRect.h : cropRect.y,
      };
    } else {
      drag.current = { type: 'size', ax: p.x, ay: p.y };
    }
  };

  const cropMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d || !cropRect) return;
    const p = point(e);
    if (d.type === 'move') {
      return setCropRect({ ...cropRect, x: clamp(p.x - d.ox, 0, W - cropRect.w), y: clamp(p.y - d.oy, 0, H - cropRect.h) });
    }
    let w = Math.abs(p.x - d.ax);
    let h = Math.abs(p.y - d.ay);
    if (cropRatio) {
      const maxW = p.x >= d.ax ? W - d.ax : d.ax;
      const maxH = p.y >= d.ay ? H - d.ay : d.ay;
      w = Math.min(w, maxW, maxH * cropRatio);
      h = w / cropRatio;
    }
    setCropRect({ x: p.x >= d.ax ? d.ax : d.ax - w, y: p.y >= d.ay ? d.ay : d.ay - h, w, h });
  };

  const applyCrop = () => {
    if (!current || !cropRect || cropRect.w < 2 || cropRect.h < 2) return;
    push(cv.crop(current, { x: Math.round(cropRect.x), y: Math.round(cropRect.y), w: Math.round(cropRect.w), h: Math.round(cropRect.h) }));
  };

  const paint = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const x = maskRef.current!.getContext('2d')!;
    const width = brush / scale;
    x.strokeStyle = x.fillStyle = '#ff2d6f';
    x.lineCap = x.lineJoin = 'round';
    x.lineWidth = width;
    x.beginPath();
    x.moveTo(from.x, from.y);
    x.lineTo(to.x, to.y);
    x.stroke();
    x.beginPath();
    x.arc(to.x, to.y, width / 2, 0, Math.PI * 2);
    x.fill();
  };

  const maskDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!current || busy) return;
    const p = point(e);
    if (eraseTool === 'wand') return push(cv.floodErase(current, p.x, p.y, tolerance));
    e.currentTarget.setPointerCapture(e.pointerId);
    lastPoint.current = p;
    paint(p, p);
  };

  const maskMove = (e: ReactPointerEvent) => {
    if (!lastPoint.current) return;
    const p = point(e);
    paint(lastPoint.current, p);
    lastPoint.current = p;
  };

  const clearMask = () => {
    const mask = maskRef.current!;
    mask.getContext('2d')!.clearRect(0, 0, mask.width, mask.height);
  };

  // ---- save ----------------------------------------------------------------------------------

  const confirm = () =>
    run(t.saving, async () => {
      const final = commitAdjust();
      if (!final) return;
      const result = await api.apply({
        src: target?.src ?? null,
        attr: target?.attr ?? null,
        pageUrl: location.href,
        dataUrl: cv.toDataUrl(final, format, quality / 100),
        mode: overwrite ? 'overwrite' : 'new',
        fileName: `${stem || 'image'}.${fmt.ext}`,
        refs: [...refs],
      });
      onDone(result);
    });

  const setDimension = (key: 'w' | 'h', value: number) => {
    const v = clamp(Math.round(value) || 1, 1, 8192);
    const ratio = W / H;
    setSize((s) => (key === 'w' ? { ...s, w: v, h: s.lock ? Math.max(1, Math.round(v / ratio)) : s.h } : { ...s, h: v, w: s.lock ? Math.max(1, Math.round(v * ratio)) : s.w }));
  };

  const pct = (v: number, total: number) => `${(v / total) * 100}%`;
  const disabled = !current || !!busy;
  const aiDisabled = disabled || !hasAi;

  const providerPicker = hasAi ? (
    <Field label={t.provider}>
      <select value={provider} onChange={(e) => setProvider(e.target.value as Provider)}>
        {status.providers.openai && <option value="openai">OpenAI · {status.models.openai}</option>}
        {status.providers.gemini && <option value="gemini">Gemini · {status.models.gemini}</option>}
      </select>
    </Field>
  ) : (
    <p className="note">{t.noProvider}</p>
  );

  return (
    <div style={{ display: hidden ? 'none' : 'contents' }}>
      <div className="backdrop" />
      <div className="editor" onKeyDown={(e) => e.stopPropagation()}>
        <div className="head">
          <h1>{target ? t.title : t.titleNew}</h1>
          {current && (
            <span className="meta">
              {W} × {H}
            </span>
          )}
          <span className="grow" />
          <button className="btn icon" title={t.undo} disabled={!!busy || hist.idx <= 0} onClick={() => setHist((h) => ({ ...h, idx: h.idx - 1 }))}>
            <Icon name="undo" />
          </button>
          <button className="btn icon" title={t.redo} disabled={!!busy || hist.idx >= hist.list.length - 1} onClick={() => setHist((h) => ({ ...h, idx: h.idx + 1 }))}>
            <Icon name="redo" />
          </button>
          <button
            className="btn icon"
            title={t.compare}
            disabled={disabled}
            onPointerDown={() => draw(original.current)}
            onPointerUp={() => draw(current)}
            onPointerLeave={() => draw(current)}
          >
            <Icon name="eye" />
          </button>
          <button
            className="btn icon"
            title={t.reset}
            disabled={disabled || current === original.current}
            onClick={() => {
              setAdjust(ADJUST);
              if (original.current) push(original.current);
            }}
          >
            <Icon name="reset" />
          </button>
          <button className="btn icon" title={t.closeKeep} onClick={requestClose}>
            <Icon name="x" />
          </button>
        </div>

        <div className="stage" ref={stageRef}>
          {!current && !busy && <p className="empty">{t.empty}</p>}
          <div ref={wrapRef} className="wrap" style={{ width: W * scale, height: H * scale, display: current ? 'block' : 'none' }}>
            <canvas ref={viewRef} style={{ filter: adjustDirty ? filterCss(adjust, scale) : undefined }} />
            <canvas
              ref={maskRef}
              className={tab === 'erase' ? 'mask show' : 'mask'}
              onPointerDown={maskDown}
              onPointerMove={maskMove}
              onPointerUp={() => (lastPoint.current = null)}
              onPointerCancel={() => (lastPoint.current = null)}
            />
            {tab === 'crop' && cropRect && (
              <div className="crop-layer" onPointerDown={cropDown} onPointerMove={cropMove} onPointerUp={() => (drag.current = null)}>
                <div
                  className="crop-box"
                  data-h="move"
                  style={{ left: pct(cropRect.x, W), top: pct(cropRect.y, H), width: pct(cropRect.w, W), height: pct(cropRect.h, H) }}
                >
                  {['nw', 'ne', 'sw', 'se'].map((h) => (
                    <i key={h} className={h} data-h={h} />
                  ))}
                </div>
              </div>
            )}
          </div>
          {busy && (
            <div className="busy">
              <div className="spin" />
              {busy}
            </div>
          )}
        </div>

        <div className="side">
          <div className="tabs">
            {(
              [
                ['crop', t.tabCrop],
                ['adjust', t.tabAdjust],
                ['erase', t.tabErase],
                ['ai', t.tabAi],
                ['save', t.tabSave],
              ] as [Tab, string][]
            ).map(([id, label]) => (
              <button key={id} className={tab === id ? 'on' : ''} disabled={!current && id !== 'ai'} onClick={() => selectTab(id)}>
                {label}
              </button>
            ))}
          </div>

          <div className="body">
            {error && (
              <p className="error" onClick={() => setError(null)}>
                {error}
              </p>
            )}

            {tab === 'crop' && (
              <>
                <Field label={t.aspect}>
                  <select value={cropAspect} onChange={(e) => chooseCropAspect(e.target.value)}>
                    {CROP_ASPECTS.map((a) => (
                      <option key={a} value={a}>
                        {a === 'free' ? t.free : a === 'orig' ? t.original : a}
                      </option>
                    ))}
                  </select>
                </Field>
                <button className="btn primary block" disabled={disabled || !cropRect || (cropRect.w >= W - 1 && cropRect.h >= H - 1)} onClick={applyCrop}>
                  {t.applyCrop}
                  {cropRect && ` · ${Math.round(cropRect.w)} × ${Math.round(cropRect.h)}`}
                </button>
                <div className="row">
                  <button className="btn" disabled={disabled} onClick={() => push(cv.rotate90(current!, -1))}>
                    {t.rotateLeft}
                  </button>
                  <button className="btn" disabled={disabled} onClick={() => push(cv.rotate90(current!, 1))}>
                    {t.rotateRight}
                  </button>
                  <button className="btn" disabled={disabled} onClick={() => push(cv.flip(current!, true))}>
                    {t.flipH}
                  </button>
                  <button className="btn" disabled={disabled} onClick={() => push(cv.flip(current!, false))}>
                    {t.flipV}
                  </button>
                </div>
                <h2>{t.resize}</h2>
                <div className="row">
                  <Field label={t.width}>
                    <input type="number" min={1} value={size.w} onChange={(e) => setDimension('w', Number(e.target.value))} />
                  </Field>
                  <Field label={t.height}>
                    <input type="number" min={1} value={size.h} onChange={(e) => setDimension('h', Number(e.target.value))} />
                  </Field>
                </div>
                <label className="check">
                  <input type="checkbox" checked={size.lock} onChange={(e) => setSize((s) => ({ ...s, lock: e.target.checked }))} />
                  {t.lock}
                </label>
                <button className="btn block" disabled={disabled || (size.w === W && size.h === H)} onClick={() => push(cv.resize(current!, size.w, size.h))}>
                  {t.applyResize}
                </button>
              </>
            )}

            {tab === 'adjust' && (
              <>
                <Slider label={t.brightness} value={adjust.brightness} min={0} max={200} unit="%" onChange={(v) => setAdjust({ ...adjust, brightness: v })} />
                <Slider label={t.contrast} value={adjust.contrast} min={0} max={200} unit="%" onChange={(v) => setAdjust({ ...adjust, contrast: v })} />
                <Slider label={t.saturation} value={adjust.saturate} min={0} max={200} unit="%" onChange={(v) => setAdjust({ ...adjust, saturate: v })} />
                <Slider label={t.hue} value={adjust.hue} min={-180} max={180} unit="°" onChange={(v) => setAdjust({ ...adjust, hue: v })} />
                <Slider label={t.blur} value={adjust.blur} min={0} max={40} unit="px" onChange={(v) => setAdjust({ ...adjust, blur: v })} />
                <Slider label={t.grayscale} value={adjust.grayscale} min={0} max={100} unit="%" onChange={(v) => setAdjust({ ...adjust, grayscale: v })} />
                <Slider label={t.sepia} value={adjust.sepia} min={0} max={100} unit="%" onChange={(v) => setAdjust({ ...adjust, sepia: v })} />
                <button className="btn block" disabled={!adjustDirty} onClick={() => setAdjust(ADJUST)}>
                  {t.resetAdjust}
                </button>
              </>
            )}

            {tab === 'erase' && (
              <>
                {providerPicker}
                <h2>{t.background}</h2>
                <button className="btn primary block" disabled={aiDisabled} onClick={() => ai(removeBackground)}>
                  <Icon name="layers" />
                  {t.removeBgAi}
                </button>
                <h2>{t.tabErase}</h2>
                <div className="row">
                  <button className={eraseTool === 'brush' ? 'btn active' : 'btn'} onClick={() => setEraseTool('brush')}>
                    {t.brush}
                  </button>
                  <button className={eraseTool === 'wand' ? 'btn active' : 'btn'} onClick={() => setEraseTool('wand')}>
                    {t.wand}
                  </button>
                </div>
                {eraseTool === 'brush' ? (
                  <>
                    <p className="hint">{t.brushHint}</p>
                    <Slider label={t.brushSize} value={brush} min={6} max={160} unit="px" onChange={setBrush} />
                    <Field label={t.fillPrompt}>
                      <input type="text" value={fillPrompt} onChange={(e) => setFillPrompt(e.target.value)} />
                    </Field>
                    <button className="btn primary block" disabled={aiDisabled} onClick={() => ai(eraseSelection)}>
                      <Icon name="eraser" />
                      {t.eraseAi}
                    </button>
                    <div className="row">
                      <button
                        className="btn"
                        disabled={disabled}
                        onClick={() => run(t.loading, () => {
                          if (cv.isMaskEmpty(maskRef.current!)) throw new Error(t.needMask);
                          push(cv.cutMask(current!, maskRef.current!));
                        })}
                      >
                        {t.cut}
                      </button>
                      <button className="btn" disabled={disabled} onClick={clearMask}>
                        {t.clearMask}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="hint">{t.wandHint}</p>
                    <Slider label={t.tolerance} value={tolerance} min={1} max={100} onChange={setTolerance} />
                  </>
                )}
              </>
            )}

            {tab === 'ai' && (
              <>
                {providerPicker}
                {current && (
                  <>
                    <h2>{t.editPrompt}</h2>
                    <textarea value={editPrompt} placeholder={t.editPlaceholder} onChange={(e) => setEditPrompt(e.target.value)} />
                    <button className="btn primary block" disabled={aiDisabled} onClick={() => ai(editWithPrompt)}>
                      <Icon name="sparkles" />
                      {t.applyEdit}
                    </button>
                  </>
                )}
                <h2>{t.genPrompt}</h2>
                <textarea value={genPrompt} placeholder={t.genPlaceholder} onChange={(e) => setGenPrompt(e.target.value)} />
                <Field label={t.aspect}>
                  <select value={genAspect} onChange={(e) => setGenAspect(e.target.value)}>
                    {target && <option value="orig">{t.asOriginal}</option>}
                    {GEN_ASPECTS.map((a) => (
                      <option key={a} value={a}>
                        {a}
                      </option>
                    ))}
                  </select>
                </Field>
                <button className={current ? 'btn block' : 'btn primary block'} disabled={!!busy || !hasAi} onClick={() => run(t.working, generate)}>
                  <Icon name="sparkles" />
                  {t.generate}
                </button>
              </>
            )}

            {tab === 'save' && (
              <>
                <Field label={t.format}>
                  <select value={format} onChange={(e) => setFormat(e.target.value)}>
                    {FORMATS.map((f) => (
                      <option key={f.mime} value={f.mime}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </Field>
                {format !== 'image/png' && <Slider label={t.quality} value={quality} min={30} max={100} unit="%" onChange={setQuality} />}
                {info?.kind === 'file' && (
                  <Field label={t.saveMode}>
                    <select value={overwrite ? 'overwrite' : 'new'} onChange={(e) => setMode(e.target.value as 'new' | 'overwrite')}>
                      <option value="new">{t.saveNew}</option>
                      <option value="overwrite" disabled={!canOverwrite}>
                        {t.saveOver}
                      </option>
                    </select>
                  </Field>
                )}
                {!overwrite && (
                  <>
                    <Field label={t.fileName}>
                      <input type="text" value={stem} onChange={(e) => setStem(e.target.value.replace(/[^\w.-]+/g, '-'))} />
                    </Field>
                    {target && <h2>{t.references}</h2>}
                    {target && !references.length && <p className="hint">{t.noReferences}</p>}
                    {references.map((r) => (
                      <label key={r.id} className="check">
                        <input
                          type="checkbox"
                          checked={refs.has(r.id)}
                          onChange={(e) => {
                            const next = new Set(refs);
                            if (e.target.checked) next.add(r.id);
                            else next.delete(r.id);
                            setRefs(next);
                          }}
                        />
                        <span className="ref">
                          {r.file}:{r.line}
                          <code>{r.snippet}</code>
                        </span>
                      </label>
                    ))}
                  </>
                )}
              </>
            )}
          </div>

          <div className="foot">
            <div>
              <span className="path">→ {destination}</span>
              {!overwrite && references.length > 0 && (
                <p className="hint">
                  {t.references}: {refs.size}/{references.length}
                </p>
              )}
            </div>
            <div className="row">
              <button className="btn" title={t.discardHint} onClick={() => onClose(false)}>
                {t.discard}
              </button>
              <button className="btn primary" disabled={disabled} onClick={confirm}>
                <Icon name="check" />
                {t.confirm}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
