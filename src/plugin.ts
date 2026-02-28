import type { Plugin, Hooks } from '@opencode-ai/plugin';
import type { OmniRouteConfig, OmniRouteModel } from './types.js';
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

type ProviderModelModalities = {
  text: boolean;
  image: boolean;
  audio: boolean;
  video: boolean;
  pdf: boolean;
};

type ProviderModel = {
  id: string;
  name: string;
  providerID: string;
  family: string;
  release_date: string;
  api: {
    id: string;
    url: string;
    npm: string;
  };
  capabilities: {
    temperature: boolean;
    reasoning: boolean;
    attachment: boolean;
    toolcall: boolean;
    input: ProviderModelModalities;
    output: ProviderModelModalities;
    interleaved: boolean;
  };
  cost: {
    input: number;
    output: number;
    cache: {
      read: number;
      write: number;
    };
  };
  limit: {
    context: number;
    output: number;
  };
  options: Record<string, unknown>;
  headers: Record<string, string>;
  status: 'active';
  variants: Record<string, unknown>;
};

export const OmniRouteAuthPlugin: Plugin = async (_input) => {
  return {
    config: async (config) => {
      const providers = config.provider ?? {};
      const existingProvider = providers[OMNIROUTE_PROVIDER_ID];
      const baseUrl = getBaseUrl(existingProvider?.options);

      providers[OMNIROUTE_PROVIDER_ID] = {
        ...existingProvider,
        name: existingProvider?.name ?? OMNIROUTE_PROVIDER_NAME,
        api: existingProvider?.api ?? 'chat',
        npm: existingProvider?.npm ?? OMNIROUTE_PROVIDER_NPM,
        env: existingProvider?.env ?? OMNIROUTE_PROVIDER_ENV,
        options: {
          ...(existingProvider?.options ?? {}),
          baseURL: baseUrl,
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
  if (auth.type !== 'api') {
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

  return {
    baseUrl,
    apiKey,
    modelCacheTtl,
    refreshOnList,
  };
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

  return trimmed;
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

function replaceProviderModels(
  provider: ProviderDefinition,
  models: Record<string, ProviderModel>,
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

function toProviderModels(models: OmniRouteModel[], baseUrl: string): Record<string, ProviderModel> {
  const entries: Array<[string, ProviderModel]> = models.map((model) => [
    model.id,
    toProviderModel(model, baseUrl),
  ]);
  return Object.fromEntries(entries);
}

function toProviderModel(model: OmniRouteModel, baseUrl: string): ProviderModel {
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
  const parts = modelId.split('-');
  if (parts.length >= 2) {
    return `${parts[0]}-${parts[1]}`;
  }
  return parts[0] || modelId;
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

    // Use Headers constructor for proper header normalization
    // Handles both plain objects and Headers instances correctly
    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${config.apiKey}`);
    headers.set('Content-Type', 'application/json');

    // Clone init to avoid mutating original
    const modifiedInit: RequestInit = {
      ...init,
      headers,
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
