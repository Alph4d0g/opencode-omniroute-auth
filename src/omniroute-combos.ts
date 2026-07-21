import { createHash } from 'node:crypto';

import type { OmniRouteConfig, OmniRouteModel, OmniRouteModelMetadata } from './types.js';
import type { ModelsDevIndex, ModelsDevModel } from './models-dev.js';
import {
  modelsDevToMetadata,
  calculateLowestCommonCapabilities,
  resolveProviderAlias,
  normalizeModelKey,
} from './models-dev.js';
import { REQUEST_TIMEOUT } from './constants.js';
import { warn, debug } from './logger.js';

export function sanitizeForLog(value: string): string {
  // Remove all control characters except tab (0x09)
  return value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

/**
 * OmniRoute combo definition from /api/combos
 */
export interface OmniRouteCombo {
  id: string;
  name: string;
  models: Array<string | { model?: string; id?: string }>;
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

// Cache entries are isolated by endpoint and a non-reversible credential digest.
const comboCaches = new Map<string, ComboCache>();
const COMBO_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function pruneExpiredComboCaches(now = Date.now()): void {
  for (const [key, cached] of comboCaches) {
    if (now - cached.timestamp >= COMBO_CACHE_TTL) {
      comboCaches.delete(key);
    }
  }
}

function getComboCacheKey(baseUrl: string, apiKey: string): string {
  const endpoint = `${baseUrl.replace(/\/v1\/?$/, '').replace(/\/$/, '')}/api/combos`;
  const credentialDigest = createHash('sha256').update(apiKey).digest('hex');
  return `${endpoint}\0${credentialDigest}`;
}

/**
 * Fetch combo data from OmniRoute /api/combos endpoint
 */
export async function fetchComboData(
  config: OmniRouteConfig,
): Promise<Map<string, OmniRouteCombo> | null> {
  const baseUrl = config.baseUrl;
  const apiKey = config.apiKey;

  if (!baseUrl || !apiKey) {
    warn('Cannot fetch combo data without baseUrl and apiKey');
    return null;
  }

  const cacheKey = getComboCacheKey(baseUrl, apiKey);

  // Check the cache for this endpoint and credential identity.
  const cached = comboCaches.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < COMBO_CACHE_TTL) {
    debug('Using cached combo data');
    return cached.combos;
  }

  const combosUrl = `${baseUrl.replace(/\/v1\/?$/, '').replace(/\/$/, '')}/api/combos`;
  debug(`Fetching combo data from ${combosUrl}`);

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
      warn(`Failed to fetch combo data: ${response.status}`);
      return null;
    }

    const data = await response.json() as OmniRouteCombosResponse;

    // Validate structure
    if (!data?.combos || !Array.isArray(data.combos)) {
      warn('Invalid combo data structure');
      return null;
    }

    // Build lookup map
    const comboMap = new Map<string, OmniRouteCombo>();
    for (const combo of data.combos) {
      if (combo?.name) {
        comboMap.set(combo.name, combo);
      }
    }

    // Update only this endpoint/credential cache entry.
    pruneExpiredComboCaches();
    comboCaches.set(cacheKey, {
      combos: comboMap,
      timestamp: Date.now(),
    });

    debug(`Successfully fetched ${comboMap.size} combos`);
    return comboMap;
  } catch (error) {
    warn(`Error fetching combo data: ${error}`);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Clear combo cache entries.
 * When config is provided, only that endpoint/credential identity is cleared.
 * Without config, the entire map is cleared (legacy behavior).
 */
export function clearComboCache(config?: Pick<OmniRouteConfig, 'baseUrl' | 'apiKey'>): void {
  if (!config?.baseUrl || !config.apiKey) {
    comboCaches.clear();
    debug('All combo caches cleared');
    return;
  }
  comboCaches.delete(getComboCacheKey(config.baseUrl, config.apiKey));
  debug('Combo cache cleared for provided configuration');
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
    debug(`Resolved combo "${sanitizeForLog(modelId)}" to ${combo.models.length} underlying models`);
    return combo.models
      .map((m) => {
        if (typeof m === 'string') return m;
        if (m && typeof m === 'object') {
          const modelId = (m as Record<string, unknown>).model ?? (m as Record<string, unknown>).id;
          if (typeof modelId === 'string') return modelId;
        }
        warn(`Unexpected model entry in combo: ${JSON.stringify(m)}`);
        return null;
      })
      .filter((m): m is string => m !== null);
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
export function splitModelId(modelId: string): { providerKey: string | null; modelKey: string } {
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
  debug(`Calculating capabilities for combo "${sanitizeForLog(model.id)}" from ${underlyingModels.length} models`);

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
    warn(
      `Could not resolve ${unresolvedModels.length} underlying models for "${sanitizeForLog(model.id)}": ${unresolvedModels.map(sanitizeForLog).join(', ')}`,
    );
  }

  if (resolvedModels.length === 0) {
    warn(`No models.dev matches found for combo "${sanitizeForLog(model.id)}"`);
    return {};
  }

  debug(`Resolved ${resolvedModels.length}/${underlyingModels.length} underlying models for "${sanitizeForLog(model.id)}"`);

  // Calculate lowest common capabilities
  const capabilities = calculateLowestCommonCapabilities(resolvedModels);

  debug(
    `Calculated capabilities for "${sanitizeForLog(model.id)}": context=${capabilities.contextWindow ?? 'N/A'}, maxTokens=${capabilities.maxTokens ?? 'N/A'}, vision=${capabilities.supportsVision ?? false}, tools=${capabilities.supportsTools ?? false}`,
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

  // Fallback: check all endpoint/credential-specific combo caches.
  for (const cached of comboCaches.values()) {
    if (cached.combos.has(model.id)) return true;
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

      debug(`Enriching combo model: ${sanitizeForLog(model.id)}`);

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
        ...(capabilities.supportsTemperature !== undefined
          ? { supportsTemperature: capabilities.supportsTemperature }
          : {}),
        ...(capabilities.supportsReasoning !== undefined
          ? { supportsReasoning: capabilities.supportsReasoning }
          : {}),
        ...(capabilities.supportsAttachment !== undefined
          ? { supportsAttachment: capabilities.supportsAttachment }
          : {}),
        ...(capabilities.supportsStreaming !== undefined ? { supportsStreaming: capabilities.supportsStreaming } : {}),
        ...(capabilities.pricing !== undefined ? { pricing: { ...model.pricing, ...capabilities.pricing } } : {}),
      };
    }),
  );
}
