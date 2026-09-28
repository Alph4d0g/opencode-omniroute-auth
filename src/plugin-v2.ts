/**
 * OpenCode V2 plugin implementation for OmniRoute.
 *
 * V2 plugins export a definition object `{ id, setup }` instead of an async
 * function (see the V1 -> V2 migration guide). This module implements the V2
 * lifecycle:
 *
 * - resolves the API key from the `omniroute` integration credential, the
 *   legacy `auth.json` store, or `OMNIROUTE_API_KEY`;
 * - registers the `omniroute` integration (display name + API key method for
 *   `/connect`);
 * - registers the `omniroute` provider with the matching V2 driver package
 *   (openai-compatible for chat mode, openai for responses mode) and passes
 *   `baseURL` + `apiKey` through provider `settings`;
 * - publishes the model list fetched from OmniRoute (same enrichment and
 *   metadata overrides as V1) and refreshes it on an interval;
 * - reuses the shared HTTP sanitization for request payloads and cached
 *   chat-usage normalization.
 *
 * All `@opencode/plugin` imports are type-only and erased at compile time, so
 * the built plugin has no runtime dependency on the SDK: the V2 host resolves
 * providers, credentials, and models from its own registry.
 */
import type { Model, Plugin, Provider } from '@opencode/plugin';
import {
  DEFAULT_CONTEXT_LIMIT,
  DEFAULT_OUTPUT_LIMIT,
  MODEL_CACHE_TTL,
  OMNIROUTE_CHAT_PROVIDER_PACKAGE,
  OMNIROUTE_DEFAULT_MODELS,
  OMNIROUTE_PLUGIN_ID,
  OMNIROUTE_PROVIDER_ID,
  OMNIROUTE_RESPONSES_PROVIDER_PACKAGE,
} from './constants.js';
import type { OmniRouteConfig, OmniRouteModel } from './types.js';
import { fetchModels } from './models.js';
import { debug, warn } from './logger.js';
import { sanitizeForLog } from './omniroute-combos.js';
import {
  applyModelMetadataOverrides,
  createRuntimeConfig,
  formatModelDisplayName,
  getModelFamily,
  readAuthFromStore,
} from './plugin.js';
import { isRecord, normalizeChatUsageResponse, sanitizeChatPayload } from './http-sanitize.js';

type Context = Plugin.Context;

const OMNIROUTE_PROVIDER_NAME = 'OmniRoute';

/** Branded IDs from the provider schema, derived instead of re-imported. */
type ProviderID = Provider.Info['id'];
type IntegrationID = NonNullable<Provider.Info['integrationID']>;

/**
 * Structural representation of a V2 `Model.Info` entry. The host validates
 * against its runtime schema; this shape mirrors the V2 default factory
 * (`Model.Info.default`) field for field.
 */
export interface V2ModelVariant {
  id: string;
  settings?: Record<string, unknown>;
}

export interface V2ModelCost {
  input: number;
  output: number;
  cache: {
    read: number;
    write: number;
  };
}

export interface V2ModelInfo {
  id: string;
  modelID: string;
  providerID: string;
  name: string;
  family?: string;
  capabilities: {
    tools: boolean;
    input: string[];
    output: string[];
  };
  variants: V2ModelVariant[];
  time: {
    released: number;
  };
  cost: V2ModelCost[];
  status: 'active';
  enabled: boolean;
  limit: {
    context: number;
    output: number;
  };
}

/**
 * Convert an OmniRoute model to a V2 model definition.
 *
 * Mirrors the V1 `toProviderModel` mapping: same display-name formatting,
 * family, capability defaults (tools assumed unless explicitly disabled),
 * cost (USD per 1M tokens) and limits.
 */
export function toV2Model(model: OmniRouteModel, config: OmniRouteConfig): V2ModelInfo {
  const supportsVision = model.supportsVision === true;
  // Default to true: if the API does not explicitly disable tools, assume the
  // capability exists (matches the V1 behavior for OpenAI-compatible models).
  const supportsTools = model.supportsTools !== false;
  const supportsReasoning = model.supportsReasoning === true;

  // V1 variant records (`{ low: { reasoningEffort: 'low' }, ... }`) become
  // V2 variant arrays (`[{ id: 'low', settings: { reasoningEffort: 'low' } }]`).
  // `reasoningEffort` is a semantic key the V2 core maps to `reasoning_effort`
  // in the request body for supporting providers.
  const variantSource =
    model.variants && Object.keys(model.variants).length > 0
      ? model.variants
      : supportsReasoning
        ? {
            low: { reasoningEffort: 'low' },
            medium: { reasoningEffort: 'medium' },
            high: { reasoningEffort: 'high' },
          }
        : {};

  const variants: V2ModelVariant[] = Object.entries(variantSource).map(([id, variant]) => ({
    id,
    settings: isRecord(variant) && Object.keys(variant).length > 0 ? { ...variant } : undefined,
  }));

  return {
    id: model.id,
    modelID: model.id,
    providerID: OMNIROUTE_PROVIDER_ID,
    name: formatModelDisplayName(model.id, model.name || model.id, config.modelNameDisplay),
    family: getModelFamily(model.id),
    capabilities: {
      tools: supportsTools,
      input: supportsVision ? ['text', 'image'] : ['text'],
      output: ['text'],
    },
    variants,
    time: { released: 0 },
    cost: [
      {
        input: model.pricing?.input ?? 0,
        output: model.pricing?.output ?? 0,
        cache: { read: 0, write: 0 },
      },
    ],
    status: 'active',
    enabled: true,
    limit: {
      context: model.contextWindow ?? DEFAULT_CONTEXT_LIMIT,
      output: model.maxTokens ?? DEFAULT_OUTPUT_LIMIT,
    },
  };
}

