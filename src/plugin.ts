import type { Plugin, Hooks } from '@opencode-ai/plugin';
import type {
  OmniRouteApiMode,
  OmniRouteConfig,
  OmniRouteModel,
  OmniRouteModelMetadataConfig,
  OmniRouteModelsDevConfig,
  OmniRouteProviderModel,
} from './types.js';
import {
  OMNIROUTE_PROVIDER_ID,
  OMNIROUTE_DEFAULT_MODELS,
  OMNIROUTE_ENDPOINTS,
} from './constants.js';
import { fetchModels } from './models.js';

const OMNIROUTE_PROVIDER_NAME = 'OmniRoute';
const OMNIROUTE_PROVIDER_NPM = '@ai-sdk/openai-compatible';
const OMNIROUTE_PROVIDER_ENV = ['OMNIROUTE_API_KEY'];

type AuthHook = NonNullable<Hooks['auth']>;
type AuthLoader = NonNullable<AuthHook['loader']>;
type AuthAccessor = Parameters<AuthLoader>[0];
type ProviderDefinition = Parameters<AuthLoader>[1];

export const OmniRouteAuthPlugin: Plugin = async (_input) => {
  return {
    config: async (config) => {
      const providers = config.provider ?? {};
      const existingProvider = providers[OMNIROUTE_PROVIDER_ID];
      const baseUrl = getBaseUrl(existingProvider?.options);
      const apiMode = getApiMode(existingProvider?.options);
      const providerApi = resolveProviderApi(existingProvider?.api, apiMode);

      providers[OMNIROUTE_PROVIDER_ID] = {
        ...existingProvider,
        name: existingProvider?.name ?? OMNIROUTE_PROVIDER_NAME,
        api: providerApi,
        npm: existingProvider?.npm ?? OMNIROUTE_PROVIDER_NPM,
        env: existingProvider?.env ?? OMNIROUTE_PROVIDER_ENV,
        options: {
          ...(existingProvider?.options ?? {}),
          baseURL: baseUrl,
          apiMode,
        },
        models:
          existingProvider?.models && Object.keys(existingProvider.models).length > 0
            ? existingProvider.models
            : toProviderModels(OMNIROUTE_DEFAULT_MODELS, baseUrl),
      };

      config.provider = providers;
    },
    auth: createAuthHook(),
  };
};

function createAuthHook(): AuthHook {
  return {
    provider: OMNIROUTE_PROVIDER_ID,
    methods: [
      {
        type: 'api',
        label: 'API Key',
      },
    ],
    loader: loadProviderOptions,
  };
}

async function loadProviderOptions(
  getAuth: AuthAccessor,
  provider: ProviderDefinition,
): Promise<Record<string, unknown>> {
  const auth = await getAuth();
  if (!auth || auth.type !== 'api') {
    throw new Error(
      "No API key available. Please run '/connect omniroute' to set up your OmniRoute connection.",
    );
  }

  const config = createRuntimeConfig(provider, auth.key);

  let models: OmniRouteModel[] = [];
  try {
    const forceRefresh = config.refreshOnList !== false;
    models = await fetchModels(config, config.apiKey, forceRefresh);
    console.log(`[OmniRoute] Available models: ${models.map((model) => model.id).join(', ')}`);
  } catch (error) {
    console.warn('[OmniRoute] Failed to fetch models, using defaults:', error);
    models = OMNIROUTE_DEFAULT_MODELS;
  }

  replaceProviderModels(provider, toProviderModels(models, config.baseUrl));
  if (isRecord(provider.models)) {
    console.log(`[OmniRoute] Provider models hydrated: ${Object.keys(provider.models).length}`);
  }

  return {
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
    fetch: createFetchInterceptor(config),
  };
}

