import type { OmniRouteConfig, OmniRouteModel, OmniRouteModelsResponse } from "./types.js";
import { OMNIROUTE_DEFAULT_MODELS, MODEL_CACHE_TTL, REQUEST_TIMEOUT } from "./constants.js";

/**
 * Model cache entry
 */
interface ModelCache {
  models: OmniRouteModel[];
  timestamp: number;
}

/**
 * In-memory model cache
 */
let modelCache: ModelCache | null = null;

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
  apiKey: string
): Promise<OmniRouteModel[]> {
  // Check cache first
  // Validate TTL is positive to prevent unexpected cache behavior
  const cacheTtl = config.modelCacheTtl && config.modelCacheTtl > 0 
    ? config.modelCacheTtl 
    : MODEL_CACHE_TTL;
  
  if (modelCache && Date.now() - modelCache.timestamp < cacheTtl) {
    console.log("[OmniRoute] Using cached models");
    return modelCache.models;
  }

  // Use default baseUrl if not provided to prevent undefined URL
  const baseUrl = config.baseUrl || "http://localhost:20128/v1";
  const modelsUrl = `${baseUrl}/models`;

  console.log(`[OmniRoute] Fetching models from ${modelsUrl}`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const response = await fetch(modelsUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      // Sanitize error - only log status, not response body
      console.error(`[OmniRoute] Failed to fetch models: ${response.status} ${response.statusText}`);
      throw new Error(`Failed to fetch models: ${response.status} ${response.statusText}`);
    }

    // Parse and validate response structure before type casting
    const rawData = await response.json();
    
    // Runtime validation to ensure API returns expected structure
    if (!rawData || typeof rawData !== 'object' || !Array.isArray(rawData.data)) {
      console.error("[OmniRoute] Invalid models response structure:", rawData);
      throw new Error("Invalid models response structure: expected { data: Array }");
    }
    
    const data = rawData as OmniRouteModelsResponse;

    // Transform and validate models
    const models = data.data.map((model) => ({
      ...model,
      // Ensure required fields
      id: model.id,
      name: model.name || model.id,
      description: model.description || `OmniRoute model: ${model.id}`,
      contextWindow: model.contextWindow || 4096,
      maxTokens: model.maxTokens || 4096,
      supportsStreaming: model.supportsStreaming ?? true,
      supportsVision: model.supportsVision ?? false,
      supportsTools: model.supportsTools ?? true,
    }));

    // Update cache
    modelCache = {
      models,
      timestamp: Date.now(),
    };

    console.log(`[OmniRoute] Successfully fetched ${models.length} models`);
    return models;
  } catch (error) {
    console.error("[OmniRoute] Error fetching models:", error);

    // Return cached models if available (even if expired)
    if (modelCache) {
      console.log("[OmniRoute] Returning expired cached models as fallback");
      return modelCache.models;
    }

    // Return default models as last resort
    console.log("[OmniRoute] Returning default models as fallback");
    return config.defaultModels || OMNIROUTE_DEFAULT_MODELS;
  } finally {
    // Always clear the timeout to prevent memory leaks
    clearTimeout(timeoutId);
  }
}

/**
 * Clear the model cache
 */
export function clearModelCache(): void {
  modelCache = null;
  console.log("[OmniRoute] Model cache cleared");
}

/**
 * Get cached models without fetching
 * @returns Cached models or null
 */
export function getCachedModels(): OmniRouteModel[] | null {
  return modelCache?.models || null;
}

/**
 * Check if cache is valid
 * @param config - OmniRoute configuration
 * @returns True if cache is valid
 */
export function isCacheValid(config: OmniRouteConfig): boolean {
  if (!modelCache) return false;
  const ttl = config.modelCacheTtl || MODEL_CACHE_TTL;
  return Date.now() - modelCache.timestamp < ttl;
}

/**
 * Force refresh models from API
 * @param config - OmniRoute configuration
 * @param apiKey - API key for authentication
 * @returns Array of available models
 */
export async function refreshModels(
  config: OmniRouteConfig,
  apiKey: string
): Promise<OmniRouteModel[]> {
  clearModelCache();
  return fetchModels(config, apiKey);
}