export function toV2Models(models: OmniRouteModel[], config: OmniRouteConfig): V2ModelInfo[] {
  return models.map((model) => toV2Model(model, config));
}

/**
 * Resolve the OmniRoute API key.
 *
 * Order: active `omniroute` integration credential (set via `/connect` or
 * imported from the legacy `auth.json` by the V2 migration) -> legacy
 * `auth.json` store -> `OMNIROUTE_API_KEY` environment variable.
 */
async function resolveApiKey(ctx: Context): Promise<string | undefined> {
  try {
    const connection = await ctx.integration.connection.active(OMNIROUTE_PROVIDER_ID);
    if (connection) {
      const credential = await ctx.integration.connection.resolve(connection);
      if (credential && credential.type === 'key' && typeof credential.key === 'string' && credential.key) {
        return credential.key;
      }
    }
  } catch (error) {
    debug(`V2 integration credential resolution failed: ${sanitizeForLog(String(error))}`);
  }

  const stored = await readAuthFromStore(OMNIROUTE_PROVIDER_ID);
  if (stored?.key) {
    return stored.key;
  }

  const envKey = process.env.OMNIROUTE_API_KEY;
  return envKey && envKey.length > 0 ? envKey : undefined;
}

function buildProviderInfo(
  packageID: string,
  baseUrl: string,
  apiKey: string | undefined,
): Provider.Info {
  const settings: Record<string, unknown> = { baseURL: baseUrl };
  if (apiKey) {
    settings.apiKey = apiKey;
  }

  return {
    id: OMNIROUTE_PROVIDER_ID as unknown as ProviderID,
    name: OMNIROUTE_PROVIDER_NAME,
    activation: 'enabled',
    package: packageID,
    integrationID: OMNIROUTE_PROVIDER_ID as unknown as IntegrationID,
    settings,
  };
}

/**
 * V2 plugin setup. The returned cleanup function disposes the model refresh
 * timer and the session http hooks.
 */
