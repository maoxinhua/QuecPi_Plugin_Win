/**
 * Minimal client for the RUNNING DeepSeek Harness's agent-preset API
 * (http://127.0.0.1:3080/api/agentPreset.*). Wire format:
 * POST /api/<method>  body: {type:'client-request', rpcId, method, payload}
 */
export interface HarnessPreset {
  id: string;
  trust: 'system' | 'user';
  isDefault: boolean;
  name?: string;
  description?: string;
  broken?: string;
}

export interface HarnessPresetDetail {
  agentPreset: string;
  trust: 'system' | 'user';
  content: string;
  name?: string;
  description?: string;
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

export async function listAgentPresets(baseUrl: string, signal?: AbortSignal): Promise<HarnessPreset[]> {
  const v = await rpc<{ presets: HarnessPreset[] }>(baseUrl, 'agentPreset.list', {}, signal);
  return v.presets;
}

export async function readAgentPreset(baseUrl: string, id: string, signal?: AbortSignal): Promise<HarnessPresetDetail> {
  return rpc<HarnessPresetDetail>(baseUrl, 'agentPreset.read', { agentPreset: id }, signal);
}

/** agentPreset.copy — create a new user preset by copying an existing one. */
export async function copyAgentPreset(baseUrl: string, from: string, agentPreset: string, name?: string): Promise<string> {
  const v = await rpc<{ agentPreset: string }>(baseUrl, 'agentPreset.copy', { from, agentPreset, name });
  return v.agentPreset;
}

/** Extract the `persona` row's system-prompt text from a preset composition YAML. */
export function extractPersona(content: string): string | undefined {
  const idx = content.indexOf('- id: persona');
  if (idx < 0) return undefined;
  const rest = content.slice(idx);
  const next = rest.search(/\n- id: /);
  const block = next > 0 ? rest.slice(0, next) : rest;
  const lines = block.split('\n');
  const ti = lines.findIndex((l) => /^\s*text:\s*/.test(l));
  if (ti < 0) return undefined;
  const inline = lines[ti].replace(/^\s*text:\s*/, '').trim();
  if (inline && !['|', '|-', '>', '>-', '>+', '|+'].includes(inline)) return inline;
  const out: string[] = [];
  for (let i = ti + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*$/.test(l)) {
      out.push('');
      continue;
    }
    if (!/^\s+/.test(l)) break; // dedent → block ends
    out.push(l.replace(/^\s+/, ''));
  }
  const t = out.join('\n').trim();
  return t || undefined;
}

/** Build the chat system prompt for a harness preset: its persona, placeholders filled. */
export function systemPromptForPreset(detail: HarnessPresetDetail, model: string, cwd: string): string {
  const persona = extractPersona(detail.content);
  if (persona) {
    return persona.replaceAll('{{model}}', model).replaceAll('{{cwd}}', cwd);
  }
  const name = detail.name ?? detail.agentPreset;
  const desc = detail.description ?? '';
  return `You are QuecPi Bot in "${name}" mode. ${desc}`.trim();
}
