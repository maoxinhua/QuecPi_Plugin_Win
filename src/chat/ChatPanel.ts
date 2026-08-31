import * as vscode from 'vscode';
import { Cfg } from '../config';
import { t, isChinese } from '../i18n';
import { streamChat, ChatMessage } from './api';
import { listAgentPresets, readAgentPreset, systemPromptForPreset, HarnessPreset } from './harness';
import { listSessions, promptSession, sessionHistory, openMux, listSessionModels, selectSessionModel, selectAgentPreset, HarnessSession } from './harnessSession';

/**
 * CodeBuddy-style chat panel.
 * The "Agent" dropdown is the RUNNING DeepSeek Harness's real agent presets
 * (Standard / PTC / Minimal / Creator / user presets), fetched from
 * http://127.0.0.1:3080/api/agentPreset.*. Selecting one applies its persona
 * (system prompt) to this chat. Falls back to built-in modes when offline.
 */
export class ChatPanel {
  static current: ChatPanel | undefined;

  private panel: vscode.WebviewPanel;
  private history: ChatMessage[] = [];
  private abort: AbortController | null = null;
  private presetId: string;
  private model: string;
  private harnessPresets: HarnessPreset[] | null = null;
  private systemPrompt: string | undefined;
  private sessions: HarnessSession[] = [];
  private activeSessionId: string | undefined;
  private connectMode: 'model' | 'harness' = 'harness';
  private muxAbort: AbortController | null = null;
  private bubbleOpen = false;