export async function setup(ctx: Context): Promise<() => Promise<void>> {
  const options = isRecord(ctx.options) ? { ...ctx.options } : {};

  // Options come from the `plugins` config entry, not the provider config.
  // The plugin owns the provider: it registers driver, settings, and models.
  const config = createRuntimeConfig(options, '');

  const state: { apiKey: string | undefined; models: V2ModelInfo[] } = {
    apiKey: await resolveApiKey(ctx),
    models: toV2Models(OMNIROUTE_DEFAULT_MODELS, config),
  };

  // 1. Integration: display name + key auth method so `/connect omniroute`
  //    offers an API key form and the credential store is addressable.
  try {
    await ctx.integration.transform((editor) => {
      editor.method.update({
        integrationID: OMNIROUTE_PROVIDER_ID,
        method: { type: 'key', label: 'API Key' },
      });
      const existing = editor.get(OMNIROUTE_PROVIDER_ID);
      if (existing && existing.name !== OMNIROUTE_PROVIDER_NAME) {
        editor.update(OMNIROUTE_PROVIDER_ID, (integration) => {
          integration.name = OMNIROUTE_PROVIDER_NAME;
        });
      }
    });
  } catch (error) {
    warn(`OmniRoute V2: failed to register integration: ${sanitizeForLog(String(error))}`);
  }

  // 2. Provider registration. The transform must be synchronous and
  //    replayable: it reads the current state from the closure, so the
  //    refreshed model list and key are picked up by `ctx.provider.reload()`.
  const providerPackage =
    config.apiMode === 'responses'
      ? OMNIROUTE_RESPONSES_PROVIDER_PACKAGE
      : OMNIROUTE_CHAT_PROVIDER_PACKAGE;

  await ctx.provider.transform((editor) => {
    const existing = editor.get(OMNIROUTE_PROVIDER_ID);
    if (existing) {
      // Config may define a base provider (possibly without a driver package,
      // e.g. the legacy `provider.omniroute` entry); fill in everything the
      // plugin owns.
      editor.update(OMNIROUTE_PROVIDER_ID, (provider) => {
        provider.name = OMNIROUTE_PROVIDER_NAME;
        provider.activation = 'enabled';
        provider.package = providerPackage;
        provider.integrationID = OMNIROUTE_PROVIDER_ID as unknown as IntegrationID;
        const settings: Record<string, unknown> = { baseURL: config.baseUrl };
        if (state.apiKey) {
          settings.apiKey = state.apiKey;
        }
        provider.settings = settings;
      });
      editor.models.set(OMNIROUTE_PROVIDER_ID, state.models as unknown as Model.Info[]);
    } else {
      editor.add({
        info: buildProviderInfo(providerPackage, config.baseUrl, state.apiKey),
        models: state.models as unknown as Model.Info[],
      });
    }
  });

  // 3. Model fetching: initial pass + periodic refresh. When the key or the
  //    model list changes, replay the provider transform via reload().
  let disposed = false;

  const refreshModels = async (): Promise<void> => {
    if (disposed) {
      return;
    }

    const key = await resolveApiKey(ctx);
    if (key && key !== state.apiKey) {
      state.apiKey = key;
    }
    if (!state.apiKey) {
      return;
    }

    // Keep the shared config in sync on every pass: fetchModels receives the
    // key as a parameter, but combo enrichment (enrichComboModels ->
    // fetchComboData) reads config.apiKey.
    config.apiKey = state.apiKey;

    try {
      const fetched = await fetchModels(config, state.apiKey, config.refreshOnList !== false);
      const effective = applyModelMetadataOverrides(fetched, options.modelMetadata);
      const models = toV2Models(effective, config);
      if (models.length === 0) {
        warn('OmniRoute V2: model list is empty; keeping previous models');
        return;
      }
      state.models = models;
      await ctx.provider.reload();
      debug(`OmniRoute V2: published ${models.length} models`);
    } catch (error) {
      warn(`OmniRoute V2: model refresh failed: ${sanitizeForLog(String(error))}`);
    }
  };

  void refreshModels();

  const ttl =
    typeof config.modelCacheTtl === 'number' && Number.isFinite(config.modelCacheTtl) && config.modelCacheTtl > 0
      ? config.modelCacheTtl
      : MODEL_CACHE_TTL;
  const timer = setInterval(() => {
    void refreshModels();
  }, ttl);
  if (typeof timer !== 'number') {
    timer.unref?.();
  }

  // 4. Session http hooks, scoped to the omniroute provider.
  const requestRegistration = await ctx.session.hook(
    'http.request',
    async (event) => {
      try {
        const request = event.request;

        // Fallback auth: the provider settings carry the key, but if the
        // driver did not attach it (e.g. key arrived after provider load),
        // make sure the request is authorized.
        if (!request.headers.get('authorization') && state.apiKey) {
          request.headers.set('authorization', `Bearer ${state.apiKey}`);
        }

        const url = request.url;
        if (!url.includes('/chat/completions') && !url.includes('/responses')) {
          return;
        }

        const contentType = request.headers.get('content-type')?.toLowerCase() ?? '';
        if (!contentType.includes('application/json')) {
          return;
        }

        const rawBody = await request.clone().text();
        const sanitizedBody = sanitizeChatPayload(rawBody, url);
        if (sanitizedBody === undefined) {
          return;
        }

        const headers = new Headers(request.headers);
        headers.set('content-type', 'application/json');
        event.request = new Request(request, { headers, body: sanitizedBody });
        debug(`OmniRoute V2: sanitized request payload for ${sanitizeForLog(url)}`);
      } catch (error) {
        warn(`OmniRoute V2: http.request hook failed: ${sanitizeForLog(String(error))}`);
      }
    },
    { providerID: OMNIROUTE_PROVIDER_ID },
  );

  const responseRegistration = await ctx.session.hook(
    'http.response',
    async (event) => {
      try {
        const url = event.request.url;
        if (!url.includes('/chat/completions')) {
          return;
        }
        event.response = await normalizeChatUsageResponse(url, event.response);
      } catch (error) {
        warn(`OmniRoute V2: http.response hook failed: ${sanitizeForLog(String(error))}`);
      }
    },
    { providerID: OMNIROUTE_PROVIDER_ID },
  );

  return async () => {
    disposed = true;
    clearInterval(timer);
    await Promise.allSettled([requestRegistration.dispose(), responseRegistration.dispose()]);
  };
}

export const v2Definition = {
  id: OMNIROUTE_PLUGIN_ID,
  setup,
};