function createRuntimeConfig(provider: ProviderDefinition, apiKey: string): OmniRouteConfig {
  const baseUrl = getBaseUrl(provider.options);
  const modelCacheTtl = getPositiveNumber(provider.options, 'modelCacheTtl');
  const refreshOnList = getBoolean(provider.options, 'refreshOnList');
  const modelsDev = getModelsDevConfig(provider.options);
  const modelMetadata = getModelMetadataConfig(provider.options);

  return {
    baseUrl,
    apiKey,
    apiMode: getApiMode(provider.options),
    modelCacheTtl,
    refreshOnList,
    modelsDev,
    modelMetadata,
  };
}

function resolveProviderApi(api: unknown, apiMode: OmniRouteApiMode): OmniRouteApiMode {
  if (isApiMode(api)) {
    if (api !== apiMode) {
      console.warn(
        `[OmniRoute] provider.api (${api}) and options.apiMode (${apiMode}) differ; using options.apiMode.`,
      );
    }
    return apiMode;
  }

  if (typeof api === 'string') {
    console.warn(`[OmniRoute] Unsupported provider.api value: ${api}. Using ${apiMode}.`);
  }

  return apiMode;
}

function getApiMode(options?: Record<string, unknown>): OmniRouteApiMode {
  const value = options?.apiMode;
  if (value === undefined) {
    return 'chat';
  }

  if (isApiMode(value)) {
    return value;
  }

  console.warn(`[OmniRoute] Unsupported apiMode option: ${String(value)}. Using chat.`);
  return 'chat';
}

function isApiMode(value: unknown): value is OmniRouteApiMode {
  return value === 'chat' || value === 'responses';
}

function getBaseUrl(options?: Record<string, unknown>): string {
  const rawBaseUrl = options?.baseURL;
  if (typeof rawBaseUrl !== 'string') {
    return OMNIROUTE_ENDPOINTS.BASE_URL;
  }

  const trimmed = rawBaseUrl.trim();
  if (trimmed === '') {
    return OMNIROUTE_ENDPOINTS.BASE_URL;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      console.warn(`[OmniRoute] Ignoring unsupported baseURL protocol: ${parsed.protocol}`);
      return OMNIROUTE_ENDPOINTS.BASE_URL;
    }

    return trimmed;
  } catch {
    console.warn(`[OmniRoute] Ignoring invalid baseURL: ${trimmed}`);
    return OMNIROUTE_ENDPOINTS.BASE_URL;
  }
}

function getPositiveNumber(
  options: Record<string, unknown> | undefined,
  key: string,
): number | undefined {
  const value = options?.[key];
  if (typeof value === 'number' && value > 0) {
    return value;
  }
  return undefined;
}

function getBoolean(
  options: Record<string, unknown> | undefined,
  key: string,
): boolean | undefined {
  const value = options?.[key];
  if (typeof value === 'boolean') {
    return value;
  }
  return undefined;
}

