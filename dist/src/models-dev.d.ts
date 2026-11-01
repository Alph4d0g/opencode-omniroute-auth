import type { OmniRouteConfig, OmniRouteModelMetadata } from './types.js';
/**
 * models.dev model information
 */
export interface ModelsDevModel {
    id: string;
    name: string;
    family?: string;
    attachment?: boolean;
    reasoning?: boolean;
    tool_call?: boolean;
    structured_output?: boolean;
    temperature?: boolean;
    knowledge?: string;
    release_date?: string;
    last_updated?: string;
    modalities?: {
        input?: string[];
        output?: string[];
    };
    open_weights?: boolean;
    cost?: {
        input?: number;
        output?: number;
        cache_read?: number;
    };
    limit?: {
        context?: number;
        output?: number;
    };
}
/**
 * models.dev provider entry
 */
export interface ModelsDevProvider {
    id: string;
    env?: string[];
    npm?: string;
    name?: string;
    doc?: string;
    models: Record<string, ModelsDevModel>;
}
/**
 * Full models.dev API response
 */
export type ModelsDevData = Record<string, ModelsDevProvider>;
/**
 * Indexed models.dev data for efficient lookup
 */
export interface ModelsDevIndex {
    /** Provider-specific exact matches: provider -> modelId -> metadata */
    exactByProvider: Map<string, Map<string, ModelsDevModel>>;
    /** Provider-specific normalized matches: provider -> normalizedKey -> metadata */
    normalizedByProvider: Map<string, Map<string, ModelsDevModel>>;
    /** Global exact matches across all providers: modelId -> [metadata] */
    exactGlobal: Map<string, ModelsDevModel[]>;
    /** Global normalized matches: normalizedKey -> [metadata] */
    normalizedGlobal: Map<string, ModelsDevModel[]>;
}
/**
 * Fetch models.dev data with caching, retries, and stale fallback.
 *
 * Worst-case cold-start latency when upstream is unavailable:
 * 3 attempts × 5000ms timeout + 250ms + 500ms backoff ≈ 15.75s.
 * This is an accepted trade-off for reliability per design spec.
 */
export declare function fetchModelsDevData(config?: OmniRouteConfig): Promise<ModelsDevData | null>;
/**
 * Build an indexed lookup structure for models.dev data
 */
export declare function buildModelsDevIndex(data: ModelsDevData | null): ModelsDevIndex | null;
/**
 * Get or build the models.dev index
 */
export declare function getModelsDevIndex(config?: OmniRouteConfig): Promise<ModelsDevIndex | null>;
/**
 * Clear the models.dev cache
 */
export declare function clearModelsDevCache(): void;
/**
 * Normalize a model key for matching
 * Removes version dates and common suffixes for fuzzy matching
 */
export declare function normalizeModelKey(modelId: string): string;
/**
 * Convert models.dev model to OmniRoute metadata
 */
export declare function modelsDevToMetadata(model: ModelsDevModel): OmniRouteModelMetadata;
/**
 * Calculate lowest common capabilities from multiple models.dev entries
 * Uses MIN for numeric limits (context, maxTokens) and EVERY for booleans
 */
export declare function calculateLowestCommonCapabilities(models: ModelsDevModel[]): OmniRouteModelMetadata;
/**
 * Subscription → public provider fallback map.
 * When a subscription provider (e.g. zai-coding-plan) lacks a model,
 * try its public counterpart (e.g. zai) before giving up.
 */
export declare const SUBSCRIPTION_FALLBACKS: Record<string, string>;
/**
 * Known model ID mismatches between OmniRoute and models.dev.
 * Maps OmniRoute model names to their models.dev equivalents.
 */
export declare const MODEL_ALIASES: Record<string, string>;
export declare function resolveModelAlias(modelKey: string): string;
/**
 * Resolve provider alias using config and defaults
 */
export declare function resolveProviderAlias(providerKey: string | null, config?: OmniRouteConfig): string | null;
/**
 * Get the public fallback provider for a subscription provider.
 * Returns null if no fallback exists.
 */
export declare function getSubscriptionFallback(provider: string): string | null;
/**
 * Strip reasoning effort variant suffix from a model name.
 * Returns the base model name and true if a suffix was stripped.
 */
export declare function stripVariantSuffix(modelKey: string): {
    base: string;
    stripped: boolean;
};
//# sourceMappingURL=models-dev.d.ts.map