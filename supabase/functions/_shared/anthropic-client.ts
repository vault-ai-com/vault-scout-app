// _shared/anthropic-client.ts — Shared Anthropic API client for scout edge functions
// Single source of truth for model IDs, API version, and fetch logic.
// Sprint 160: Replaces 9 duplicated fetch blocks across 7 functions.

export const MODELS = {
  opus: "claude-opus-4-6",
  sonnet: "claude-sonnet-4-6",
  haiku: "claude-haiku-4-5",
} as const;

export type ModelKey = keyof typeof MODELS;
export type ModelId = (typeof MODELS)[ModelKey];

export const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
export const ANTHROPIC_VERSION = "2023-06-01";

// ---------------------------------------------------------------------------
// AnthropicError — typed error with 404-specific hint
// ---------------------------------------------------------------------------

export class AnthropicError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
  ) {
    const hint =
      status === 404
        ? " — model not found. Check MODELS constant in _shared/anthropic-client.ts"
        : "";
    super(`Anthropic API error (${status})${hint}: ${body}`);
    this.name = "AnthropicError";
  }
}

// ---------------------------------------------------------------------------
// resolveModel — strips date suffixes (-YYYYMMDD), validates against MODELS
// VCE09 F6: handles empty string and undefined safely
// ---------------------------------------------------------------------------

const VALID_MODELS = new Set<string>(Object.values(MODELS));

export function resolveModel(raw: string | undefined | null, fallback: ModelId = MODELS.sonnet): ModelId {
  if (!raw) return fallback;
  const stripped = raw.replace(/-\d{8}$/, "");
  if (VALID_MODELS.has(stripped)) return stripped as ModelId;
  return fallback;
}

// ---------------------------------------------------------------------------
// getAnthropicHeaders — for streaming callers (scout-bosse-chat)
// ---------------------------------------------------------------------------

export function getAnthropicHeaders(apiKey: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": ANTHROPIC_VERSION,
  };
}

// ---------------------------------------------------------------------------
// callAnthropic — standard non-streaming API call
// ---------------------------------------------------------------------------

export interface AnthropicMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AnthropicOptions {
  model?: ModelId;
  max_tokens?: number;
  temperature?: number;
  system?: string;
  messages?: AnthropicMessage[];
  timeoutMs?: number;
}

export interface AnthropicResult {
  text: string;
  usage: { input_tokens: number; output_tokens: number };
  stop_reason: string;
}

export async function callAnthropic(opts: AnthropicOptions): Promise<AnthropicResult> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY environment variable");

  const model = opts.model ?? MODELS.sonnet;
  const max_tokens = opts.max_tokens ?? 4096;
  const timeoutMs = opts.timeoutMs ?? 55000;

  const body: Record<string, unknown> = {
    model,
    max_tokens,
    messages: opts.messages ?? [],
  };

  if (opts.system !== undefined) body.system = opts.system;
  if (opts.temperature !== undefined) body.temperature = opts.temperature;

  const response = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: getAnthropicHeaders(apiKey),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new AnthropicError(response.status, errorText);
  }

  const data = (await response.json()) as {
    content: Array<{ type: string; text?: string }>;
    stop_reason: string;
    usage: { input_tokens: number; output_tokens: number };
  };

  const textBlock = data.content.find((c) => c.type === "text");

  return {
    text: textBlock?.text ?? "",
    usage: data.usage ?? { input_tokens: 0, output_tokens: 0 },
    stop_reason: data.stop_reason ?? "",
  };
}