function getModelsDevConfig(options: Record<string, unknown> | undefined): OmniRouteModelsDevConfig | undefined {
  const raw = options?.modelsDev;
  if (!isRecord(raw)) return undefined;

  const enabled = typeof raw.enabled === 'boolean' ? raw.enabled : undefined;
  const url = typeof raw.url === 'string' && raw.url.trim() !== '' ? raw.url.trim() : undefined;
  const cacheTtl = getPositiveNumber(raw, 'cacheTtl');
  const timeoutMs = getPositiveNumber(raw, 'timeoutMs');
  const providerAliases = getStringRecord(raw.providerAliases);

  if (
    enabled === undefined &&
    url === undefined &&
    cacheTtl === undefined &&
    timeoutMs === undefined &&
    providerAliases === undefined
  ) {
    return undefined;
  }

  return {
    ...(enabled !== undefined ? { enabled } : {}),
    ...(url !== undefined ? { url } : {}),
    ...(cacheTtl !== undefined ? { cacheTtl } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(providerAliases !== undefined ? { providerAliases } : {}),
  };
}

function getModelMetadataConfig(
  options: Record<string, unknown> | undefined,
): OmniRouteModelMetadataConfig | undefined {
  const raw = options?.modelMetadata;
  if (!raw) return undefined;

  if (Array.isArray(raw)) {
    const filtered = raw.filter(
      (item) =>
        isRecord(item) && (typeof item.match === 'string' || coerceRegExp(item.match) !== null),
    );
    return filtered.length > 0 ? (filtered as unknown as OmniRouteModelMetadataConfig) : undefined;
  }

  if (isRecord(raw)) {
    const hasAny = Object.values(raw).some((value) => isRecord(value));
    return hasAny ? (raw as unknown as OmniRouteModelMetadataConfig) : undefined;
  }

  return undefined;
}

function getStringRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;

  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    out[key] = trimmed;
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

function isRegExp(value: unknown): value is RegExp {
  return Object.prototype.toString.call(value) === '[object RegExp]';
}

function coerceRegExp(value: unknown): RegExp | null {
  if (isRegExp(value)) return value;
  if (!isRecord(value)) return null;

  const source = value.source;
  const flags = value.flags;
  if (typeof source !== 'string' || typeof flags !== 'string') return null;

  try {
    return new RegExp(source, flags);
  } catch {
    return null;
  }
}

function replaceProviderModels(
  provider: ProviderDefinition,
  models: Record<string, OmniRouteProviderModel>,
): void {
  if (isRecord(provider.models)) {
    for (const key of Object.keys(provider.models)) {
      delete provider.models[key];
    }
    Object.assign(provider.models, models);
    return;
  }

  provider.models = models;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toProviderModels(
  models: OmniRouteModel[],
  baseUrl: string,
): Record<string, OmniRouteProviderModel> {
  const entries: Array<[string, OmniRouteProviderModel]> = models.map((model) => [
    model.id,
    toProviderModel(model, baseUrl),
  ]);
  return Object.fromEntries(entries);
}

function toProviderModel(model: OmniRouteModel, baseUrl: string): OmniRouteProviderModel {
  const supportsVision = model.supportsVision === true;
  const supportsTools = model.supportsTools !== false;

  return {
    id: model.id,
    name: model.name || model.id,
    providerID: OMNIROUTE_PROVIDER_ID,
    family: getModelFamily(model.id),
    release_date: '',
    api: {
      id: model.id,
      url: baseUrl,
      npm: OMNIROUTE_PROVIDER_NPM,
    },
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: supportsVision,
      toolcall: supportsTools,
      input: {
        text: true,
        image: supportsVision,
        audio: false,
        video: false,
        pdf: false,
      },
      output: {
        text: true,
        image: false,
        audio: false,
        video: false,
        pdf: false,
      },
      interleaved: false,
    },
    cost: {
      input: model.pricing?.input ?? 0,
      output: model.pricing?.output ?? 0,
      cache: {
        read: 0,
        write: 0,
      },
    },
    limit: {
      context: model.contextWindow ?? 4096,
      output: model.maxTokens ?? 4096,
    },
    options: {},
    headers: {},
    status: 'active',
    variants: {},
  };
}

function getModelFamily(modelId: string): string {
  const [family] = modelId.split('-');
  return family || modelId;
}

/**
 * Create fetch interceptor for OmniRoute API
 *
 * @param config - OmniRoute configuration
 * @returns Fetch interceptor function
 */
function createFetchInterceptor(
  config: OmniRouteConfig,
): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
  const baseUrl = config.baseUrl || 'http://localhost:20128/v1';

  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    // Properly extract URL from RequestInfo (handles Request objects correctly)
    const url = input instanceof Request ? input.url : input.toString();

    // Only intercept requests to the configured OmniRoute base URL
    // Ensure baseUrl ends with a slash for safe prefix matching to prevent domain spoofing
    const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    const isOmniRouteRequest = url === baseUrl || url.startsWith(normalizedBaseUrl);

    if (!isOmniRouteRequest) {
      // Pass through non-OmniRoute requests
      return fetch(input, init);
    }

    console.log(`[OmniRoute] Intercepting request to ${url}`);

    // Merge headers from Request and init to avoid dropping existing headers
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    if (init?.headers) {
      const initHeaders = new Headers(init.headers);
      initHeaders.forEach((value, key) => {
        headers.set(key, value);
      });
    }

    headers.set('Authorization', `Bearer ${config.apiKey}`);
    headers.set('Content-Type', 'application/json');

    const sanitizedBody = await sanitizeGeminiToolSchemas(input, init, url);

    // Clone init to avoid mutating original
    const modifiedInit: RequestInit = {
      ...init,
      headers,
      ...(sanitizedBody !== undefined ? { body: sanitizedBody } : {}),
    };

    // Make the request
    const response = await fetch(input, modifiedInit);

    // Handle model fetching endpoint specially
    if (url.includes('/v1/models') && response.ok) {
      console.log('[OmniRoute] Processing /v1/models response');
    }

    return response;
  };
}

