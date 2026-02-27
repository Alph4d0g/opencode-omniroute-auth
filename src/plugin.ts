import type { PluginResult, AuthProvider, LoaderResult } from "@opencode-ai/plugin";
import type { OmniRouteConfig, OmniRouteModel } from "./types.js";
import { OMNIROUTE_PROVIDER_ID, OMNIROUTE_DEFAULT_MODELS, OMNIROUTE_ENDPOINTS, REQUEST_TIMEOUT } from "./constants.js";
import { fetchModels, clearModelCache } from "./models.js";

/**
 * OmniRoute Authentication Plugin for OpenCode
 *
 * This plugin provides:
 * - API key authentication via /connect command
 * - Dynamic model fetching via /v1/models endpoint
 * - Automatic configuration setup without manual config editing
 */
export function OmniRouteAuthPlugin(): PluginResult {
  return {
    config: {
      commands: [
        {
          name: "omniroute-refresh-models",
          description: "Refresh available models from OmniRoute",
          action: async () => {
            clearModelCache();
            console.log("[OmniRoute] Model cache cleared. Models will be refreshed on next request.");
          },
        },
      ],
    },
    auth: createAuthProvider(),
  };
}

/**
 * Create the OmniRoute authentication provider
 */
function createAuthProvider(): AuthProvider {
  return {
    provider: OMNIROUTE_PROVIDER_ID,
    methods: [
      {
        id: "api-key",
        name: "API Key",
        description: "Connect to OmniRoute using API key",
        type: "api",
        prompts: [
          {
            key: "endpoint",
            type: "text",
            label: "OmniRoute Endpoint",
            message: "Enter your OmniRoute API endpoint:",
            placeholder: "http://localhost:20128/v1",
            default: "http://localhost:20128/v1",
            validate: (value: string) => {
              if (!value || value.trim() === "") {
                return "Endpoint is required";
              }
              try {
                new URL(value);
                return true;
              } catch {
                return "Please enter a valid URL";
              }
            },
          },
          {
            key: "apiKey",
            type: "text",
            label: "API Key",
            message: "Enter your OmniRoute API key:",
            placeholder: "sk-...",
            validate: (value: string) => {
              if (!value || value.trim() === "") {
                return "API key is required";
              }
              return true;
            },
          },
        ],
        authorize: async ({ endpoint, apiKey }: { endpoint: string; apiKey: string }) => {
          console.log("[OmniRoute] Validating connection...");

          // Add timeout to prevent hanging on slow/unresponsive servers
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

          try {
            // Test the connection by fetching models
            const modelsUrl = `${endpoint}${OMNIROUTE_ENDPOINTS.MODELS}`;
            const response = await fetch(modelsUrl, {
              method: "GET",
              headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
              },
              signal: controller.signal,
            });

            if (!response.ok) {
              // Sanitize error response - only log status, not response body to avoid leaking backend details
              console.error(`[OmniRoute] Connection failed: ${response.status} ${response.statusText}`);
              return {
                type: "failed",
                error: `Connection failed: ${response.statusText}. Please check your endpoint and API key.`,
              };
            }

            const data = await response.json();
            const modelCount = data.data?.length || 0;

            console.log(`[OmniRoute] Connection successful! Found ${modelCount} models.`);

            return {
              type: "success",
              key: apiKey,
              provider: OMNIROUTE_PROVIDER_ID,
              // Store the configuration for later use
              config: {
                endpoint,
                apiKey,
              },
            };
          } catch (error) {
            // Handle abort/timeout errors specially
            if (error instanceof Error && error.name === "AbortError") {
              console.error("[OmniRoute] Connection timed out");
              return {
                type: "failed",
                error: "Connection timed out. Please check your endpoint URL and try again.",
              };
            }
            console.error("[OmniRoute] Connection error:", error);
            return {
              type: "failed",
              error: `Connection error: ${error instanceof Error ? error.message : "Unknown error"}. Please check your endpoint URL.`,
            };
          } finally {
            // Always clear timeout to prevent memory leaks
            clearTimeout(timeoutId);
          }
        },
      },
    ],
    loader: async ({ getAuth, providerConfig }: { getAuth: () => Promise<{ key?: string; config?: { endpoint?: string; apiKey?: string } } | null>; providerConfig?: { baseUrl?: string; apiKey?: string; refreshOnList?: boolean } }): Promise<LoaderResult> => {
      const auth = await getAuth();

      if (!auth) {
        throw new Error(
          "No authentication available. Please run '/connect omniroute' to set up your OmniRoute connection."
        );
      }

      // Get configuration from auth or providerConfig
      const apiKey = auth.key || auth.config?.apiKey || providerConfig?.apiKey;
      if (!apiKey) {
        throw new Error(
          "No API key available. Please run '/connect omniroute' to set up your OmniRoute connection."
        );
      }
      
      const config: OmniRouteConfig = {
        baseUrl: auth.config?.endpoint || providerConfig?.baseUrl || OMNIROUTE_ENDPOINTS.BASE_URL,
        apiKey,
        refreshOnList: providerConfig?.refreshOnList as boolean | undefined,
      };

      // Fetch available models (CRITICAL FEATURE)
      let availableModels: string[] = [];
      try {
        // By default, refresh models on each list unless explicitly disabled
        const forceRefresh = config.refreshOnList !== false;
        const models = await fetchModels(config, config.apiKey, forceRefresh);
        availableModels = models.map((m) => m.id);
        console.log(`[OmniRoute] Available models: ${availableModels.join(", ")}`);
      } catch (error) {
        console.warn("[OmniRoute] Failed to fetch models, using defaults:", error);
        availableModels = OMNIROUTE_DEFAULT_MODELS.map((m) => m.id);
      }

      return {
        apiKey: config.apiKey,
        models: availableModels,
        fetch: createFetchInterceptor(config),
      };
    },
  };
}

/**
 * Create fetch interceptor for OmniRoute API
 *
 * @param config - OmniRoute configuration
 * @returns Fetch interceptor function
 */
function createFetchInterceptor(
  config: OmniRouteConfig
): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
  const baseUrl = config.baseUrl || "http://localhost:20128/v1";

  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    // Properly extract URL from RequestInfo (handles Request objects correctly)
    const url = input instanceof Request ? input.url : input.toString();
    
    // Only intercept requests to the configured OmniRoute base URL
    // Ensure baseUrl ends with a slash for safe prefix matching to prevent domain spoofing
    const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
    const isOmniRouteRequest = url === baseUrl || url.startsWith(normalizedBaseUrl);

    if (!isOmniRouteRequest) {
      // Pass through non-OmniRoute requests
      return fetch(input, init);
    }

    console.log(`[OmniRoute] Intercepting request to ${url}`);

    // Use Headers constructor for proper header normalization
    // Handles both plain objects and Headers instances correctly
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${config.apiKey}`);
    headers.set("Content-Type", "application/json");

    // Clone init to avoid mutating original
    const modifiedInit: RequestInit = {
      ...init,
      headers,
    };

    // Make the request
    const response = await fetch(input, modifiedInit);

    // Handle model fetching endpoint specially
    if (url.includes("/v1/models") && response.ok) {
      console.log("[OmniRoute] Processing /v1/models response");
    }

    return response;
  };
}
