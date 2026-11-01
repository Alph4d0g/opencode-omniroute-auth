export declare function warn(message: string): void;
/**
 * Render an unknown thrown value as a readable message.
 *
 * `String(error)` yields `"[object Object]"` for thrown non-Error values, which
 * hides the real cause in logs. Errors keep their name, plain objects are
 * JSON-encoded, and everything else falls back to `String`.
 */
export declare function describeError(error: unknown): string;
export declare function debug(message: string): void;
//# sourceMappingURL=logger.d.ts.map