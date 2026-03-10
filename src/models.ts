import type { OmniRouteConfig, OmniRouteModel, OmniRouteModelMetadata, OmniRouteModelsResponse } from './types.js';
import {
  OMNIROUTE_DEFAULT_MODELS,
  OMNIROUTE_ENDPOINTS,
  MODEL_CACHE_TTL,
  REQUEST_TIMEOUT,
} from './constants.js';
import { getModelsDevIndex, normalizeModelKey } from './models-dev.js';
import type { ModelsDevIndex } from './models-dev.js';
import { enrichComboModels, clearComboCache } from './omniroute-combos.js';

/**
 * Model cache entry
 */
interface ModelCache {
  models: OmniRouteModel[];
  timestamp: number;
}

/**
 * In-memory model cache keyed by endpoint and API key
 */
const modelCache = new Map<string, ModelCache>();

/**
 * Generate a cache key for a given configuration
 */
function getCacheKey(config: OmniRouteConfig, apiKey: string): string {
  const baseUrl = config.baseUrl || OMNIROUTE_ENDPOINTS.BASE_URL;
  return `${baseUrl}:${apiKey}`;
}

/**
 * Fetch models from OmniRoute /v1/models endpoint
 * This is the CRITICAL FEATURE - dynamically fetches available models
 *
 * @param config - OmniRoute configuration
 * @param apiKey - API key for authentication
 * @returns Array of available models
 */
export async function fetchModels(
  config: OmniRouteConfig,
  apiKey: string,
  forceRefresh: boolean = false,
): Promise<OmniRouteModel[]> {
  const cacheKey = getCacheKey(config, apiKey);

  // Check cache first if not forcing refresh
  if (!forceRefresh) {
    // Validate TTL is positive to prevent unexpected cache behavior
    const cacheTtl =
      config.modelCacheTtl && config.modelCacheTtl > 0 ? config.modelCacheTtl : MODEL_CACHE_TTL;

    const cached = modelCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < cacheTtl) {
      console.log('[OmniRoute] Using cached models');
      return cached.models;
    }
  } else {
    console.log('[OmniRoute] Forcing model refresh');
  }

  // Use default baseUrl if not provided to prevent undefined URL
  const baseUrl = config.baseUrl || OMNIROUTE_ENDPOINTS.BASE_URL;
  const modelsUrl = `${baseUrl}${OMNIROUTE_ENDPOINTS.MODELS}`;

  console.log(`[OmniRoute] Fetching models from ${modelsUrl}`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const response = await fetch(modelsUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      // Sanitize error - only log status, not response body
      console.error(
        `[OmniRoute] Failed to fetch models: ${response.status} ${response.statusText}`,
      );
      throw new Error(`Failed to fetch models: ${response.status} ${response.statusText}`);
    }

    // Parse and validate response structure before type casting
    const rawData = await response.json();

    // Runtime validation to ensure API returns expected structure
    if (!rawData || typeof rawData !== 'object' || !Array.isArray(rawData.data)) {
      console.error('[OmniRoute] Invalid models response structure:', rawData);
      throw new Error('Invalid models response structure: expected { data: Array }');
    }

    const data = rawData as OmniRouteModelsResponse;

    // Transform and validate models - filter out invalid entries
    const rawModels = data.data
      .filter(
        (model): model is OmniRouteModel =>
          model !== null && model !== undefined && typeof model.id === 'string',
      )
      .map((model) => ({
        ...model,
        // Ensure required fields
        id: model.id,
        name: model.name || model.id,
        description: model.description || `OmniRoute model: ${model.id}`,
        // Keep undefined for enrichment to work properly
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
        supportsStreaming: model.supportsStreaming,
        supportsVision: model.supportsVision,
        supportsTools: model.supportsTools,
      }));

    // Enrich with models.dev and combo capabilities
    const models = await enrichModelMetadata(rawModels, config);

    // Update cache
    modelCache.set(cacheKey, {
      models,
      timestamp: Date.now(),
    });

    console.log(`[OmniRoute] Successfully fetched ${models.length} models`);
    return models;
  } catch (error) {
    console.error('[OmniRoute] Error fetching models:', error);

    // Return cached models if available (even if expired)
    const cached = modelCache.get(cacheKey);
    if (cached) {
      console.log('[OmniRoute] Returning expired cached models as fallback');
      return cached.models;
    }

    // Return default models as last resort
    console.log('[OmniRoute] Returning default models as fallback');
    return config.defaultModels || OMNIROUTE_DEFAULT_MODELS;
  } finally {
    // Always clear the timeout to prevent memory leaks
    clearTimeout(timeoutId);
  }
}

/**
 * Clear the model cache
 * @param config - Optional OmniRoute configuration to clear specific cache
 * @param apiKey - Optional API key to clear specific cache
 */
export function clearModelCache(config?: OmniRouteConfig, apiKey?: string): void {
  if (config && apiKey) {
    const cacheKey = getCacheKey(config, apiKey);
    modelCache.delete(cacheKey);
    console.log('[OmniRoute] Model cache cleared for provided configuration');
  } else {
    modelCache.clear();
    console.log('[OmniRoute] All model caches cleared');
  }
  // Also clear combo cache
  clearComboCache();
}

/**
 * Get cached models without fetching
 * @param config - OmniRoute configuration
 * @param apiKey - API key for authentication
 * @returns Cached models or null
 */
