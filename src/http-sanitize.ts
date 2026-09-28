/**
 * Shared HTTP payload sanitization for the V1 fetch interceptor and the V2
 * session http hooks.
 *
 * Two concerns are handled here:
 *
 * 1. Request payload sanitization: strip fields that specific upstream
 *    models reject (Claude title requests with reasoning effort, Gemini tool
 *    schemas with unsupported keywords).
 *
 * 2. Chat usage normalization: subtract cached prompt tokens from
 *    `prompt_tokens` so OpenCode's per-token accounting matches what the
 *    provider actually billed as fresh input.
 */
import { debug, warn } from './logger.js';
import { sanitizeForLog } from './omniroute-combos.js';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function getRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function cloneMutableResponseHeaders(headers: Headers): Headers {
  const next = new Headers(headers);
  next.delete('Content-Length');
  next.delete('Content-Encoding');
  return next;
}

/**
 * Normalize cached-token accounting in a /chat/completions response.
 *
 * Returns the original response unchanged when nothing needs to be fixed.
 * For JSON responses the body is replaced with a normalized clone; for SSE
 * streams a transforming stream is wrapped around the original body.
 */
export async function normalizeChatUsageResponse(url: string, response: Response): Promise<Response> {
  if (!response.ok || !url.includes('/chat/completions')) {
    return response;
  }

  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (contentType.includes('application/json')) {
    return await normalizeJsonChatUsageResponse(response);
  }

  if (contentType.includes('text/event-stream')) {
    return normalizeSseChatUsageResponse(response);
  }

  debug('Skipping cached-token normalization: unrecognized Content-Type for /chat/completions');
  return response;
}

async function normalizeJsonChatUsageResponse(response: Response): Promise<Response> {
  let payload: unknown;
  try {
    payload = await response.clone().json();
  } catch {
    return response;
  }

  if (!isRecord(payload) || !normalizeCachedChatUsage(payload)) {
    return response;
  }

  const headers = cloneMutableResponseHeaders(response.headers);
  headers.set('Content-Type', 'application/json');
  return new Response(JSON.stringify(payload), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function normalizeSseChatUsageResponse(response: Response): Response {
  if (!response.body) {
    return response;
  }

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let pending = '';

  const stream = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      pending += decoder.decode(chunk, { stream: true });
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';

      for (let line of lines) {
        if (line.endsWith('\r')) {
          line = line.slice(0, -1);
        }
        controller.enqueue(encoder.encode(`${normalizeSseChatUsageLine(line)}\n`));
      }
    },
    flush(controller) {
      let tail = pending + decoder.decode();
      if (tail) {
        if (tail.endsWith('\r')) {
          tail = tail.slice(0, -1);
        }
        controller.enqueue(encoder.encode(`${normalizeSseChatUsageLine(tail)}\n`));
      }
    },
  }));

  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers: cloneMutableResponseHeaders(response.headers),
  });
}

function normalizeSseChatUsageLine(line: string): string {
  if (!line.startsWith('data:')) {
    return line;
  }

  const rawData = line.slice(5).trim();
  if (!rawData || rawData === '[DONE]') {
    return line;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawData);
  } catch {
    return line;
  }

  if (!isRecord(payload) || !normalizeCachedChatUsage(payload)) {
    return line;
  }

  return `data: ${JSON.stringify(payload)}`;
}

function normalizeCachedChatUsage(payload: Record<string, unknown>): boolean {
  const usage = payload.usage;
  if (!isRecord(usage)) {
    return false;
  }

  const promptTokens = getNumber(usage.prompt_tokens);
  const promptDetails = getRecord(usage.prompt_tokens_details);
  const cachedTokens = getNumber(promptDetails?.cached_tokens);
  if (
    promptTokens === undefined ||
    cachedTokens === undefined ||
    cachedTokens <= 0 ||
    cachedTokens > promptTokens
  ) {
    return false;
  }

  // OpenCode tracks cached input separately, so prompt_tokens must be non-cached.
  usage.prompt_tokens = promptTokens - cachedTokens;
  const totalTokens = getNumber(usage.total_tokens);
  if (totalTokens !== undefined && totalTokens >= cachedTokens) {
    usage.total_tokens = totalTokens - cachedTokens;
  }
  return true;
}

const GEMINI_SCHEMA_KEYS_TO_REMOVE = new Set(['$schema', '$ref', 'ref', 'additionalProperties']);
const TITLE_PROMPT_REQUIRED_MARKERS = [
  'you are a title generator',
  'thread title',
];

/**
 * Sanitize a raw chat/responses request body.
 *
 * Synchronous core shared by the V1 fetch interceptor (body extracted from
 * RequestInfo/RequestInit) and the V2 http.request hook (body read from a
 * cloned Request). Returns the sanitized JSON string, or undefined when the
 * payload does not need to change.
 */
