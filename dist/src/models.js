import { DEFAULT_OUTPUT_LIMIT, OMNIROUTE_DEFAULT_MODELS, OMNIROUTE_ENDPOINTS, MODEL_CACHE_TTL, REQUEST_TIMEOUT, PROVIDER_ALIAS_TO_CANONICAL, } from './constants.js';
import { getModelsDevIndex, normalizeModelKey, getSubscriptionFallback, stripVariantSuffix, resolveProviderAlias, resolveModelAlias, } from './models-dev.js';
import { enrichComboModels, clearComboCache, splitModelId } from './omniroute-combos.js';
import { warn, debug } from './logger.js';
import { createDiscoveryHeaders, getDiscoveryCacheKey } from './discovery.js';
/**
 * In-memory model cache keyed by endpoint, API key, headers, and enrichment options
 */
const modelCache = new Map();
/**
 * Generate a cache key for a given configuration
 */
function getCacheKey(config, apiKey) {
    // Include modelsDev config in cache key to prevent stale data
    const modelsDevHash = config.modelsDev
        ? JSON.stringify({
            enabled: config.modelsDev.enabled,
            url: config.modelsDev.url,
            providerAliases: config.modelsDev.providerAliases,
        })
        : '';
    return JSON.stringify([
        getDiscoveryCacheKey(config, apiKey), modelsDevHash, config.hideModelAliases === true,
    ]);
}
/**
 * Normalize an OmniRoute model by reading all field variants
 * with proper precedence: camelCase > snake_case > capabilities
 */
function normalizeModel(model) {
    const capabilities = model.capabilities && typeof model.capabilities === 'object'
        ? model.capabilities
        : {};
    return {
        ...model,
        id: model.id,
        name: model.name || model.id,
        description: model.description || `OmniRoute model: ${model.id}`,
        // Preserve OpenAI-compatible origin metadata for display/filtering
        owned_by: model.owned_by,
        root: model.root,
        parent: model.parent,
        // Context limits: prefer explicit camelCase, fallback to snake_case
        contextWindow: model.contextWindow ?? model.context_length ?? model.max_input_tokens,
        maxTokens: model.maxTokens ?? model.max_output_tokens,
        // Capabilities: prefer explicit camelCase, fallback to capabilities object, fallback to snake_case
        supportsStreaming: model.supportsStreaming,
        supportsVision: model.supportsVision ??
            model.vision ??
            capabilities.vision ??
            capabilities.attachment,
        supportsTools: model.supportsTools ??
            model.tool_calling ??
            capabilities.tool_calling ??
            capabilities.toolcall,
        supportsReasoning: model.supportsReasoning ??
            model.reasoning ??
            capabilities.reasoning ??
            capabilities.thinking,
        supportsAttachment: model.supportsAttachment ??
            model.attachment ??
            capabilities.attachment,
        supportsTemperature: model.supportsTemperature ??
            model.temperature ??
            capabilities.temperature,
        effortTiers: model.effortTiers ?? capabilities.effort_tiers,
    };
}
/**
 * The reasoning-effort tiers that map to a `reasoningEffort` variant value.
 * "none" is deliberately absent — no-thinking is expressed through
 * `chat_template_kwargs` (see `buildReasoningVariants`), not `reasoning_effort`.
 */
const THINKING_EFFORTS = ['low', 'medium', 'high', 'xhigh'];
/**
 * Build the reasoning variants for a model.
 *
 * OmniRoute advertises the real tiers in `capabilities.effort_tiers` (e.g.
 * Qwen3.8 → `low/medium/xhigh`). When present they win over the generic
 * `low/medium/high` fallback, so the picker never shows a tier the model does
 * not support (vLLM/Qwen rejects `high` with 400).
 *
 * A `no-thinking` variant is added only for models that explicitly advertise
 * effort tiers — that is the gateway's signal that the model's thinking is
 * operator-controlled (typically a local OpenAI-compatible model such as
 * vLLM/llama.cpp). Those disable thinking via `chat_template_kwargs.enable_thinking`,
 * which the gateway forwards verbatim, rather than `reasoning_effort: "none"`
 * (which OmniRoute clamps for passthrough providers). Models without advertised
 * tiers keep the generic `low/medium/high` with no `no-thinking`, so the variant
 * is never invented for models that cannot honor it.
 */
