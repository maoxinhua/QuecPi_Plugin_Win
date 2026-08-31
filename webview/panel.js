/* eslint-disable */
// QuecPi Control Panel webview script (compact tile layout)
const vscode = acquireVsCodeApi();

// section collapse
document.querySelectorAll('.sec-h').forEach((h) => {
  h.addEventListener('click', () => h.parentElement.classList.toggle('collapsed'));
});

// refresh + popout
document.getElementById('refresh').addEventListener('click', () => vscode.postMessage({ type: 'refreshStatus' }));
document.getElementById('popout').addEventListener('click', () => vscode.postMessage({ type: 'popout' }));

// card-group accordion
document.querySelectorAll('.cg-h').forEach((h) => {
  h.addEventListener('click', () => h.parentElement.classList.toggle('open'));
});

// sub-card click (with optional args)
document.querySelectorAll('.sub[data-cmd]').forEach((s) => {
  s.addEventListener('click', () => {
    const cmd = s.getAttribute('data-cmd');
    const args = s.getAttribute('data-args');
    vscode.postMessage({ type: 'run', command: cmd, ...(args ? { args } : {}) });
  });
});

// tile click
document.querySelectorAll('.tile[data-cmd]').forEach((t) => {
  t.addEventListener('click', () => {
    const cmd = t.getAttribute('data-cmd');
    if (cmd) vscode.postMessage({ type: 'run', command: cmd });
  });
});
document.querySelectorAll('.tile[data-openchat]').forEach((t) => {
  t.addEventListener('click', () => vscode.postMessage({ type: 'openChat' }));
});
document.querySelectorAll('.tile[data-opencopilot]').forEach((t) => {
  t.addEventListener('click', () => vscode.postMessage({ type: 'openCopilot' }));
});

// status updates
window.addEventListener('message', (e) => {
  const m = e.data;
  if (m.type !== 'status') return;
  const p = m.payload || {};
  if (p.container) document.getElementById('st-container').textContent = p.container;
  if (p.artifacts) document.getElementById('st-artifacts').textContent = p.artifacts;
  if (p.lastBuild) document.getElementById('st-last').textContent = p.lastBuild;
});