  static create(extensionUri: vscode.Uri) {
    if (ChatPanel.current) {
      ChatPanel.current.panel.reveal(vscode.ViewColumn.Beside);
      return ChatPanel.current;
    }
    const panel = vscode.window.createWebviewPanel('quecpiChat', 'QuecPi AI Chat', vscode.ViewColumn.Beside, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'webview')],
    });
    ChatPanel.current = new ChatPanel(panel, extensionUri);
    panel.onDidDispose(() => {
      ChatPanel.current = undefined;
    });
    return ChatPanel.current;
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this.panel = panel;
    this.presetId = Cfg.chatPresetId();
    this.model = Cfg.chatModel();
    const jsUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'webview', 'chat.js'));
    panel.webview.html = this.html(jsUri);
    panel.webview.onDidReceiveMessage((msg) => this.onMessage(msg));
    this.postInit(); // fallback view immediately
    void this.initHarness(); // then refresh with the live harness presets
  }

  private async initHarness() {
    try {
      this.harnessPresets = await listAgentPresets(Cfg.harnessUrl());
      const def = this.harnessPresets.find((p) => p.isDefault);
      if (def && !this.harnessPresets.some((p) => p.id === this.presetId)) {
        this.presetId = def.id; // stale selection → follow harness default
      }
    } catch (e: any) {
      this.harnessPresets = null;
      this.post('status', `⚠ harness unreachable (${Cfg.harnessUrl()}) - Agent dropdown uses built-in presets. ${e?.message ?? ''}`);
    }

    try {
      this.sessions = await listSessions(Cfg.harnessUrl());
      const running = this.sessions.find((s) => s.running);
      if (!this.activeSessionId) {
        this.activeSessionId = running?.sessionId ?? this.sessions[0]?.sessionId;
      }
      if (this.connectMode === 'harness' && this.activeSessionId) {
        this.startMux();
        await this.loadHistory();
        void this.loadHarnessModels();
      }
    } catch (e: any) {
      this.connectMode = 'model';
      this.post('status', `⚠ cannot connect harness session: ${e?.message ?? e} (fell back to Direct Model)`);
    }

    this.postInit();
    await this.resolveSystemPrompt();
  }

  private postInit() {
    const zh = isChinese();
    const localizePreset = (id: string, name?: string): string => {
      const map: Record<string, [string, string]> = {
        standard: ['Standard', '标准模式'],
        code: ['PTC', 'PTC 模式'],
        minimal: ['Minimal', '极简模式'],
        cordis: ['Creator', '创造模式'],
        quectel: ['Quectel Engineer', 'Quectel Engineer'],
      };
      const hit = map[id];
      if (hit) return zh ? hit[1] : hit[0];
      return name ?? id;
    };
    const presets = this.harnessPresets
      ? this.harnessPresets.map((p) => ({
          id: p.id,
          label: localizePreset(p.id, p.name),
          isDefault: p.isDefault,
          broken: p.broken,
        }))
      : Cfg.chatPresets().map((p) => ({ id: p.id, label: localizePreset(p.id, p.label), isDefault: p.id === this.presetId }));
    const payload = {
      lang: isChinese() ? 'zh' : 'en',
      presets,
      currentPreset: this.presetId,
      models: Cfg.chatModels(),
      currentModel: this.model,
      hasKey: !!Cfg.chatApiKey(),
      baseUrl: Cfg.chatBaseUrl(),
      sessions: this.sessions.map((s) => ({
        id: s.sessionId,
        label: this.sessionLabel(s),
      })),
      currentSession: this.activeSessionId,
      connectMode: this.connectMode,
    };
    this.panel.webview.postMessage({ type: 'init', payload });
  }

  private sessionLabel(s: HarnessSession): string {
    const title = s.title?.trim();
    const cwd = s.cwd ? s.cwd.split('/').slice(-2).join('/') : '';
    const parts = [title, cwd, s.sessionId.slice(-8)].filter(Boolean);
    return `${parts.join(' · ')}${s.running ? ' ●' : ''}`;
  }

  private postConfigStatus() {
    const hasKey = !!Cfg.chatApiKey();
    const status = hasKey
      ? `${t('chat.model')}: ${this.model} · endpoint: ${Cfg.chatBaseUrl()}`
      : t('chat.noKey');
    this.post('status', status);
  }

  private onMessage(msg: any) {
    switch (msg.type) {
      case 'send':
        if (msg.mode === 'harness' && this.activeSessionId) {
          this.sendHarness(msg.text);
        } else {
          this.sendModel(msg.text, msg.contexts as string[]);
        }
        break;
      case 'clear':
        this.history = [];
        this.post('history', []);
        break;
      case 'stop':
        this.abort?.abort();
        break;
      case 'grabContext':
        this.grabContext(msg.mode === 'file' ? 'file' : 'selection');
        break;
      case 'setPreset':
        this.presetId = msg.id;
        if (this.connectMode === 'harness' && this.activeSessionId) {
          // switch the harness session's agent preset (blank sessions only)
          this.selectPresetForSession(msg.id);
        } else {
          vscode.workspace.getConfiguration('quecpi.chat').update('preset', msg.id, vscode.ConfigurationTarget.Global);
          void this.resolveSystemPrompt();
        }
        break;
      case 'setModel':
        this.model = msg.id;
        if (this.connectMode === 'harness' && this.activeSessionId) {
          // switch the harness session's model route
          this.selectModelForSession(msg.provider, msg.id);
        } else {
          vscode.workspace.getConfiguration('quecpi.chat').update('model', msg.id, vscode.ConfigurationTarget.Global);
          void this.resolveSystemPrompt();
          this.postConfigStatus();
        }
        break;
      case 'setSession':
        this.activeSessionId = msg.id;
        this.startMux();
        void this.loadHistory();
        void this.loadHarnessModels();
        break;
      case 'setConnectMode':
        this.connectMode = msg.mode;
        if (msg.mode === 'harness') {
          if (!this.activeSessionId) {
            this.activeSessionId = this.sessions.find((s) => s.running)?.sessionId ?? this.sessions[0]?.sessionId;
          }
          this.startMux();
          void this.loadHistory();
        } else {
          this.stopMux();
        }
        break;
    }
  }

  private post(type: string, payload?: any) {
    this.panel.webview.postMessage({ type, payload });
  }

  /** Fetch the session's routable models and send them to the webview. */
  private async loadHarnessModels() {
    if (!this.activeSessionId) return;
    try {
      const models = await listSessionModels(Cfg.harnessUrl(), this.activeSessionId);
      this.post('harnessModels', {
        current: models.current,
        groups: models.groups.map((g) => ({ id: g.id, name: g.name, models: g.models.map((m) => ({ id: m.id, name: m.name })) })),
      });
    } catch {
      /* ignore — model dropdown keeps local list */
    }
  }

  /** Switch the harness session's model via session.selectModel. */
  private async selectModelForSession(provider: string, model: string) {
    if (!this.activeSessionId) return;
    try {
      await selectSessionModel(Cfg.harnessUrl(), this.activeSessionId, provider, model);
      this.post('status', `Session model -> ${provider}/${model}`);
    } catch (e: any) {
      this.post('assistantError', `switch model failed: ${e?.message ?? e}`);
    }
  }

  /** Switch the harness session's agent preset via agentPreset.select. */
  private async selectPresetForSession(id: string) {
    if (!this.activeSessionId) return;
    try {
      await selectAgentPreset(Cfg.harnessUrl(), this.activeSessionId, id);
      this.post('status', `Session agent preset -> ${id}`);
    } catch (e: any) {
      const msg = `${e?.message ?? e}`;
      this.post(
        'assistantError',
        msg.includes('agent-preset-locked')
          ? 'Agent preset can only be switched on a BLANK session (one that has not started). Create a new session to switch presets.'
          : `switch preset failed: ${msg}`
      );
    }
  }

  private async resolveSystemPrompt() {
    const cwd = Cfg.bspPath() || '';
    if (this.harnessPresets) {
      try {
        const detail = await readAgentPreset(Cfg.harnessUrl(), this.presetId);
        this.systemPrompt = systemPromptForPreset(detail, this.model, cwd);
        const label = this.harnessPresets.find((p) => p.id === this.presetId)?.name ?? this.presetId;
        this.post('status', `Agent: ${label} · ${t('chat.model')}: ${this.model}`);
        return;
      } catch (e: any) {
        this.post('status', `⚠ read harness preset ${this.presetId} failed: ${e?.message ?? e} (using built-in)`);
      }
    }
    this.systemPrompt = Cfg.promptForPreset(this.presetId);
    const label = Cfg.chatPresets().find((p) => p.id === this.presetId)?.label ?? this.presetId;
    this.post('status', `Agent: ${label} · ${t('chat.model')}: ${this.model}`);
  }

  private grabContext(mode: 'selection' | 'file') {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      this.post('toast', t('chat.grabFile'));
      return;
    }
    const doc = editor.document;
    const sel = editor.selection;
    const file = doc.uri.fsPath;
    const rel = file.startsWith(Cfg.bspPath()) ? file.slice(Cfg.bspPath().length + 1) : file;

    let label: string;
    let snippet = '';
    if (mode === 'file' || sel.isEmpty) {
      label = `📄 ${rel}`;
    } else {
      snippet = doc.getText(sel).slice(0, 6000);
      label = `✂ ${rel} (L${sel.start.line + 1}-${sel.end.line + 1})`;
    }

    const content =
      `\n[File: ${rel}]\n` +
      (snippet ? `\`\`\`\n${snippet}\n\`\`\`\n` : `(${doc.lineCount} lines)`);

    this.post('appendContext', { label, content });
  }

  private async sendModel(userText: string, contexts: string[]) {
    if (!userText.trim() && contexts.length === 0) return;
    let userContent = userText;
    if (contexts.length > 0) {
      userContent += '\n\n--- attached context ---\n' + contexts.join('\n\n');
    }
    this.history.push({ role: 'user', content: userContent });
    this.post('history', this.history.filter((m) => m.role !== 'system'));

    const system = this.systemPrompt ?? Cfg.promptForPreset(this.presetId);
    const messages: ChatMessage[] = [{ role: 'system', content: system }, ...this.history];
    this.abort = new AbortController();
    this.post('assistantStart', '');

    await streamChat(
      messages,
      {
        onDelta: (t) => this.post('assistantDelta', t),
        onDone: (full) => {
          this.history.push({ role: 'assistant', content: full });
          this.post('assistantDone', '');
        },
        onError: (m) => this.post('assistantError', m),
      },
      this.abort.signal,
      this.model
    );
  }

  /** Send a message to the RUNNING harness session (the agent = me). */
  private async sendHarness(text: string) {
    if (!this.activeSessionId || !text.trim()) return;
    this.history.push({ role: 'user', content: text });
    this.post('history', this.history.filter((m) => m.role !== 'system'));
    this.bubbleOpen = false;
    try {
      await promptSession(Cfg.harnessUrl(), this.activeSessionId, text);
    } catch (e: any) {
      this.post('assistantError', `session.prompt failed: ${e?.message ?? e}`);
    }
  }

  private startMux() {
    this.stopMux();
    if (!this.activeSessionId) return;
    this.muxAbort = openMux(Cfg.harnessUrl(), this.activeSessionId, {
      onTextDelta: (t) => {
        if (!this.bubbleOpen) {
          this.post('assistantStart', '');
          this.bubbleOpen = true;
        }
        this.post('assistantDelta', t);
      },
      onToolCall: (name, args) => {
        if (!this.bubbleOpen) {
          this.post('assistantStart', '');
          this.bubbleOpen = true;
        }
        this.post('tool', { name, args: args.slice(0, 300) });
      },
      onToolResult: () => {},
      onTurnEnd: () => {
        this.post('assistantDone', '');
        this.bubbleOpen = false;
      },
      onError: (m) => this.post('assistantError', m),
    });
  }

  private stopMux() {
    this.muxAbort?.abort();
    this.muxAbort = null;
    this.bubbleOpen = false;
  }

  private async loadHistory() {
    if (!this.activeSessionId) return;
    try {
      const msgs = await sessionHistory(Cfg.harnessUrl(), this.activeSessionId);
      this.history = msgs.map((m) => ({ role: m.role, content: m.content }));
      this.post('history', this.history);
    } catch {
      /* ignore */
    }
  }

  private html(jsUri: vscode.Uri): string {
    const csp = this.panel.webview.cspSource;
    return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${csp} 'unsafe-inline'; script-src ${csp}; img-src ${csp} data:;">
<style>
:root{--bg:#1e1e1e;--fg:#d4d4d4;--accent:#4ec9b0;--border:#333;}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font-family:var(--vscode-font-family);display:flex;flex-direction:column;height:100vh;}
#status{background:#3a2d1a;color:#e6c07b;padding:6px 12px;font-size:12px;border-bottom:1px solid var(--border);white-space:pre-wrap;display:none;}
#toolbar{display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid var(--border);flex-wrap:wrap;}
#toolbar label{font-size:12px;color:#9a9a9a;}
#toolbar select{background:#252526;color:var(--fg);border:1px solid var(--border);border-radius:4px;padding:3px 8px;font-family:var(--vscode-font-family);font-size:12px;}
#msgs{flex:1;overflow-y:auto;padding:12px 16px;}
.msg{margin:10px 0;max-width:95%;white-space:pre-wrap;word-break:break-word;line-height:1.5;}
.msg.user{background:#094771;border-radius:8px;padding:8px 12px;margin-left:auto;width:fit-content;}
.msg.err{color:#f14c4c;}
.msg code{background:#2d2d2d;padding:1px 5px;border-radius:4px;font-family:var(--vscode-editor-font-family);}
.msg pre{background:#111;border:1px solid var(--border);border-radius:8px;padding:10px;overflow-x:auto;}
.msg pre code{background:none;padding:0;}
.role-tag{color:#6a9955;font-size:11px;margin-right:8px;}
.tool-line{color:#c586c0;font-size:12px;margin:4px 0;padding:2px 6px;border-left:2px solid #c586c0;background:#252030;border-radius:2px;}
#ctxchips{display:flex;gap:6px;padding:8px 12px 0;flex-wrap:wrap;}
.chip{display:inline-flex;align-items:center;gap:6px;background:#2d3b2d;color:#a9d3a9;border:1px solid #3c523c;border-radius:12px;padding:2px 8px;font-size:12px;}
.chip button{background:none;border:none;color:#a9d3a9;cursor:pointer;font-size:14px;line-height:1;padding:0;}
#ctxbar{display:flex;gap:6px;padding:6px 12px;flex-wrap:wrap;}
#ctxbar button{background:#333;color:var(--fg);border:1px solid var(--border);border-radius:4px;padding:3px 10px;cursor:pointer;font-size:12px;}
#ctxbar button:hover{background:#444;}
#inputrow{display:flex;gap:8px;padding:10px 12px;border-top:1px solid var(--border);}
#input{flex:1;background:#252526;color:var(--fg);border:1px solid var(--border);border-radius:6px;padding:8px 10px;resize:none;height:44px;font-family:var(--vscode-font-family);}
#input:focus{outline:1px solid var(--accent);}
#send{background:var(--accent);color:#111;border:none;border-radius:6px;padding:0 18px;font-weight:600;cursor:pointer;}
#send:disabled{opacity:.5;cursor:default;}
#stop{background:#7c2d2d;color:#fff;border:none;border-radius:6px;padding:0 14px;display:none;cursor:pointer;}
.hint{color:#808080;font-size:11px;padding:2px 4px;}
</style>
</head>
<body>
<div id="status"></div>
<div id="toolbar">
  <label>${t('chat.connect')}</label>
  <select id="connectmode">
    <option value="harness">${t('chat.harness')}</option>
    <option value="model">${t('chat.direct')}</option>
  </select>
  <label>${t('chat.session')}</label>
  <select id="session"></select>
  <label>Agent</label>
  <select id="preset"></select>
  <label>${t('chat.model')}</label>
  <select id="model"></select>
</div>
<div id="msgs"><div class="hint">${t('chat.hint')}</div></div>
<div id="ctxchips"></div>
<div id="ctxbar">
  <button id="ctxSel">${t('chat.sel')}</button>
  <button id="ctxFile">${t('chat.file')}</button>
  <button id="clear" style="margin-left:auto">${t('chat.clear')}</button>
</div>
<div id="inputrow">
  <textarea id="input" placeholder="${t('chat.input.ph')}"></textarea>
  <button id="send">${t('chat.send')}</button>
  <button id="stop">${t('chat.stop')}</button>
</div>
<script src="${jsUri}"></script>
</body>
</html>`;
  }
}