export function sanitizeChatPayload(rawBody: string | undefined, url: string): string | undefined {
  if (!url.includes('/chat/completions') && !url.includes('/responses')) {
    return undefined;
  }

  if (!rawBody) {
    return undefined;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch (error) {
    warn(`Failed to parse request body as JSON; forwarding unchanged: ${sanitizeForLog(String(error))}`);
    return undefined;
  }

  if (!isRecord(payload)) {
    return undefined;
  }

  const mayMutate = isClaudeModel(payload.model) || isGeminiModel(payload.model);
  const workingPayload = mayMutate ? structuredClone(payload) : payload;
  let changed = false;

  changed = stripClaudeTitleReasoningEffort(workingPayload) || changed;
  changed = sanitizeGeminiToolSchemas(workingPayload) || changed;

  return changed ? JSON.stringify(workingPayload) : undefined;
}

function stripClaudeTitleReasoningEffort(payload: Record<string, unknown>): boolean {
  const model = payload.model;
  if (!isClaudeModel(model)) {
    return false;
  }
  if (!isOpenCodeTitlePrompt(payload)) {
    debug('Claude request detected but title markers not found; preserving reasoning effort');
    return false;
  }

  let changed = false;
  if ('reasoning_effort' in payload) {
    delete payload.reasoning_effort;
    changed = true;
  }
  if ('reasoningEffort' in payload) {
    delete payload.reasoningEffort;
    changed = true;
  }

  if (changed) {
    debug('Removed reasoning effort from Claude title request');
  }

  return changed;
}

function isClaudeModel(model: unknown): boolean {
  if (typeof model !== 'string') return false;
  const lower = model.toLowerCase();
  // OmniRoute canonical aliases: claude/<model> and anthropic/<model>
  if (lower.startsWith('claude/') || lower.startsWith('anthropic/')) return true;
  // Provider-prefixed IDs where the provider slug ends with the model family,
  // e.g. aws/us-claude-sonnet-4-6 or openrouter/claude-3-5-sonnet
  if (/\bclaude[-/]/.test(lower)) return true;
  return false;
}

function isGeminiModel(model: unknown): boolean {
  return typeof model === 'string' && model.toLowerCase().includes('gemini');
}

function isOpenCodeTitlePrompt(payload: Record<string, unknown>): boolean {
  if (contentContainsTitlePrompt(payload.instructions)) return true;
  if (contentContainsTitlePrompt(payload.system)) return true;

  const messages = payload.messages;
  if (Array.isArray(messages)) {
    const hasTitlePrompt = messages.some((message) => {
      if (!isRecord(message) || message.role !== 'system') return false;
      return contentContainsTitlePrompt(message.content);
    });
    if (hasTitlePrompt) return true;
  }

  const input = payload.input;
  if (Array.isArray(input)) {
    const hasTitlePrompt = input.some((item) => {
      if (!isRecord(item) || item.role !== 'system') return false;
      return contentContainsTitlePrompt(item.content);
    });
    if (hasTitlePrompt) return true;
  }

  return false;
}

function contentContainsTitlePrompt(content: unknown): boolean {
  const text = contentToText(content);
  if (!text) return false;
  const normalized = text.toLowerCase();
  return TITLE_PROMPT_REQUIRED_MARKERS.every((marker) => normalized.includes(marker));
}

const MAX_CONTENT_DEPTH = 10;

function contentToText(content: unknown, depth = 0): string {
  if (depth > MAX_CONTENT_DEPTH) return '';
  if (typeof content === 'string') return content;

  if (Array.isArray(content)) {
    return content.map((item) => contentToText(item, depth + 1)).filter(Boolean).join('\n');
  }

  if (!isRecord(content)) return '';
  const text = content.text;
  if (typeof text === 'string') return text;
  const value = content.value;
  if (typeof value === 'string') return value;
  const contentValue = content.content;
  if (contentValue !== undefined) return contentToText(contentValue, depth + 1);
  return '';
}

/**
 * Sanitizes Gemini tool schemas in place.
 * Mutates `payload` and returns `true` if any keys were removed.
 */
function sanitizeGeminiToolSchemas(payload: Record<string, unknown>): boolean {
  const model = payload.model;
  if (!isGeminiModel(model)) {
    return false;
  }

  const tools = payload.tools;
  if (!Array.isArray(tools) || tools.length === 0) {
    return false;
  }

  const changed = sanitizeToolSchemaContainer(payload);
  if (changed) {
    debug('Sanitized Gemini tool schema keywords');
  }
  return changed;
}

function sanitizeToolSchemaContainer(payload: Record<string, unknown>): boolean {
  const tools = payload.tools;
  if (!Array.isArray(tools)) {
    return false;
  }

  let changed = false;
  for (const tool of tools) {
    if (!isRecord(tool)) {
      continue;
    }

    if (isRecord(tool.function) && isRecord(tool.function.parameters)) {
      changed = stripSchemaKeys(tool.function.parameters) || changed;
    }

    if (isRecord(tool.function_declaration) && isRecord(tool.function_declaration.parameters)) {
      changed = stripSchemaKeys(tool.function_declaration.parameters) || changed;
    }

    if (isRecord(tool.input_schema)) {
      changed = stripSchemaKeys(tool.input_schema) || changed;
    }
  }

  return changed;
}

function stripSchemaKeys(schema: Record<string, unknown>): boolean {
  let changed = false;

  for (const key of Object.keys(schema)) {
    if (GEMINI_SCHEMA_KEYS_TO_REMOVE.has(key)) {
      delete schema[key];
      changed = true;
      continue;
    }

    const value = schema[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isRecord(item)) {
          changed = stripSchemaKeys(item) || changed;
        }
      }
      continue;
    }

    if (isRecord(value)) {
      changed = stripSchemaKeys(value) || changed;
    }
  }

  return changed;
}
