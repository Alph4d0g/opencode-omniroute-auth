import type { OmniRouteConfig, OmniRouteModel, OmniRouteModelMetadata } from './types.js';
import type { ModelsDevIndex, ModelsDevModel } from './models-dev.js';
import {
  modelsDevToMetadata,
  calculateLowestCommonCapabilities,
  resolveProviderAlias,
  normalizeModelKey,
} from './models-dev.js';
import { REQUEST_TIMEOUT } from './constants.js';

/**
 * OmniRoute combo definition from /api/combos
 */
export interface OmniRouteCombo {
  id: string;
  name: string;
  models: string[];
  strategy: 'priority' | 'weighted' | 'round-robin' | 'random' | 'least-used' | 'cost-optimized';
  config: {
    maxRetries?: number;
    retryDelayMs?: number;
    concurrencyPerModel?: number;
  };
  createdAt: string;
  updatedAt: string;
}

/**
 * OmniRoute combos API response
 */
export interface OmniRouteCombosResponse {
  combos: OmniRouteCombo[];
}

/**
 * Cache for combo data
 */
interface ComboCache {
  combos: Map<string, OmniRouteCombo>;
  timestamp: number;
}

// In-memory cache for combo data
let comboCache: ComboCache | null = null;
const COMBO_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch combo data from OmniRoute /api/combos endpoint
 */
