/* eslint-disable */
// QuecPi Control Panel webview script — exclusive accordion + tiled controls
const vscode = acquireVsCodeApi();

// refresh + popout
document.getElementById('refresh').addEventListener('click', () => vscode.postMessage({ type: 'refreshStatus' }));
document.getElementById('popout').addEventListener('click', () => vscode.postMessage({ type: 'popout' }));

// ── exclusive accordion: expanding one region collapses the others ──
document.querySelectorAll('.region-h').forEach((h) => {
  h.addEventListener('click', () => {
    const region = h.parentElement;
    const wasOpen = region.classList.contains('open');
    document.querySelectorAll('.region.open').forEach((r) => {
      if (r !== region) r.classList.remove('open');
    });
    // toggle this region (clicking the open one collapses it → all closed)
    if (wasOpen) region.classList.remove('open');
    else region.classList.add('open');
  });
});

// ── tile click (with optional args) ──
document.querySelectorAll('.tile[data-cmd]').forEach((t) => {
  t.addEventListener('click', () => {
    if (t.classList.contains('soon')) return; // unavailable control
    const cmd = t.getAttribute('data-cmd');
    const args = t.getAttribute('data-args');
    vscode.postMessage({ type: 'run', command: cmd, ...(args ? { args } : {}) });
  });
});
document.querySelectorAll('.tile[data-openchat]').forEach((t) => {
  t.addEventListener('click', () => vscode.postMessage({ type: 'openChat' }));
});
document.querySelectorAll('.tile[data-opencopilot]').forEach((t) => {
  t.addEventListener('click', () => vscode.postMessage({ type: 'openCopilot' }));
});

// ── status updates ──
window.addEventListener('message', (e) => {
  const m = e.data;
  if (m.type !== 'status') return;
  const p = m.payload || {};
  if (p.container) document.getElementById('st-container').textContent = p.container;
  if (p.artifacts) document.getElementById('st-artifacts').textContent = p.artifacts;
  if (p.lastBuild) document.getElementById('st-last').textContent = p.lastBuild;
});
