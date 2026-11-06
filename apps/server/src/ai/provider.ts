/**
 * Provider-independent LLM access. Keys stay on the server. Supported:
 *  - openai-compatible: NVIDIA NIM (build.nvidia.com), OpenAI, OpenRouter,
 *    Ollama / vLLM / LM Studio (any /v1/chat/completions endpoint)
 *  - anthropic: Claude Messages API
 * All calls go through a shared rate limiter and a daily request cap.
 */
import type { AiProviderInfo } from '@morphis/shared';
import type { ServerConfig } from '../config';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompletionResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  /** The model stopped because it hit the output token limit. */
  truncated: boolean;
}

export interface AiProvider {
  readonly name: string;
  readonly model: string;
  complete(messages: ChatMessage[], opts?: { maxTokens?: number; temperature?: number }): Promise<CompletionResult>;
}

/** Spaces requests to stay under a requests-per-minute budget, plus a daily cap. */
export class RateLimiter {
  private next = 0;
  private day = '';
  used = 0;

  constructor(
    private rpm: number,
    private dailyCap: number,
  ) {}

  async acquire(): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== this.day) {
      this.day = today;
      this.used = 0;
    }
    if (this.used >= this.dailyCap) throw new Error(`daily AI request cap reached (${this.dailyCap})`);
    this.used++;
    const gap = 60_000 / this.rpm;
    const now = Date.now();
    const at = Math.max(now, this.next);
    this.next = at + gap;
    if (at > now) await new Promise((r) => setTimeout(r, at - now));
  }
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const retryable = e instanceof HttpError ? e.status === 429 || e.status >= 500 : true;
      if (!retryable || i === attempts - 1) break;
      await new Promise((r) => setTimeout(r, 2000 * 2 ** i));
    }
  }
  throw last;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Remove reasoning traces some models (e.g. Nemotron, DeepSeek) emit before the answer. */
export function stripReasoning(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

export class OpenAICompatibleProvider implements AiProvider {
  readonly name: string;

  constructor(
    private baseUrl: string,
    private apiKey: string | undefined,
    readonly model: string,
    private limiter: RateLimiter,
    private timeoutMs: number,
    private maxTokens: number,
    private thinking = false,
  ) {
    this.name = baseUrl.includes('nvidia') ? 'nvidia-nim' : baseUrl.includes('openrouter') ? 'openrouter' : baseUrl.includes('openai.com') ? 'openai' : 'openai-compatible';
  }

  async complete(messages: ChatMessage[], opts: { maxTokens?: number; temperature?: number } = {}): Promise<CompletionResult> {
    await this.limiter.acquire();
    return withRetry(async () => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
      try {
        const res = await fetch(`${this.baseUrl.replace(/\/$/, '')}/chat/completions`, {
          method: 'POST',
          signal: ctrl.signal,
          headers: { 'content-type': 'application/json', ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}) },
          body: JSON.stringify({
            model: this.model,
            messages,
            max_tokens: opts.maxTokens ?? this.maxTokens,
            temperature: opts.temperature ?? 0.4,
            stream: false,
            // NVIDIA NIM reasoning toggle (reasoning arrives separately in reasoning_content)
            ...(this.name === 'nvidia-nim' ? { chat_template_kwargs: { enable_thinking: this.thinking } } : {}),
          }),
        });
        if (!res.ok) throw new HttpError(res.status, `${this.name} ${res.status}: ${(await res.text()).slice(0, 300)}`);
        const json = (await res.json()) as { choices?: { message?: { content?: string }; finish_reason?: string }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
        const text = stripReasoning(json.choices?.[0]?.message?.content ?? '');
        if (!text) throw new Error(`${this.name}: empty completion`);
        return { text, inputTokens: json.usage?.prompt_tokens ?? 0, outputTokens: json.usage?.completion_tokens ?? 0, truncated: json.choices?.[0]?.finish_reason === 'length' };
      } finally {
        clearTimeout(timer);
      }
    });
  }
}

export class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic';

  constructor(
    private apiKey: string,
    readonly model: string,
    private limiter: RateLimiter,
    private timeoutMs: number,
    private maxTokens: number,
    private baseUrl = 'https://api.anthropic.com',
  ) {}

  async complete(messages: ChatMessage[], opts: { maxTokens?: number; temperature?: number } = {}): Promise<CompletionResult> {
    await this.limiter.acquire();
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const rest = messages.filter((m) => m.role !== 'system');
    return withRetry(async () => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
      try {
        const res = await fetch(`${this.baseUrl}/v1/messages`, {
          method: 'POST',
          signal: ctrl.signal,
          headers: { 'content-type': 'application/json', 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: this.model, system, messages: rest, max_tokens: opts.maxTokens ?? this.maxTokens, temperature: opts.temperature ?? 0.4 }),
        });
        if (!res.ok) throw new HttpError(res.status, `anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
        const json = (await res.json()) as { content?: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number }; stop_reason?: string };
        const text = (json.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('').trim();
        if (!text) throw new Error('anthropic: empty completion');
        return { text, inputTokens: json.usage?.input_tokens ?? 0, outputTokens: json.usage?.output_tokens ?? 0, truncated: json.stop_reason === 'max_tokens' };
      } finally {
        clearTimeout(timer);
      }
    });
  }
}

export function createProvider(cfg: ServerConfig): { provider: AiProvider | null; info: AiProviderInfo; limiter: RateLimiter } {
  const limiter = new RateLimiter(cfg.AI_REQUESTS_PER_MINUTE, cfg.AI_DAILY_REQUEST_CAP);
  if (cfg.AI_PROVIDER === 'none') {
    return { provider: null, limiter, info: { connected: false, provider: null, detail: 'AI disabled (AI_PROVIDER=none). Workforce is simulated.' } };
  }
  const local = /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(cfg.AI_BASE_URL);
  if (!cfg.AI_API_KEY && !(cfg.AI_PROVIDER === 'openai-compatible' && local)) {
    return {
      provider: null,
      limiter,
      info: { connected: false, provider: null, detail: 'No AI_API_KEY configured on the server. Tasks are executed by the simulation and labelled [SIMULATED].' },
    };
  }
  const provider =
    cfg.AI_PROVIDER === 'anthropic'
      ? new AnthropicProvider(cfg.AI_API_KEY!, cfg.AI_MODEL, limiter, cfg.AI_TIMEOUT_MS, cfg.AI_MAX_TOKENS)
      : new OpenAICompatibleProvider(cfg.AI_BASE_URL, cfg.AI_API_KEY, cfg.AI_MODEL, limiter, cfg.AI_TIMEOUT_MS, cfg.AI_MAX_TOKENS, cfg.AI_THINKING === 'true');
  return {
    provider,
    limiter,
    info: {
      connected: true,
      provider: `${provider.name} · ${cfg.AI_MODEL}`,
      detail: `JARVIS projects are planned and executed by ${cfg.AI_MODEL} (${cfg.AI_REQUESTS_PER_MINUTE} req/min, ${cfg.AI_DAILY_REQUEST_CAP}/day cap). Company backlog work stays simulated.`,
    },
  };
}