const GEMINI_SCHEMA_KEYS_TO_REMOVE = new Set(['$schema', '$ref', 'ref', 'additionalProperties']);

async function sanitizeGeminiToolSchemas(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  url: string,
): Promise<string | undefined> {
  if (!url.includes('/chat/completions') && !url.includes('/responses')) {
    return undefined;
  }

  const rawBody = await getRawJsonBody(input, init);
  if (!rawBody) {
    return undefined;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return undefined;
  }

  if (!isRecord(payload)) {
    return undefined;
  }

  const model = payload.model;
  if (typeof model !== 'string' || !model.toLowerCase().includes('gemini')) {
    return undefined;
  }

  const tools = payload.tools;
  if (!Array.isArray(tools) || tools.length === 0) {
    return undefined;
  }

  const clonedPayload = structuredClone(payload);
  const changed = sanitizeToolSchemaContainer(clonedPayload);
  if (!changed) {
    return undefined;
  }

  console.log('[OmniRoute] Sanitized Gemini tool schema keywords');
  return JSON.stringify(clonedPayload);
}

async function getRawJsonBody(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
): Promise<string | undefined> {
  if (typeof init?.body === 'string') {
    return init.body;
  }

  if (!(input instanceof Request)) {
    return undefined;
  }

  if (init?.body !== undefined) {
    return undefined;
  }

  const contentType = input.headers.get('content-type');
  if (!contentType || !contentType.toLowerCase().includes('application/json')) {
    return undefined;
  }

  return input.clone().text();
}

function sanitizeToolSchemaContainer(payload: Record<string, unknown>): boolean {
  const tools = payload.tools;
  if (!Array.isArray(tools)) {
    return false;
  }

  let changed = false;
  for (const tool of tools) {
    if (!isRecord(tool)) {
      continue;
    }

    if (isRecord(tool.function) && isRecord(tool.function.parameters)) {
      changed = stripSchemaKeys(tool.function.parameters) || changed;
    }

    if (isRecord(tool.function_declaration) && isRecord(tool.function_declaration.parameters)) {
      changed = stripSchemaKeys(tool.function_declaration.parameters) || changed;
    }

    if (isRecord(tool.input_schema)) {
      changed = stripSchemaKeys(tool.input_schema) || changed;
    }
  }

  return changed;
}

function stripSchemaKeys(schema: Record<string, unknown>): boolean {
  let changed = false;

  for (const key of Object.keys(schema)) {
    if (GEMINI_SCHEMA_KEYS_TO_REMOVE.has(key)) {
      delete schema[key];
      changed = true;
      continue;
    }

    const value = schema[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isRecord(item)) {
          changed = stripSchemaKeys(item) || changed;
        }
      }
      continue;
    }

    if (isRecord(value)) {
      changed = stripSchemaKeys(value) || changed;
    }
  }

  return changed;
}