export function getCachedModels(config: OmniRouteConfig, apiKey: string): OmniRouteModel[] | null {
  const cacheKey = getCacheKey(config, apiKey);
  return modelCache.get(cacheKey)?.models || null;
}

/**
 * Check if cache is valid
 * @param config - OmniRoute configuration
 * @param apiKey - API key for authentication
 * @returns True if cache is valid
 */
export function isCacheValid(config: OmniRouteConfig, apiKey: string): boolean {
  const cacheKey = getCacheKey(config, apiKey);
  const cached = modelCache.get(cacheKey);
  if (!cached) return false;
  const ttl = config.modelCacheTtl || MODEL_CACHE_TTL;
  return Date.now() - cached.timestamp < ttl;
}

/**
 * Force refresh models from API
 * @param config - OmniRoute configuration
 * @param apiKey - API key for authentication
 * @returns Array of available models
 */
export async function refreshModels(
  config: OmniRouteConfig,
  apiKey: string,
): Promise<OmniRouteModel[]> {
  clearModelCache();
  return fetchModels(config, apiKey, true);
}

/**
 * Enrich model metadata with models.dev data and combo capabilities
 */
async function enrichModelMetadata(
  models: OmniRouteModel[],
  config: OmniRouteConfig,
): Promise<OmniRouteModel[]> {
  const modelsDevIndex = await getModelsDevIndex(config);

  // Apply models.dev metadata enrichment
  const withModelsDev =
    modelsDevIndex === null
      ? models
      : models.map((model) => applyModelsDevMetadata(model, config, modelsDevIndex));

  // Enrich combo models with lowest common capabilities
  const withComboCapabilities = await enrichComboModels(withModelsDev, config, modelsDevIndex);

  return withComboCapabilities;
}

/**
 * Apply models.dev metadata to a model
 */
function applyModelsDevMetadata(
  model: OmniRouteModel,
  config: OmniRouteConfig,
  index: ModelsDevIndex,
): OmniRouteModel {
  const { providerKey, modelKey } = splitOmniRouteModelForLookup(model.id);
  const providerAlias = resolveProviderAlias(providerKey, config);
  const lookupKey = modelKey.toLowerCase();
  const normalizedKey = normalizeModelKey(modelKey);

  // Try provider-specific exact match first
  const providerExact = providerAlias
    ? index.exactByProvider.get(providerAlias)?.get(lookupKey)
    : undefined;

  // Try provider-specific normalized match
  const providerNorm = providerAlias
    ? index.normalizedByProvider.get(providerAlias)?.get(normalizedKey)
    : undefined;

  // Try global exact match (only if single match to avoid ambiguity)
  const globalExactList = index.exactGlobal.get(lookupKey);
  const globalExact = globalExactList?.length === 1 ? globalExactList[0] : undefined;

  // Try global normalized match (only if single match to avoid ambiguity)
  const globalNormList = index.normalizedGlobal.get(normalizedKey);
  const globalNorm = globalNormList?.length === 1 ? globalNormList[0] : undefined;

  // Pick the best match (provider-specific preferred over global)
  const best = providerExact ?? providerNorm ?? globalExact ?? globalNorm;

  if (!best) return model;

  // Merge capabilities (only fill in missing values)
  return {
    ...model,
    ...(model.contextWindow === undefined && best.limit?.context !== undefined
      ? { contextWindow: best.limit.context }
      : {}),
    ...(model.maxTokens === undefined && best.limit?.output !== undefined
      ? { maxTokens: best.limit.output }
      : {}),
    ...(model.supportsVision === undefined && best.modalities?.input?.includes('image')
      ? { supportsVision: true }
      : {}),
    ...(model.supportsTools === undefined && best.tool_call === true
      ? { supportsTools: true }
      : {}),
    ...(model.supportsStreaming === undefined
      ? { supportsStreaming: true } // Assume streaming is supported by default
      : {}),
  };
}

/**
 * Split model ID for models.dev lookup
 */
function splitOmniRouteModelForLookup(
  modelId: string,
): { providerKey: string | null; modelKey: string } {
  const trimmed = modelId.trim();

  // Remove omniroute prefix if present
  const withoutPrefix = trimmed.replace(/^omniroute\//, '');

  // Split by /
  const parts = withoutPrefix.split('/').filter((p) => p.trim() !== '');

  if (parts.length >= 2) {
    return {
      providerKey: parts[0] ?? null,
      modelKey: parts.slice(1).join('/'),
    };
  }

  return { providerKey: null, modelKey: withoutPrefix };
}

/**
 * Resolve provider alias using config
 */
function resolveProviderAlias(
  providerKey: string | null,
  config: OmniRouteConfig,
): string | null {
  if (!providerKey) return null;

  const lower = providerKey.toLowerCase();

  // Default aliases
  const aliases: Record<string, string> = {
    oai: 'openai',
    openai: 'openai',
    cx: 'openai',
    codex: 'openai',
    anthropic: 'anthropic',
    claude: 'anthropic',
    gemini: 'google',
    google: 'google',
    deepseek: 'deepseek',
    mistral: 'mistral',
    xai: 'xai',
    groq: 'groq',
    together: 'together',
    openrouter: 'openrouter',
    perplexity: 'perplexity',
    cohere: 'cohere',
    ...config.modelsDev?.providerAliases,
  };

  return aliases[lower] ?? lower;
}