export function buildReasoningVariants(model) {
    const advertised = (model.effortTiers ?? []).filter((tier) => typeof tier === 'string' &&
        THINKING_EFFORTS.includes(tier));
    const hasReasoning = model.supportsReasoning === true;
    const variants = {};
    if (advertised.length > 0) {
        for (const tier of advertised) {
            variants[tier] = { reasoningEffort: tier };
        }
        variants['no-thinking'] = { chat_template_kwargs: { enable_thinking: false } };
        return variants;
    }
    if (hasReasoning) {
        variants.low = { reasoningEffort: 'low' };
        variants.medium = { reasoningEffort: 'medium' };
        variants.high = { reasoningEffort: 'high' };
    }
    return variants;
}
/**
 * Deduplicate models by canonical provider+model key.
 * Prefers canonical-prefixed IDs over aliases.
 *
 * NOTE: Only deduplicates known aliases (PROVIDER_ALIAS_TO_CANONICAL).
 * Unknown provider prefixes are kept as-is to preserve user metadata.
 */
function deduplicateModels(models) {
    const seen = new Map();
    for (const model of models) {
        const parts = model.id.split('/');
        if (parts.length !== 2) {
            // Not a provider/model ID, keep as-is
            seen.set(model.id, model);
            continue;
        }
        const [providerPrefix, modelKey] = parts;
        const canonicalPrefix = PROVIDER_ALIAS_TO_CANONICAL[providerPrefix];
        // Only deduplicate known aliases; preserve unknown prefixes as-is
        if (!canonicalPrefix) {
            // Merge metadata if same unknown prefix seen again
            const existing = seen.get(model.id);
            seen.set(model.id, existing ? { ...existing, ...model } : model);
            continue;
        }
        const canonicalId = `${canonicalPrefix}/${modelKey}`;
        const existing = seen.get(canonicalId);
        if (!existing) {
            // First time seeing this model - store with canonical ID
            seen.set(canonicalId, {
                ...model,
                id: canonicalId,
            });
        }
        else {
            // Merge alias metadata into existing, preferring existing (canonical) fields
            seen.set(canonicalId, { ...model, ...existing, id: canonicalId });
        }
    }
    return [...seen.values()];
}
/**
 * Reverse a provider alias to its canonical form for metadata lookups.
 * Returns the original id if no alias mapping exists.
 */
export function resolveProviderAliasForMetadata(modelId) {
    const parts = modelId.split('/');
    if (parts.length !== 2)
        return modelId;
    const [providerPrefix, modelKey] = parts;
    const canonicalPrefix = PROVIDER_ALIAS_TO_CANONICAL[providerPrefix];
    if (!canonicalPrefix)
        return modelId;
    return `${canonicalPrefix}/${modelKey}`;
}
/**
 * Check if a provider prefix is a known alias.
 */
export function isProviderAlias(providerPrefix) {
    return providerPrefix in PROVIDER_ALIAS_TO_CANONICAL;
}
/**
 * Group variant-suffixed models (e.g. gpt-5.5-xhigh) under their base model.
 * Returns a new array where every base model with variants gets a `variants` Record.
 */
export function groupVariantModels(models) {
    const realBaseModels = new Map();
    const variantMap = new Map();
    // Pass 1 — Categorize
    for (const model of models) {
        const { base, stripped } = stripVariantSuffix(model.id);
        if (!stripped) {
            realBaseModels.set(model.id, model);
        }
        else {
            const suffix = model.id.slice(base.length + 1).toLowerCase();
            const entry = variantMap.get(base);
            if (entry) {
                entry.push({ suffix, model });
            }
            else {
                variantMap.set(base, [{ suffix, model }]);
            }
        }
    }
    const result = [];
    // Add all real base models that have no variants (unchanged)
    for (const [id, model] of realBaseModels) {
        if (!variantMap.has(id)) {
            result.push(model);
        }
    }
    // For each base ID that has variants
    for (const [baseId, variants] of variantMap) {
        const baseModel = realBaseModels.get(baseId);
        // Use real base model if available; otherwise create synthetic base from first variant
        const merged = baseModel
            ? { ...baseModel }
            : { ...variants[0].model, id: baseId, name: baseId };
        // Build variants Record
        const variantsRecord = {};
        for (const { suffix } of variants) {
            if (suffix === 'low' ||
                suffix === 'medium' ||
                suffix === 'high' ||
                suffix === 'xhigh') {
                variantsRecord[suffix] = { reasoningEffort: suffix };
            }
        }
        merged.variants = variantsRecord;
        // Merge metadata from all variants into base: use max limits and union capabilities.
        for (const { model } of variants) {
            if (model.contextWindow !== undefined) {
                merged.contextWindow = Math.max(merged.contextWindow ?? 0, model.contextWindow);
            }
            if (model.maxTokens !== undefined) {
                merged.maxTokens = Math.max(merged.maxTokens ?? 0, model.maxTokens);
            }
            if (model.supportsReasoning) {
                merged.supportsReasoning = true;
            }
            if (model.supportsVision) {
                merged.supportsVision = true;
            }
            if (model.supportsTools) {
                merged.supportsTools = true;
            }
            if (model.supportsStreaming) {
                merged.supportsStreaming = true;
            }
            if (model.supportsTemperature) {
                merged.supportsTemperature = true;
            }
            if (model.supportsAttachment) {
                merged.supportsAttachment = true;
            }
        }
        result.push(merged);
    }
    return result;
}
/**
 * Resolve the output-token limit for a model, falling back to
 * `DEFAULT_OUTPUT_LIMIT` when the upstream reports no usable value.
 *
 * Non-positive and non-finite values count as "not reported". The old
 * fallback (4096) starved reasoning models: with `reasoning_effort: high` the
 * thinking budget alone could consume the whole cap, so the reply came back
 * empty with the thinking truncated mid-word. The limit cannot be omitted
 * instead — OpenCode rejects models whose `limit` lacks `output`.
 */
