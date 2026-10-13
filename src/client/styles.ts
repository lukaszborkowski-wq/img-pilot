export const css = /* css */ `
:host { all: initial; }
*, *::before, *::after { box-sizing: border-box; }
.ip {
  --bg: #14161b; --panel: #1b1e25; --raised: #252933; --line: #303542;
  --text: #e8eaf0; --muted: #98a1b3; --accent: #7c5cff; --accent-hi: #9279ff; --danger: #ff5d73;
  font: 13px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color: var(--text);
  -webkit-font-smoothing: antialiased;
}
button, input, select, textarea { font: inherit; color: inherit; }
button { cursor: pointer; }
button:disabled { opacity: .45; cursor: not-allowed; }
svg { width: 15px; height: 15px; flex: none; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }

.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  height: 32px; padding: 0 12px; border-radius: 8px;
  border: 1px solid var(--line); background: var(--raised); white-space: nowrap;
  transition: background .12s, border-color .12s;
}
.btn:hover:not(:disabled) { background: #2e3340; border-color: #3d4353; }
.btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }
.btn.primary:hover:not(:disabled) { background: var(--accent-hi); border-color: var(--accent-hi); }
.btn.active { border-color: var(--accent); background: rgba(124, 92, 255, .18); }
.btn.icon { width: 32px; padding: 0; }
.btn.block { width: 100%; }

/* hover outline + toolbar */
.outline {
  position: fixed; pointer-events: none; border: 2px solid var(--accent); border-radius: 4px;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, .35);
}
.hoverbar {
  position: fixed; display: flex; gap: 2px; padding: 4px; border-radius: 11px;
  background: rgba(20, 22, 27, .94); border: 1px solid var(--line);
  box-shadow: 0 8px 28px rgba(0, 0, 0, .45); backdrop-filter: blur(8px);
}
.hoverbar button {
  display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 9px;
  border: 0; border-radius: 7px; background: transparent; white-space: nowrap;
}
.hoverbar button:hover { background: var(--accent); color: #fff; }

/* launcher */
.launcher {
  position: fixed; display: flex; align-items: center; gap: 2px; padding: 4px; border-radius: 999px;
  background: rgba(20, 22, 27, .94); border: 1px solid var(--line); box-shadow: 0 8px 28px rgba(0, 0, 0, .4);
}
.launcher.bottom-right { right: 16px; bottom: 16px; }
.launcher.bottom-left { left: 16px; bottom: 16px; }
.launcher.top-right { right: 16px; top: 16px; }
.launcher.top-left { left: 16px; top: 16px; }
.launcher button {
  display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px;
  border: 0; border-radius: 999px; background: transparent;
}
.launcher button:hover { background: var(--raised); }
.launcher .chip { max-width: 190px; background: var(--raised); }
.launcher .chip span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.launcher .chip .spin { width: 12px; height: 12px; border-width: 2px; flex: none; }
.dot.draft { background: #ffbe50; }
.dot.fail { background: var(--danger); }
.toast.link { cursor: pointer; }
.dot { flex: none; width: 8px; height: 8px; border-radius: 50%; background: #5b6272; }
.dot.on { background: #3ddc97; box-shadow: 0 0 0 3px rgba(61, 220, 151, .2); }

.toast {
  position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); max-width: min(640px, calc(100vw - 32px));
  padding: 10px 14px; border-radius: 10px; background: var(--panel); border: 1px solid var(--line);
  box-shadow: 0 12px 36px rgba(0, 0, 0, .5); white-space: pre-line; word-break: break-word;
}
.toast b { color: #3ddc97; font-weight: 600; }

/* editor */
.backdrop { position: fixed; inset: 0; background: rgba(8, 9, 12, .72); backdrop-filter: blur(3px); }
.editor {
  position: fixed; inset: 20px; display: grid; grid-template-columns: minmax(0, 1fr) 340px; grid-template-rows: 48px minmax(0, 1fr);
  background: var(--bg); border: 1px solid var(--line); border-radius: 14px; overflow: hidden;
  box-shadow: 0 30px 80px rgba(0, 0, 0, .6);
}
.head {
  grid-column: 1 / -1; display: flex; align-items: center; gap: 8px; padding: 0 10px 0 16px;
  background: var(--panel); border-bottom: 1px solid var(--line);
}
.head h1 { margin: 0; font-size: 14px; font-weight: 600; }
.head .meta { color: var(--muted); font-variant-numeric: tabular-nums; }
.head .grow { flex: 1; }

.stage {
  position: relative; display: flex; align-items: center; justify-content: center; overflow: hidden; min-width: 0; min-height: 0;
  background: #0e1014;
}
.wrap {
  position: relative; flex: none; touch-action: none; user-select: none;
  background: repeating-conic-gradient(#2a2d36 0% 25%, #1f222a 0% 50%) 0 0 / 18px 18px;
  box-shadow: 0 0 0 1px var(--line);
}
.wrap canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.wrap .mask { opacity: .55; pointer-events: none; display: none; }
.wrap .mask.show { display: block; pointer-events: auto; cursor: crosshair; }
.crop-layer { position: absolute; inset: 0; clip-path: inset(-9px); cursor: crosshair; }
.crop-box { position: absolute; border: 1px solid #fff; box-shadow: 0 0 0 9999px rgba(0, 0, 0, .58); cursor: move; }
.crop-box i { position: absolute; width: 14px; height: 14px; background: #fff; border: 2px solid var(--accent); border-radius: 50%; }
.crop-box .nw { left: -7px; top: -7px; cursor: nwse-resize; }
.crop-box .ne { right: -7px; top: -7px; cursor: nesw-resize; }
.crop-box .sw { left: -7px; bottom: -7px; cursor: nesw-resize; }
.crop-box .se { right: -7px; bottom: -7px; cursor: nwse-resize; }
.empty { color: var(--muted); max-width: 320px; text-align: center; }
.busy {
  position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px;
  background: rgba(14, 16, 20, .7);
}
.spin { width: 28px; height: 28px; border-radius: 50%; border: 3px solid var(--line); border-top-color: var(--accent); animation: ip-spin .8s linear infinite; }
@keyframes ip-spin { to { transform: rotate(360deg); } }

.side { display: flex; flex-direction: column; min-height: 0; background: var(--panel); border-left: 1px solid var(--line); }
.tabs { display: flex; padding: 8px 8px 0; gap: 2px; border-bottom: 1px solid var(--line); }
.tabs button {
  flex: 1; height: 32px; padding: 0 4px; border: 0; background: transparent; color: var(--muted);
  border-bottom: 2px solid transparent; border-radius: 6px 6px 0 0;
}
.tabs button:hover:not(:disabled) { color: var(--text); }
.tabs button.on { color: var(--text); border-bottom-color: var(--accent); }
.body { flex: 1; min-height: 0; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 12px; }
.body h2 { margin: 6px 0 0; font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
.row { display: flex; gap: 6px; flex-wrap: wrap; }
.row > .btn { flex: 1; }
.field { display: flex; flex-direction: column; gap: 5px; }
.field > span { display: flex; justify-content: space-between; color: var(--muted); }
.field > span b { color: var(--text); font-weight: 500; font-variant-numeric: tabular-nums; }
input[type="text"], input[type="number"], select, textarea {
  width: 100%; padding: 7px 9px; border-radius: 8px; border: 1px solid var(--line); background: var(--bg); outline: none;
}
input:focus, select:focus, textarea:focus { border-color: var(--accent); }
textarea { resize: vertical; min-height: 68px; }
input[type="range"] { width: 100%; margin: 0; accent-color: var(--accent); }
.check { display: flex; align-items: flex-start; gap: 8px; cursor: pointer; }
.check input { margin: 3px 0 0; accent-color: var(--accent); }
.hint { margin: 0; color: var(--muted); }
.note { margin: 0; padding: 8px 10px; border-radius: 8px; background: rgba(255, 190, 80, .1); border: 1px solid rgba(255, 190, 80, .3); color: #ffd28a; }
.error { margin: 0; padding: 8px 10px; border-radius: 8px; background: rgba(255, 93, 115, .1); border: 1px solid rgba(255, 93, 115, .35); color: #ff9aa8; cursor: pointer; word-break: break-word; }
.ref { min-width: 0; }
.ref code, .path {
  font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; word-break: break-all;
}
.ref code { display: block; color: var(--muted); }
.path { color: var(--accent-hi); }
.foot .hint { margin-top: 2px; }
.foot { padding: 12px 14px; border-top: 1px solid var(--line); display: flex; flex-direction: column; gap: 10px; }
.foot .row > .btn { height: 36px; }
`;
