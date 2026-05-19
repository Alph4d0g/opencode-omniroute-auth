/**
 * OmniRoute model definition
 */
export interface OmniRouteModel {
  id: string;
  name: string;
  description?: string;

  // OmniRoute native fields (camelCase from API)
  contextWindow?: number;
  maxTokens?: number;
  supportsStreaming?: boolean;
  supportsVision?: boolean;
  supportsTools?: boolean;
  supportsTemperature?: boolean;
  supportsReasoning?: boolean;
  supportsAttachment?: boolean;

  // OmniRoute native fields (snake_case from API)
  context_length?: number;
  max_input_tokens?: number;
  max_output_tokens?: number;
  vision?: boolean;
  tool_calling?: boolean;

  // OmniRoute capabilities object
  capabilities?: {
    vision?: boolean;
    tool_calling?: boolean;
    reasoning?: boolean;
    thinking?: boolean;
    attachment?: boolean;
    temperature?: boolean;
    toolcall?: boolean;
  };

  // Enriched fields from models.dev
  temperature?: boolean;
  reasoning?: boolean;
  attachment?: boolean;
  tool_call?: boolean;

  pricing?: {
    input?: number;
    output?: number;
  };

  variants?: Record<string, OmniRouteModelVariant>;
}

export interface OmniRouteModelMetadata {
  name?: string;
  description?: string;
  contextWindow?: number;
  maxTokens?: number;
  supportsStreaming?: boolean;
  supportsVision?: boolean;
  supportsTools?: boolean;
  supportsTemperature?: boolean;
  supportsReasoning?: boolean;
  supportsAttachment?: boolean;
  pricing?: {
    input?: number;
    output?: number;
  };
}

export interface OmniRouteModelMetadataBlock extends OmniRouteModelMetadata {
  /**
   * Apply this metadata to any model whose id matches.
   * In `opencode.js` this can be a RegExp; in JSON configs, use a string.
   */
  match: string | RegExp;
  /**
   * If `true` and `match` is a string, create the model when it does not exist in `/v1/models`.
   */
  addIfMissing?: boolean;
}

export type OmniRouteModelMetadataConfig =
  | Record<string, OmniRouteModelMetadata>
  | OmniRouteModelMetadataBlock[];

export interface OmniRouteModelsDevConfig {
  /** Enable/disable models.dev enrichment (default: true) */
  enabled?: boolean;
  /** URL to models.dev API payload (default: https://models.dev/api.json) */
  url?: string;
  /** Cache TTL in milliseconds (default: 24 hours) */
  cacheTtl?: number;
  /** Fetch timeout in milliseconds (default: 5000ms) */
  timeoutMs?: number;
  /**
   * Optional alias mapping from OmniRoute provider keys (e.g. `cx`) to models.dev providers (e.g. `openai`).
   * These merge with built-in defaults.
   */
  providerAliases?: Record<string, string>;
}

/**
 * OmniRoute API response for /v1/models
 */
export interface OmniRouteModelsResponse {
  object: 'list';
  data: OmniRouteModel[];
}

export type OmniRouteApiMode = 'chat' | 'responses';

/**
 * OmniRoute configuration
 */
export interface OmniRouteConfig {
  /** OmniRoute API base URL */
  baseUrl: string;
  /** API key for authentication */
  apiKey: string;
  /** API mode for OpenAI-compatible provider routing */
  apiMode: OmniRouteApiMode;
  /** Default models to use if /v1/models fails */
  defaultModels?: OmniRouteModel[];
  /** Model cache TTL in milliseconds (default: 5 minutes) */
  modelCacheTtl?: number;
  /** Whether to refresh models on each model listing (default: true) */
  refreshOnList?: boolean;
  /** Optional models.dev enrichment configuration */
  modelsDev?: OmniRouteModelsDevConfig;
  /** Optional metadata overrides/additions for custom/virtual models */
  modelMetadata?: OmniRouteModelMetadataConfig;
}

export interface OmniRouteProviderModelModalities {
  text: boolean;
  image: boolean;
  audio: boolean;
  video: boolean;
  pdf: boolean;
}

export interface OmniRouteProviderModel {
  id: string;
  name: string;
  providerID: string;
  family: string;
  release_date: string;
  attachment?: boolean;
  reasoning?: boolean;
  temperature?: boolean;
  tool_call?: boolean;
  modalities?: {
    input: readonly string[];
    output: readonly string[];
  };
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
    input: OmniRouteProviderModelModalities;
    output: OmniRouteProviderModelModalities;
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
  variants: Record<string, OmniRouteModelVariant>;
}

/**
 * Model variant configuration
 */
export interface OmniRouteModelVariant {
  reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh';
  [key: string]: unknown;
}

/**
 * API Error response
 */
export interface OmniRouteError {
  error: {
    message: string;
    type: string;
    code?: string;
  };
}
