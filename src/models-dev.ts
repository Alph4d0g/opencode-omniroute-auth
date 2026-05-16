import type { OmniRouteConfig, OmniRouteModelMetadata } from './types.js';
import {
  MODELS_DEV_DEFAULT_URL,
  MODELS_DEV_CACHE_TTL,
  MODELS_DEV_TIMEOUT_MS,
} from './constants.js';
import { warn, debug } from './logger.js';

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
 * Cache entry for models.dev data
 */
interface ModelsDevCache {
  data: ModelsDevData;
  timestamp: number;
}

// In-memory cache for models.dev data
let modelsDevCache: ModelsDevCache | null = null;

/**
 * Fetch models.dev data with caching
 */
export async function fetchModelsDevData(
  config?: OmniRouteConfig,
): Promise<ModelsDevData | null> {
  const url = config?.modelsDev?.url ?? MODELS_DEV_DEFAULT_URL;
  const timeoutMs = config?.modelsDev?.timeoutMs ?? MODELS_DEV_TIMEOUT_MS;
  const cacheTtl = config?.modelsDev?.cacheTtl ?? MODELS_DEV_CACHE_TTL;

  // Check cache first
  if (modelsDevCache && Date.now() - modelsDevCache.timestamp < cacheTtl) {
    debug('Using cached models.dev data');
    return modelsDevCache.data;
  }

  debug(`Fetching models.dev data from ${url}`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      warn(`Failed to fetch models.dev data: ${response.status}`);
      return null;
    }

    const data = await response.json() as ModelsDevData;

    // Validate structure
    if (!data || typeof data !== 'object') {
      warn('Invalid models.dev data structure');
      return null;
    }

    // Update cache
    modelsDevCache = {
      data,
      timestamp: Date.now(),
    };

    debug('Successfully fetched models.dev data');
    return data;
  } catch (error) {
    warn(`Error fetching models.dev data: ${error}`);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Build an indexed lookup structure for models.dev data
 */
export function buildModelsDevIndex(data: ModelsDevData | null): ModelsDevIndex | null {
  if (!data) return null;

  const exactByProvider = new Map<string, Map<string, ModelsDevModel>>();
  const normalizedByProvider = new Map<string, Map<string, ModelsDevModel>>();
  const exactGlobal = new Map<string, ModelsDevModel[]>();
  const normalizedGlobal = new Map<string, ModelsDevModel[]>();

  for (const [providerId, provider] of Object.entries(data)) {
    if (!provider?.models) continue;

    const providerExactMap = new Map<string, ModelsDevModel>();
    const providerNormMap = new Map<string, ModelsDevModel>();

    for (const [modelId, model] of Object.entries(provider.models)) {
      // Provider-specific lookups
      const lookupKey = modelId.toLowerCase();
      providerExactMap.set(lookupKey, model);

      const normalizedKey = normalizeModelKey(modelId);
      providerNormMap.set(normalizedKey, model);

      // Global lookups
      const globalList = exactGlobal.get(lookupKey) ?? [];
      globalList.push(model);
      exactGlobal.set(lookupKey, globalList);

      const normGlobalList = normalizedGlobal.get(normalizedKey) ?? [];
      normGlobalList.push(model);
      normalizedGlobal.set(normalizedKey, normGlobalList);
    }

    exactByProvider.set(providerId.toLowerCase(), providerExactMap);
    normalizedByProvider.set(providerId.toLowerCase(), providerNormMap);
  }

  return {
    exactByProvider,
    normalizedByProvider,
    exactGlobal,
    normalizedGlobal,
  };
}

/**
 * Get or build the models.dev index
 */
export async function getModelsDevIndex(
  config?: OmniRouteConfig,
): Promise<ModelsDevIndex | null> {
  // Check if models.dev enrichment is disabled
  if (config?.modelsDev?.enabled === false) {
    return null;
  }

  const data = await fetchModelsDevData(config);
  return buildModelsDevIndex(data);
}


/**
 * Clear the models.dev cache
 */
export function clearModelsDevCache(): void {
  modelsDevCache = null;
  debug('models.dev cache cleared');
}

/**
 * Normalize a model key for matching
 * Removes version dates and common suffixes for fuzzy matching
 */
export function normalizeModelKey(modelId: string): string {
  return modelId
    .toLowerCase()
    // Remove date suffixes like -2024-11-20
    .replace(/-\d{4}-\d{2}-\d{2}$/, '')
    // Remove version numbers like -v1, -v2
    .replace(/-v\d+$/, '')
    // Remove common preview suffixes
    .replace(/-(preview|latest|stable)$/i, '')
    // Remove numbered versions like -4.5
    .replace(/-\d+\.\d+$/, '')
    // Normalize underscores to hyphens
    .replace(/_/g, '-');
}

/**
 * Convert models.dev model to OmniRoute metadata
 */
export function modelsDevToMetadata(model: ModelsDevModel): OmniRouteModelMetadata {
  const metadata: OmniRouteModelMetadata = {};

  if (model.name) {
    metadata.name = model.name;
  }

  if (model.limit?.context !== undefined && model.limit.context > 0) {
    metadata.contextWindow = model.limit.context;
  }

  if (model.limit?.output !== undefined && model.limit.output > 0) {
    metadata.maxTokens = model.limit.output;
  }

  if (model.temperature !== undefined) {
    metadata.supportsTemperature = model.temperature;
  }

  if (model.reasoning !== undefined) {
    metadata.supportsReasoning = model.reasoning;
  }

  if (model.attachment !== undefined) {
    metadata.supportsAttachment = model.attachment;
  }

  // Derive vision support from modalities
  if (model.modalities?.input?.includes('image')) {
    metadata.supportsVision = true;
  }

  // Derive tool support from tool_call
  if (model.tool_call === true) {
    metadata.supportsTools = true;
  }

  // Pricing
  if (model.cost?.input !== undefined || model.cost?.output !== undefined) {
    metadata.pricing = {};
    if (model.cost.input !== undefined) {
      metadata.pricing.input = model.cost.input;
    }
    if (model.cost.output !== undefined) {
      metadata.pricing.output = model.cost.output;
    }
  }

  return metadata;
}

/**
 * Calculate lowest common capabilities from multiple models.dev entries
 * Uses MIN for numeric limits (context, maxTokens) and EVERY for booleans
 */
export function calculateLowestCommonCapabilities(
  models: ModelsDevModel[],
): OmniRouteModelMetadata {
  if (models.length === 0) {
    return {};
  }

  if (models.length === 1) {
    return modelsDevToMetadata(models[0]);
  }

  // Calculate lowest common denominator
  let minContext: number | undefined;
  let minMaxTokens: number | undefined;
  let allSupportVision = true;
  let allSupportTools = true;
  let allSupportTemperature = true;
  let hasTemperatureMetadata = false;
  let allSupportReasoning = true;
  let hasReasoningMetadata = false;
  let allSupportAttachment = true;
  let hasAttachmentMetadata = false;
  let allSupportStreaming = true;

  for (const model of models) {
    // Context window: use minimum
    const context = model.limit?.context;
    if (context !== undefined && context > 0) {
      minContext = minContext === undefined ? context : Math.min(minContext, context);
    }

    // Max tokens: use minimum
    const maxTokens = model.limit?.output;
    if (maxTokens !== undefined && maxTokens > 0) {
      minMaxTokens = minMaxTokens === undefined ? maxTokens : Math.min(minMaxTokens, maxTokens);
    }

    // Vision: all must support it
    const supportsVision = model.modalities?.input?.includes('image') ?? false;
    allSupportVision = allSupportVision && supportsVision;

    // Tools: all must support it
    // For combos: only advertise tools if ALL underlying models explicitly support them
    // This is intentionally stricter than single-model defaults because a combo
    // with one tool-less model cannot reliably use tools across all backends
    const supportsTools = model.tool_call === true;
    allSupportTools = allSupportTools && supportsTools;

    if (model.temperature !== undefined) {
      hasTemperatureMetadata = true;
      allSupportTemperature = allSupportTemperature && model.temperature;
    }

    if (model.reasoning !== undefined) {
      hasReasoningMetadata = true;
      allSupportReasoning = allSupportReasoning && model.reasoning;
    }

    if (model.attachment !== undefined) {
      hasAttachmentMetadata = true;
      allSupportAttachment = allSupportAttachment && model.attachment;
    }
  }

  const result: OmniRouteModelMetadata = {};

  if (minContext !== undefined) {
    result.contextWindow = minContext;
  }

  if (minMaxTokens !== undefined) {
    result.maxTokens = minMaxTokens;
  }

  if (allSupportVision) {
    result.supportsVision = true;
  }

  if (allSupportTools) {
    result.supportsTools = true;
  }

  if (hasTemperatureMetadata && allSupportTemperature) {
    result.supportsTemperature = true;
  } else if (hasTemperatureMetadata) {
    result.supportsTemperature = false;
  }

  if (hasReasoningMetadata && allSupportReasoning) {
    result.supportsReasoning = true;
  } else if (hasReasoningMetadata) {
    result.supportsReasoning = false;
  }

  if (hasAttachmentMetadata && allSupportAttachment) {
    result.supportsAttachment = true;
  } else if (hasAttachmentMetadata) {
    result.supportsAttachment = false;
  }

  // Streaming is generally supported by all modern models
  if (allSupportStreaming) {
    result.supportsStreaming = true;
  }

  return result;
}


/**
 * Subscription → public provider fallback map.
 * When a subscription provider (e.g. zai-coding-plan) lacks a model,
 * try its public counterpart (e.g. zai) before giving up.
 */
export const SUBSCRIPTION_FALLBACKS: Record<string, string> = {
  'zai-coding-plan': 'zai',
  'kimi-for-coding': 'moonshotai',
  'github-models': 'google',
};

/**
 * Known model ID mismatches between OmniRoute and models.dev.
 * Maps OmniRoute model names to their models.dev equivalents.
 */
export const MODEL_ALIASES: Record<string, string> = {
  'kimi-k2.6-thinking': 'kimi-k2-thinking',
  'kimi-k2.6-thinking-turbo': 'kimi-k2-thinking-turbo',
};

export function resolveModelAlias(modelKey: string): string {
  const lower = modelKey.toLowerCase();
  return MODEL_ALIASES[lower] ?? MODEL_ALIASES[normalizeModelKey(lower)] ?? modelKey;
}

/**
 * Resolve provider alias using config and defaults
 */
export function resolveProviderAlias(
  providerKey: string | null,
  config?: OmniRouteConfig,
): string | null {
  if (!providerKey) return null;

  const lower = providerKey.toLowerCase();

  // Default aliases mapping OmniRoute provider keys to models.dev provider keys
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
    glmt: 'zai-coding-plan',
    glm: 'zai-coding-plan',
    'kimi-coding': 'moonshotai',
    kmc: 'moonshotai',
    gh: 'google',
    github: 'google',
    ...config?.modelsDev?.providerAliases,
  };

  return aliases[lower] ?? lower;
}

/**
 * Get the public fallback provider for a subscription provider.
 * Returns null if no fallback exists.
 */
export function getSubscriptionFallback(provider: string): string | null {
  return SUBSCRIPTION_FALLBACKS[provider.toLowerCase()] ?? null;
}

/**
 * Strip reasoning effort variant suffix from a model name.
 * Returns the base model name and true if a suffix was stripped.
 */
export function stripVariantSuffix(modelKey: string): { base: string; stripped: boolean } {
  const variantPattern = /-(low|medium|high|xhigh)$/i;
  const match = modelKey.match(variantPattern);
  if (match) {
    return { base: modelKey.slice(0, match.index), stripped: true };
  }
  return { base: modelKey, stripped: false };
}

