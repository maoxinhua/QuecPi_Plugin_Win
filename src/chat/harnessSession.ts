/**
 * DeepSeek Harness session bridge: lets the chat talk to a RUNNING harness
 * session (the agent itself) instead of a bare model.
 *  - session.list / session.prompt / session.history (POST /api/*)
 *  - events.mux (GET /api/events.mux, SSE) → assistant text + tool activity
 */

export interface HarnessSession {
  sessionId: string;
  title?: string;
  cwd?: string;
  running: boolean;
  blank: boolean;
  agentPreset?: string;
  updatedAt?: number;
}

export interface MuxCallbacks {
  onTextDelta: (text: string) => void;
  onToolCall: (name: string, args: string) => void;
  onToolResult: (name: string) => void;
  onTurnEnd: () => void;
  onError: (msg: string) => void;
}

async function rpc<T>(baseUrl: string, method: string, payload: unknown, signal?: AbortSignal): Promise<T> {
  const url = `${baseUrl.replace(/\/+$/, '')}/api/${method}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'client-request',
      rpcId: `quecpi-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      method,
      payload,
    }),
    signal,
  });
  if (!resp.ok) throw new Error(`harness ${method} HTTP ${resp.status}`);
  const data = (await resp.json()) as any;
  const r = data?.result;
  if (!r || !r.ok) throw new Error(`harness ${method} failed: ${JSON.stringify(data?.error ?? data).slice(0, 300)}`);
  return r.value as T;
}

export async function listSessions(baseUrl: string): Promise<HarnessSession[]> {
  const v = await rpc<{ items: HarnessSession[] }>(baseUrl, 'session.list', {});
  return v.items;
}

export interface HarnessModelGroup {
  id: string;
  name: string;
  models: { id: string; name: string }[];
}
export interface SessionModels {
  current: { provider: string; model: string };
  groups: HarnessModelGroup[];
}

/** session.models — the models a session can route to (grouped by provider). */
export async function listSessionModels(baseUrl: string, sessionId: string): Promise<SessionModels> {
  return rpc<SessionModels>(baseUrl, 'session.models', { sessionId });
}

/** session.selectModel — switch the session's model route. */
export async function selectSessionModel(
  baseUrl: string,
  sessionId: string,
  provider: string,
  model: string
): Promise<void> {
  await rpc(baseUrl, 'session.selectModel', { sessionId, provider, model });
}

/** agentPreset.select — recompose a session's agent preset (blank sessions only). */
export async function selectAgentPreset(baseUrl: string, sessionId: string, agentPreset: string): Promise<void> {
  await rpc(baseUrl, 'agentPreset.select', { sessionId, agentPreset });
}

/** agentPreset.copy — create a new user preset by copying an existing one. */
export async function copyAgentPreset(
  baseUrl: string,
  from: string,
  agentPreset: string,
  name?: string
): Promise<string> {
  const v = await rpc<{ agentPreset: string }>(baseUrl, 'agentPreset.copy', { from, agentPreset, name });
  return v.agentPreset;
}

export async function promptSession(baseUrl: string, sessionId: string, text: string): Promise<void> {
  await rpc(baseUrl, 'session.prompt', {
    sessionId,
    mode: 'queue',
    content: [{ type: 'text', text }],
    clientTimeZone: 'Asia/Shanghai',
  });
}

export interface HistoryMsg {
  role: 'user' | 'assistant';
  content: string;
}

function extractText(blocks: any[]): string {
  return (blocks ?? [])
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('');
}

export async function sessionHistory(baseUrl: string, sessionId: string, maxMessages = 60): Promise<HistoryMsg[]> {
  const v = await rpc<{ events: { event: any }[] }>(baseUrl, 'session.history', { sessionId, maxMessages });
  const out: HistoryMsg[] = [];
  for (const e of v.events) {
    const ev = e?.event;
    if (!ev) continue;
    const data = ev.data ?? {};
    if (ev.type === 'user/message') {
      const t = extractText(data.content ?? data.message?.content ?? []);
      if (t.trim()) out.push({ role: 'user', content: t });
    } else if (ev.type === 'assistant/message') {
      const t = extractText(data.message?.content ?? data.content ?? []);
      if (t.trim()) out.push({ role: 'assistant', content: t });
    }
  }
  return out;
}

function dispatchEvent(ev: any, cb: MuxCallbacks) {
  const data = ev?.data ?? {};
  switch (ev?.type) {
    case 'assistant/chunk': {
      const c = data.chunk;
      if (c?.type === 'text-delta' && typeof c.text === 'string') cb.onTextDelta(c.text);
      break;
    }
    case 'tool/call':
      cb.onToolCall(data.name ?? 'tool', data.arguments ?? '');
      break;
    case 'tool/result':
      cb.onToolResult(data.name ?? 'tool');
      break;
    case 'turn/end':
      cb.onTurnEnd();
      break;
  }
}

/**
 * Opens the aggregated mux event stream once (WebSocket — the running harness
 * requires WS for /api/events.mux, HTTP SSE gets 426) and dispatches this
 * session's events to cb. Long-lived; returns an AbortController to close it.
 */
export function openMux(baseUrl: string, sessionId: string, cb: MuxCallbacks): AbortController {
  const ac = new AbortController();
  const wsUrl = `${baseUrl.replace(/\/+$/, '').replace(/^http/, 'ws')}/api/events.mux`;
  let ws: import('ws') | undefined;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const WS = require('ws') as typeof import('ws');
    ws = new WS(wsUrl);
  } catch (e: any) {
    cb.onError(`events.mux WS 连接失败: ${e?.message ?? e}`);
    return ac;
  }

  ws.on('open', () => { /* ready — wait for frames */ });
  ws.on('message', (data: any) => {
    let frame: any;
    try {
      frame = JSON.parse(data.toString());
    } catch {
      return;
    }
    const p = frame?.payload;
    if (!p) return;
    if (frame.method === 'session/event' && p.sessionId === sessionId) {
      dispatchEvent(p.event, cb);
    } else if (frame.method === 'stream/error') {
      cb.onError(p.error?.message ?? 'stream error');
    }
  });
  ws.on('error', (e: any) => cb.onError(`events.mux WS 错误: ${e?.message ?? e}`));
  ws.on('close', () => { /* stream ended */ });

  ac.signal.addEventListener('abort', () => {
    try {
      ws?.close();
    } catch { /* ignore */ }
  });
  return ac;
}
