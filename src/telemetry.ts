/**
 * Prefer gateway-reported inference telemetry. Never invent tok/s from
 * tokens / latency (that includes TTFT and tool pauses).
 */
export type GatewayInferenceTelemetry = {
  costUsd?: number;
  tokensPerSecond?: number;
  ttftMs?: number;
  model?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function readPositiveNumber(value: unknown): number | undefined {
  const parsed = readFiniteNumber(value);
  if (parsed === undefined || parsed <= 0) return undefined;
  return parsed;
}

function header(headers: Headers, name: string): string | null {
  return headers.get(name);
}

export function parseGatewayInferenceTelemetry(headers: Headers): GatewayInferenceTelemetry {
  const out: GatewayInferenceTelemetry = {};
  const cost = readFiniteNumber(
    header(headers, "x-omniroute-response-cost") ?? header(headers, "x-cliproxyapi-response-cost"),
  );
  if (cost !== undefined && cost >= 0) out.costUsd = cost;
  const tps = readPositiveNumber(
    header(headers, "x-omniroute-tokens-per-second") ??
      header(headers, "x-cliproxyapi-tokens-per-second") ??
      header(headers, "x-cliproxy-tokens-per-second"),
  );
  if (tps !== undefined) out.tokensPerSecond = tps;
  const ttft = readPositiveNumber(
    header(headers, "x-omniroute-ttft-ms") ?? header(headers, "x-cliproxyapi-ttft-ms"),
  );
  if (ttft !== undefined) out.ttftMs = ttft;
  const model =
    header(headers, "x-omniroute-model") ?? header(headers, "x-cliproxyapi-model");
  if (model && model.trim()) out.model = model.trim();
  return out;
}

export function tokensPerSecondFromUsage(usage: unknown): number | undefined {
  if (!isRecord(usage)) return undefined;
  return (
    readPositiveNumber(usage.tokens_per_second) ??
    readPositiveNumber(usage.tokensPerSecond)
  );
}

export function formatToksDisplay(tps: number | undefined): string {
  return tps === undefined ? "—" : String(tps);
}

function isInferencePayload(payload: Record<string, unknown>): boolean {
  return (
    isRecord(payload.usage) ||
    Array.isArray(payload.choices) ||
    payload.object === "chat.completion" ||
    payload.object === "chat.completion.chunk" ||
    payload.object === "response" ||
    payload.type === "message" ||
    Array.isArray(payload.output)
  );
}

function attachToUsage(
  usage: Record<string, unknown>,
  telemetry: GatewayInferenceTelemetry,
): Record<string, unknown> {
  const next = { ...usage };
  const existing = tokensPerSecondFromUsage(next);
  if (existing === undefined && telemetry.tokensPerSecond !== undefined) {
    next.tokens_per_second = telemetry.tokensPerSecond;
  }
  if (telemetry.ttftMs !== undefined && readPositiveNumber(next.ttft_ms) === undefined) {
    next.ttft_ms = telemetry.ttftMs;
  }
  if (telemetry.costUsd !== undefined && typeof next.cost !== "number") {
    next.cost = telemetry.costUsd;
  }
  return next;
}

export function attachGatewayTelemetryToPayload(
  payload: unknown,
  telemetry: GatewayInferenceTelemetry,
): unknown {
  if (!isRecord(payload) || !isInferencePayload(payload)) return payload;
  const next: Record<string, unknown> = { ...payload };
  if (telemetry.model) next.model = telemetry.model;
  if (isRecord(next.usage)) {
    next.usage = attachToUsage(next.usage, {
      ...telemetry,
      tokensPerSecond: telemetry.tokensPerSecond ?? tokensPerSecondFromUsage(next.usage),
    });
  }
  return next;
}

export function attachGatewayTelemetryToSseLine(
  line: string,
  telemetry: GatewayInferenceTelemetry,
): string {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return line;
  const jsonText = trimmed.slice("data:".length).trim();
  if (!jsonText.startsWith("{")) return line;
  try {
    const parsed = JSON.parse(jsonText) as unknown;
    const updated = attachGatewayTelemetryToPayload(parsed, telemetry);
    if (updated === parsed) return line;
    const prefix = line.slice(0, line.indexOf(jsonText));
    return `${prefix}${JSON.stringify(updated)}`;
  } catch {
    return line;
  }
}

export async function applyGatewayInferenceTelemetry(response: Response): Promise<Response> {
  const telemetry = parseGatewayInferenceTelemetry(response.headers);
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream") && response.body) {
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let pending = "";
    const mapped = response.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          pending += decoder.decode(chunk, { stream: true });
          const lines = pending.split("\n");
          pending = lines.pop() ?? "";
          for (const line of lines) {
            controller.enqueue(encoder.encode(`${attachGatewayTelemetryToSseLine(line, telemetry)}\n`));
          }
        },
        flush(controller) {
          if (pending.length > 0) {
            controller.enqueue(encoder.encode(attachGatewayTelemetryToSseLine(pending, telemetry)));
          }
        },
      }),
    );
    return new Response(mapped, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }
  if (!contentType.includes("json")) return response;
  const text = await response.text();
  try {
    const parsed = JSON.parse(text) as unknown;
    const next = attachGatewayTelemetryToPayload(parsed, telemetry);
    if (next === parsed) {
      return new Response(text, { status: response.status, statusText: response.statusText, headers: response.headers });
    }
    return new Response(JSON.stringify(next), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } catch {
    return new Response(text, { status: response.status, statusText: response.statusText, headers: response.headers });
  }
}