export function resolveOutputLimit(model) {
    const value = model.maxTokens;
    return typeof value === 'number' && Number.isFinite(value) && value > 0
        ? value
        : DEFAULT_OUTPUT_LIMIT;
}
/**
 * Fetch models from OmniRoute /v1/models endpoint
 * This is the CRITICAL FEATURE - dynamically fetches available models
 *
 * @param config - OmniRoute configuration
 * @param apiKey - API key for authentication
 * @returns Array of available models
 */
export async function fetchModels(config, apiKey, forceRefresh = false) {
    const cacheKey = getCacheKey(config, apiKey);
    // Check cache first if not forcing refresh
    if (!forceRefresh) {
        // Validate TTL is positive to prevent unexpected cache behavior
        const cacheTtl = config.modelCacheTtl && config.modelCacheTtl > 0 ? config.modelCacheTtl : MODEL_CACHE_TTL;
        const cached = modelCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < cacheTtl) {
            debug('Using cached models');
            return cached.models;
        }
    }
    else {
        debug('Forcing model refresh');
    }
    // Use default baseUrl if not provided to prevent undefined URL
    const baseUrl = (config.baseUrl || OMNIROUTE_ENDPOINTS.BASE_URL).replace(/\/+$/, '');
    const modelsUrl = `${baseUrl}${OMNIROUTE_ENDPOINTS.MODELS}`;
    debug(`Fetching models from ${modelsUrl}`);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
    try {
        const response = await fetch(modelsUrl, {
            method: 'GET',
            headers: createDiscoveryHeaders(config, apiKey),
            signal: controller.signal,
        });
        if (!response.ok) {
            // Sanitize error - only log status, not response body
            warn(`Failed to fetch models: ${response.status} ${response.statusText}`);
            throw new Error(`Failed to fetch models: ${response.status} ${response.statusText}`);
        }
        // Parse and validate response structure before type casting
        const rawData = await response.json();
        // Runtime validation to ensure API returns expected structure
        if (!rawData || typeof rawData !== 'object' || !Array.isArray(rawData.data)) {
            const dataType = rawData && typeof rawData === 'object'
                ? (rawData.data === null
                    ? 'null'
                    : Array.isArray(rawData.data) ? 'array' : typeof rawData.data)
                : typeof rawData;
            warn(`Invalid models response structure: expected { data: Array }, got { data: ${dataType} }`);
            throw new Error('Invalid models response structure: expected { data: Array }');
        }
        const data = rawData;
        // Transform and validate models - filter out invalid entries
        const rawModels = data.data
            .filter((model) => model !== null && model !== undefined && typeof model.id === 'string')
            .map(normalizeModel);
        const visibleModels = config.hideModelAliases
            ? rawModels.filter((model) => !model.parent)
            : rawModels;
        const dedupedModels = deduplicateModels(visibleModels);
        const groupedModels = groupVariantModels(dedupedModels);
        const models = await enrichModelMetadata(groupedModels, { ...config, apiKey });
        // Update cache
        modelCache.set(cacheKey, {
            models,
            timestamp: Date.now(),
        });
        debug(`Successfully fetched ${models.length} models`);
        return models;
    }
    catch (error) {
        warn(`Error fetching models: ${error}`);
        // Return cached models if available (even if expired)
        const cached = modelCache.get(cacheKey);
        if (cached) {
            debug('Returning expired cached models as fallback');
            return cached.models;
        }
        // Return default models as last resort
        debug('Returning default models as fallback');
        return config.defaultModels || OMNIROUTE_DEFAULT_MODELS;
    }
    finally {
        // Always clear the timeout to prevent memory leaks
        clearTimeout(timeoutId);
    }
}
/**
 * Clear the model cache
 * @param config - Optional OmniRoute configuration to clear specific cache
 * @param apiKey - Optional API key to clear specific cache
 */
