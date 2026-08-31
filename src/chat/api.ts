import { Cfg } from '../config';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCallbacks {
  onDelta: (text: string) => void;
  onDone: (fullText: string) => void;
  onError: (msg: string) => void;
}

/**
 * Minimal OpenAI-compatible streaming chat client (works with DeepSeek,
 * OpenAI, and any /v1/chat/completions implementation).
 */
export async function streamChat(
  messages: ChatMessage[],
  cb: ChatCallbacks,
  signal: AbortSignal,
  modelOverride?: string
): Promise<void> {
  // tolerate users pasting the full endpoint (…/v1/chat/completions) or the base (…/v1)
  let base = Cfg.chatBaseUrl().trim().replace(/\/+$/, '');
  base = base.replace(/\/chat\/completions$/, '');
  const key = Cfg.chatApiKey();
  if (!key) {
    cb.onError('No API key configured. Set quecpi.chat.apiKey or the QUECPI_API_KEY / DEEPSEEK_API_KEY env var.');
    return;
  }
  const url = `${base}/chat/completions`;
  const body = {
    model: modelOverride || Cfg.chatModel(),
    messages,
    stream: true,
    temperature: 0.3,
  };

  let resp: Response;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      cb.onError('[stopped]');
    } else {
      cb.onError(`Network error: ${e?.message ?? e}`);
    }
    return;
  }

  if (!resp.ok || !resp.body) {
    const text = await resp.text().catch(() => '');
    cb.onError(`HTTP ${resp.status}: ${text.slice(0, 400)}`);
    return;
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // split on SSE boundaries
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') continue;
        try {
          const json = JSON.parse(payload);
          const delta = json?.choices?.[0]?.delta?.content ?? '';
          if (delta) {
            full += delta;
            cb.onDelta(delta);
          }
        } catch {
          /* partial json in chunk — ignore */
        }
      }
    }
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      cb.onError('[stopped]');
    } else {
      cb.onError(`Stream error: ${e?.message ?? e}`);
    }
    return;
  }
  cb.onDone(full);
}
