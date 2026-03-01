/**
 * OmniRoute model definition
 */
export interface OmniRouteModel {
  id: string;
  name: string;
  description?: string;
  contextWindow?: number;
  maxTokens?: number;
  supportsStreaming?: boolean;
  supportsVision?: boolean;
  supportsTools?: boolean;
  pricing?: {
    input?: number;
    output?: number;
  };
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
  variants: Record<string, unknown>;
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