export function clearModelCache(config, apiKey) {
    if (config && apiKey) {
        const cacheKey = getCacheKey(config, apiKey);
        modelCache.delete(cacheKey);
        debug('Model cache cleared for provided configuration');
    }
    else {
        modelCache.clear();
        debug('All model caches cleared');
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
export function getCachedModels(config, apiKey) {
    const cacheKey = getCacheKey(config, apiKey);
    return modelCache.get(cacheKey)?.models || null;
}
/**
 * Check if cache is valid
 * @param config - OmniRoute configuration
 * @param apiKey - API key for authentication
 * @returns True if cache is valid
 */
export function isCacheValid(config, apiKey) {
    const cacheKey = getCacheKey(config, apiKey);
    const cached = modelCache.get(cacheKey);
    if (!cached)
        return false;
    const ttl = config.modelCacheTtl || MODEL_CACHE_TTL;
    return Date.now() - cached.timestamp < ttl;
}
/**
 * Force refresh models from API
 * @param config - OmniRoute configuration
 * @param apiKey - API key for authentication
 * @returns Array of available models
 */
export async function refreshModels(config, apiKey) {
    clearModelCache();
    return fetchModels(config, apiKey, true);
}
/**
 * Enrich model metadata with models.dev data and combo capabilities
 */
async function enrichModelMetadata(models, config) {
    const modelsDevIndex = await getModelsDevIndex(config);
    // Apply models.dev metadata enrichment
    const withModelsDev = modelsDevIndex === null
        ? models
        : models.map((model) => applyModelsDevMetadata(model, config, modelsDevIndex));
    // Enrich combo models with lowest common capabilities
    const withComboCapabilities = await enrichComboModels(withModelsDev, config, modelsDevIndex);
    return withComboCapabilities;
}
/**
 * Apply models.dev metadata to a model
 */
function applyModelsDevMetadata(model, config, index) {
    const { providerKey, modelKey } = splitModelId(model.id);
    const providerAlias = resolveProviderAlias(providerKey, config);
    const candidates = getModelLookupCandidates(modelKey);
    const providerCandidates = [
        ...(providerAlias ? [providerAlias] : []),
        ...(providerAlias
            ? [getSubscriptionFallback(providerAlias)].filter((p) => p !== null)
            : []),
    ];
    const best = lookupModelsDevModel(index, providerCandidates, candidates);
    if (!best)
        return model;
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
            ? { supportsStreaming: true }
            : {}),
        ...(model.supportsTemperature === undefined && best.temperature !== undefined
            ? { supportsTemperature: best.temperature }
            : {}),
        ...(model.supportsReasoning === undefined && best.reasoning !== undefined
            ? { supportsReasoning: best.reasoning }
            : {}),
        ...(model.supportsAttachment === undefined && best.attachment !== undefined
            ? { supportsAttachment: best.attachment }
            : {}),
    };
}
function getModelLookupCandidates(modelKey) {
    const candidates = new Set();
    const addCandidate = (key) => {
        const lower = key.toLowerCase();
        const normalized = normalizeModelKey(key);
        const aliasResolved = resolveModelAlias(key);
        candidates.add(lower);
        candidates.add(normalized);
        // Only add alias variants if they differ from original
        if (aliasResolved !== key) {
            candidates.add(aliasResolved.toLowerCase());
            candidates.add(normalizeModelKey(aliasResolved));
        }
    };
    addCandidate(modelKey);
    const { base, stripped } = stripVariantSuffix(modelKey);
    if (stripped) {
        addCandidate(base);
    }
    return [...candidates];
}
function lookupModelsDevModel(index, providerCandidates, modelCandidates) {
    for (const provider of providerCandidates) {
        for (const candidate of modelCandidates) {
            const exact = index.exactByProvider.get(provider)?.get(candidate);
            if (exact)
                return exact;
            const normalized = index.normalizedByProvider
                .get(provider)
                ?.get(normalizeModelKey(candidate));
            if (normalized)
                return normalized;
        }
    }
    for (const candidate of modelCandidates) {
        const exactList = index.exactGlobal.get(candidate);
        if (exactList?.length === 1)
            return exactList[0];
        const normalizedList = index.normalizedGlobal.get(normalizeModelKey(candidate));
        if (normalizedList?.length === 1)
            return normalizedList[0];
    }
    return undefined;
}
//# sourceMappingURL=models.js.map