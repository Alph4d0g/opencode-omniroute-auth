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
  object: "list";
  data: OmniRouteModel[];
}

/**
 * OmniRoute configuration
 */
export interface OmniRouteConfig {
  /** OmniRoute API base URL */
  baseUrl: string;
  /** API key for authentication */
  apiKey: string;
  /** Default models to use if /v1/models fails */
  defaultModels?: OmniRouteModel[];
  /** Model cache TTL in milliseconds (default: 5 minutes) */
  modelCacheTtl?: number;
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
