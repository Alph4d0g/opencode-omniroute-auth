export declare function isRecord(value: unknown): value is Record<string, unknown>;
/**
 * Normalize cached-token accounting in a /chat/completions response.
 *
 * Returns the original response unchanged when nothing needs to be fixed.
 * For JSON responses the body is replaced with a normalized clone; for SSE
 * streams a transforming stream is wrapped around the original body.
 */
export declare function normalizeChatUsageResponse(url: string, response: Response): Promise<Response>;
/**
 * Sanitize a raw chat/responses request body.
 *
 * Synchronous core shared by the V1 fetch interceptor (body extracted from
 * RequestInfo/RequestInit) and the V2 http.request hook (body read from a
 * cloned Request). Returns the sanitized JSON string, or undefined when the
 * payload does not need to change.
 */
export declare function sanitizeChatPayload(rawBody: string | undefined, url: string): string | undefined;
//# sourceMappingURL=http-sanitize.d.ts.map