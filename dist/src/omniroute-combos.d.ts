import type { OmniRouteConfig, OmniRouteModel, OmniRouteModelMetadata } from './types.js';
import type { ModelsDevIndex, ModelsDevModel } from './models-dev.js';
export declare function sanitizeForLog(value: string): string;
/**
 * OmniRoute combo definition from /api/combos
 */
export interface OmniRouteCombo {
    id?: string;
    name: string;
    models: Array<string | {
        model?: string;
        id?: string;
        providerId?: string;
        kind?: string;
    }>;
    strategy: 'priority' | 'weighted' | 'round-robin' | 'random' | 'least-used' | 'cost-optimized';
    config?: {
        maxRetries?: number;
        retryDelayMs?: number;
        concurrencyPerModel?: number;
    };
    createdAt?: string;
    updatedAt?: string;
}
/**
 * OmniRoute combos API response
 */
export interface OmniRouteCombosResponse {
    combos: OmniRouteCombo[];
}
/**
 * Fetch combo data from OmniRoute /v1/combos endpoint
 * Falls back to /api/combos on HTTP 404 for older OmniRoute versions.
 */
export declare function fetchComboData(config: OmniRouteConfig): Promise<Map<string, OmniRouteCombo> | null>;
/**
 * Clear the combo cache
 */
export declare function clearComboCache(): void;
/**
 * Resolve a model ID to its underlying models
 * For combo models, returns the combo's model list
 * For regular models, returns [modelId]
 */
export declare function resolveUnderlyingModels(modelId: string, config: OmniRouteConfig): Promise<string[]>;
/**
 * Look up a model in the models.dev index
 * Handles provider/modelId format (e.g., "openai/gpt-4o")
 */
export declare function lookupModelInIndex(modelId: string, modelsDevIndex: ModelsDevIndex | null, config?: OmniRouteConfig): ModelsDevModel | null;
/**
 * Split a model ID into provider and model key
 * Handles formats like "provider/model", "omniroute/provider/model", etc.
 */
export declare function splitModelId(modelId: string): {
    providerKey: string | null;
    modelKey: string;
};
/**
 * Calculate capabilities for a model by resolving its underlying models
 * and computing lowest common capabilities
 */
export declare function calculateModelCapabilities(model: OmniRouteModel, config: OmniRouteConfig, modelsDevIndex: ModelsDevIndex | null): Promise<OmniRouteModelMetadata>;
/**
 * Check if a model is a combo model
 */
export declare function isComboModel(model: OmniRouteModel): boolean;
/**
 * Enrich models with combo-specific capabilities
 * This should be called after models.dev enrichment
 */
export declare function enrichComboModels(models: OmniRouteModel[], config: OmniRouteConfig, modelsDevIndex: ModelsDevIndex | null): Promise<OmniRouteModel[]>;
//# sourceMappingURL=omniroute-combos.d.ts.map