export async function fetchComboData(
  config: OmniRouteConfig,
): Promise<Map<string, OmniRouteCombo> | null> {
  const baseUrl = config.baseUrl;
  const apiKey = config.apiKey;

  // Check cache first
  if (comboCache && Date.now() - comboCache.timestamp < COMBO_CACHE_TTL) {
    console.log('[OmniRoute] Using cached combo data');
    return comboCache.combos;
  }

  const combosUrl = `${baseUrl.replace(/\/v1\/?$/, '').replace(/\/$/, '')}/api/combos`;
  console.log(`[OmniRoute] Fetching combo data from ${combosUrl}`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const response = await fetch(combosUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      console.warn(`[OmniRoute] Failed to fetch combo data: ${response.status}`);
      return null;
    }

    const data = await response.json() as OmniRouteCombosResponse;

    // Validate structure
    if (!data?.combos || !Array.isArray(data.combos)) {
      console.warn('[OmniRoute] Invalid combo data structure');
      return null;
    }

    // Build lookup map
    const comboMap = new Map<string, OmniRouteCombo>();
    for (const combo of data.combos) {
      if (combo?.name) {
        comboMap.set(combo.name, combo);
      }
    }

    // Update cache
    comboCache = {
      combos: comboMap,
      timestamp: Date.now(),
    };

    console.log(`[OmniRoute] Successfully fetched ${comboMap.size} combos`);
    return comboMap;
  } catch (error) {
    console.warn('[OmniRoute] Error fetching combo data:', error);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Clear the combo cache
 */
export function clearComboCache(): void {
  comboCache = null;
  console.log('[OmniRoute] Combo cache cleared');
}

/**
 * Resolve a model ID to its underlying models
 * For combo models, returns the combo's model list
 * For regular models, returns [modelId]
 */
export async function resolveUnderlyingModels(
  modelId: string,
  config: OmniRouteConfig,
): Promise<string[]> {
  // Fetch combo data
  const combos = await fetchComboData(config);
  if (!combos) {
    return [modelId];
  }

  // Check if this is a combo model
  const combo = combos.get(modelId);
  if (combo) {
    console.log(`[OmniRoute] Resolved combo "${modelId}" to ${combo.models.length} underlying models`);
    return combo.models;
  }

  // Not a combo, return as-is
  return [modelId];
}

/**
 * Look up a model in the models.dev index
 * Handles provider/modelId format (e.g., "openai/gpt-4o")
 */
export function lookupModelInIndex(
  modelId: string,
  modelsDevIndex: ModelsDevIndex | null,
  config?: OmniRouteConfig,
): ModelsDevModel | null {
  if (!modelsDevIndex) return null;

  // Parse provider/model format
  const { providerKey, modelKey } = splitModelId(modelId);

  // Resolve provider alias
  const providerAlias = providerKey
    ? resolveProviderAlias(providerKey, config)
    : null;

  const lookupKey = modelKey.toLowerCase();
  const normalizedKey = normalizeModelKey(modelKey);

  // Try provider-specific lookups first
  if (providerAlias) {
    // Try exact match
    const providerExact = modelsDevIndex.exactByProvider.get(providerAlias)?.get(lookupKey);
    if (providerExact) return providerExact;

    // Try normalized match
    const providerNorm = modelsDevIndex.normalizedByProvider.get(providerAlias)?.get(normalizedKey);
    if (providerNorm) return providerNorm;
  }

  // Try global exact match
  const globalExactList = modelsDevIndex.exactGlobal.get(lookupKey);
  if (globalExactList?.length === 1) {
    return globalExactList[0];
  }

  // Try global normalized match
  const globalNormList = modelsDevIndex.normalizedGlobal.get(normalizedKey);
  if (globalNormList?.length === 1) {
    return globalNormList[0];
  }

  // If multiple matches, try to disambiguate by provider
  if (globalExactList && globalExactList.length > 1 && providerAlias) {
    const byProvider = globalExactList.find(m => {
      // Find which provider this model belongs to
      for (const [pKey, pMap] of modelsDevIndex.exactByProvider.entries()) {
        if (pMap.get(lookupKey) === m && pKey === providerAlias) {
          return true;
        }
      }
      return false;
    });
    if (byProvider) return byProvider;
  }

  // Return first match as fallback
  return globalExactList?.[0] ?? globalNormList?.[0] ?? null;
}

/**
 * Split a model ID into provider and model key
 * Handles formats like "provider/model", "omniroute/provider/model", etc.
 */
function splitModelId(modelId: string): { providerKey: string | null; modelKey: string } {
  const trimmed = modelId.trim();

  // Remove omniroute prefix if present
  const withoutPrefix = trimmed.replace(/^omniroute\//, '');

  // Split by /
  const parts = withoutPrefix.split('/').filter(p => p.trim() !== '');

  if (parts.length >= 2) {
    return {
      providerKey: parts[0] ?? null,
      modelKey: parts.slice(1).join('/'),
    };
  }

  // No provider prefix
  return {
    providerKey: null,
    modelKey: withoutPrefix,
  };
}

/**
 * Calculate capabilities for a model by resolving its underlying models
 * and computing lowest common capabilities
 */
export async function calculateModelCapabilities(
  model: OmniRouteModel,
  config: OmniRouteConfig,
  modelsDevIndex: ModelsDevIndex | null,
): Promise<OmniRouteModelMetadata> {
  // If not a combo model and already has capabilities, use existing
  if (model.contextWindow !== undefined && model.maxTokens !== undefined) {
    return {};
  }

  // Resolve underlying models
  const underlyingModels = await resolveUnderlyingModels(model.id, config);

  // If it's not a combo (single model), just look it up directly
  if (underlyingModels.length === 1 && underlyingModels[0] === model.id) {
    const match = lookupModelInIndex(model.id, modelsDevIndex, config);
    if (match) {
      return modelsDevToMetadata(match);
    }
    return {};
  }

  // It's a combo - lookup all underlying models
  console.log(`[OmniRoute] Calculating capabilities for combo "${model.id}" from ${underlyingModels.length} models`);

  const resolvedModels: ModelsDevModel[] = [];
  const unresolvedModels: string[] = [];

  for (const underlyingId of underlyingModels) {
    const match = lookupModelInIndex(underlyingId, modelsDevIndex, config);
    if (match) {
      resolvedModels.push(match);
    } else {
      unresolvedModels.push(underlyingId);
    }
  }

  if (unresolvedModels.length > 0) {
    console.warn(
      `[OmniRoute] Could not resolve ${unresolvedModels.length} underlying models for "${model.id}": ${unresolvedModels.join(', ')}`,
    );
  }

  if (resolvedModels.length === 0) {
    console.warn(`[OmniRoute] No models.dev matches found for combo "${model.id}"`);
    return {};
  }

  console.log(`[OmniRoute] Resolved ${resolvedModels.length}/${underlyingModels.length} underlying models for "${model.id}"`);

  // Calculate lowest common capabilities
  const capabilities = calculateLowestCommonCapabilities(resolvedModels);

  console.log(
    `[OmniRoute] Calculated capabilities for "${model.id}": context=${capabilities.contextWindow ?? 'N/A'}, maxTokens=${capabilities.maxTokens ?? 'N/A'}, vision=${capabilities.supportsVision ?? false}, tools=${capabilities.supportsTools ?? false}`,
  );

  return capabilities;
}

/**
 * Check if a model is a combo model
 */
export function isComboModel(model: OmniRouteModel): boolean {
  // Check owned_by field if available (from /v1/models response)
  // The plugin may receive models from the API with owned_by field
  const ownedBy = (model as unknown as Record<string, unknown>)?.owned_by;
  if (ownedBy === 'combo') {
    return true;
  }

  // Fallback: check if it's in our combo cache
  if (comboCache?.combos?.has(model.id)) {
    return true;
  }

  return false;
}

/**
 * Enrich models with combo-specific capabilities
 * This should be called after models.dev enrichment
 */
export async function enrichComboModels(
  models: OmniRouteModel[],
  config: OmniRouteConfig,
  modelsDevIndex: ModelsDevIndex | null,
): Promise<OmniRouteModel[]> {
  // Pre-fetch combo data to identify combo models
  const combos = await fetchComboData(config);
  if (!combos) {
    return models;
  }

  return Promise.all(
    models.map(async (model) => {
      // Check if this is a combo model
      const isCombo = combos.has(model.id);
      if (!isCombo) {
        return model;
      }

      console.log(`[OmniRoute] Enriching combo model: ${model.id}`);

      // Calculate capabilities for this combo
      const capabilities = await calculateModelCapabilities(model, config, modelsDevIndex);

      // Merge capabilities with existing model data (capabilities take precedence)
      return {
        ...model,
        ...(capabilities.name !== undefined ? { name: capabilities.name } : {}),
        ...(capabilities.contextWindow !== undefined ? { contextWindow: capabilities.contextWindow } : {}),
        ...(capabilities.maxTokens !== undefined ? { maxTokens: capabilities.maxTokens } : {}),
        ...(capabilities.supportsVision !== undefined ? { supportsVision: capabilities.supportsVision } : {}),
        ...(capabilities.supportsTools !== undefined ? { supportsTools: capabilities.supportsTools } : {}),
        ...(capabilities.supportsStreaming !== undefined ? { supportsStreaming: capabilities.supportsStreaming } : {}),
        ...(capabilities.pricing !== undefined ? { pricing: { ...model.pricing, ...capabilities.pricing } } : {}),
      };
    }),
  );
}
