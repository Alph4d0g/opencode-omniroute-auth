/**
 * OmniRoute provider ID
 */
export declare const OMNIROUTE_PROVIDER_ID = "omniroute";
/**
 * Plugin definition ID shared by the V1 and V2 entry points.
 */
export declare const OMNIROUTE_PLUGIN_ID = "opencode-omniroute-auth";
/**
 * OpenCode V2 provider driver package IDs.
 *
 * V2 loads provider drivers from its bundled `@opencode/ai` registry instead
 * of the AI-SDK npm packages used by V1:
 * - chat mode  -> openai-compatible driver (/chat/completions)
 * - responses mode -> openai driver (/responses)
 */
export declare const OMNIROUTE_CHAT_PROVIDER_PACKAGE = "@opencode/ai/providers/openai-compatible";
export declare const OMNIROUTE_RESPONSES_PROVIDER_PACKAGE = "@opencode/ai/providers/openai";
/**
 * Default OmniRoute API endpoints
 */
export declare const OMNIROUTE_ENDPOINTS: {
    /** Base URL for OmniRoute API */
    BASE_URL: string;
    /** Models endpoint */
    MODELS: string;
    /** Chat completions endpoint */
    CHAT_COMPLETIONS: string;
    /** Responses endpoint */
    RESPONSES: string;
    /** Combos endpoint */
    COMBOS: string;
};
/**
 * Default models to use as fallback when /v1/models fails
 */
export declare const OMNIROUTE_DEFAULT_MODELS: {
    id: string;
    name: string;
    description: string;
    contextWindow: number;
    maxTokens: number;
    supportsStreaming: boolean;
    supportsVision: boolean;
    supportsTools: boolean;
}[];
/**
 * Model cache TTL in milliseconds (5 minutes)
 */
export declare const MODEL_CACHE_TTL: number;
/**
 * Request timeout in milliseconds (30 seconds)
 */
export declare const REQUEST_TIMEOUT = 30000;
/**
 * Default model context limit.
 */
export declare const DEFAULT_CONTEXT_LIMIT = 128000;
/**
 * Default output-token limit for models whose upstream reports none.
 *
 * Mirrors OpenCode's own `OUTPUT_TOKEN_MAX` (32 000) so the fallback matches
 * what OpenCode applies to models without a known limit. The field cannot
 * simply be omitted: OpenCode rejects a model whose `limit` object lacks
 * `output` (verified on 2.0.21 — such models fail with "Model unavailable").
 */
export declare const DEFAULT_OUTPUT_LIMIT = 32000;
/**
 * models.dev enrichment defaults
 */
export declare const MODELS_DEV_DEFAULT_URL = "https://models.dev/api.json";
export declare const MODELS_DEV_CACHE_TTL: number;
export declare const MODELS_DEV_TIMEOUT_MS = 5000;
/**
 * Provider alias-to-canonical mapping for deduplication
 */
export declare const PROVIDER_ALIAS_TO_CANONICAL: Record<string, string>;
/**
 * Friendly display labels for provider origins.
 * Used when modelNameDisplay is "prefixed".
 */
export declare const PROVIDER_DISPLAY_LABELS: Record<string, string>;
//# sourceMappingURL=constants.d.ts.map