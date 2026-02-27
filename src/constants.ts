/**
 * OmniRoute provider ID
 */
export const OMNIROUTE_PROVIDER_ID = "omniroute";

/**
 * Default OmniRoute API endpoints
 */
export const OMNIROUTE_ENDPOINTS = {
  /** Base URL for OmniRoute API */
  BASE_URL: "http://localhost:20128/v1",
  /** Models endpoint */
  MODELS: "/models",
  /** Chat completions endpoint */
  CHAT_COMPLETIONS: "/chat/completions",
};

/**
 * Default models to use as fallback when /v1/models fails
 */
export const OMNIROUTE_DEFAULT_MODELS = [
  {
    id: "gpt-4o",
    name: "GPT-4o",
    description: "GPT-4o model with full capabilities",
    contextWindow: 128000,
    maxTokens: 4096,
    supportsStreaming: true,
    supportsVision: true,
    supportsTools: true,
  },
  {
    id: "gpt-4o-mini",
    name: "GPT-4o Mini",
    description: "Fast and cost-effective model for everyday tasks",
    contextWindow: 128000,
    maxTokens: 4096,
    supportsStreaming: true,
    supportsVision: true,
    supportsTools: true,
  },
  {
    id: "claude-3-5-sonnet",
    name: "Claude 3.5 Sonnet",
    description: "Anthropic's Claude 3.5 Sonnet",
    contextWindow: 200000,
    maxTokens: 8192,
    supportsStreaming: true,
    supportsVision: true,
    supportsTools: true,
  },
  {
    id: "llama-3-1-405b",
    name: "Llama 3.1 405B",
    description: "Meta's Llama 3.1 405B",
    contextWindow: 128000,
    maxTokens: 4096,
    supportsStreaming: true,
    supportsVision: false,
    supportsTools: true,
  },
];

/**
 * Model cache TTL in milliseconds (5 minutes)
 */
export const MODEL_CACHE_TTL = 5 * 60 * 1000;

/**
 * Request timeout in milliseconds (30 seconds)
 */
export const REQUEST_TIMEOUT = 30000;
