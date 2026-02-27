// Type declarations for @opencode-ai/plugin
// This is a stub for development - actual types come from the peer dependency

declare module "@opencode-ai/plugin" {
  export interface PluginResult {
    config?: {
      commands?: Array<{
        name: string;
        description: string;
        action: () => Promise<void> | void;
      }>;
    };
    auth?: AuthProvider;
    tool?: unknown;
  }

  export interface AuthProvider {
    provider: string;
    loader?: (context: {
      getAuth: () => Promise<AuthResult | null>;
      providerConfig?: Record<string, unknown>;
    }) => Promise<LoaderResult>;
    methods: AuthMethod[];
  }

  export interface AuthMethod {
    id: string;
    name: string;
    description: string;
    type: "oauth" | "api";
    prompts?: Prompt[];
    authorize?: (params: { endpoint: string; apiKey: string }) => Promise<AuthorizeResult>;
  }

  export interface Prompt {
    key: string;
    type: "text" | "select";
    label: string;
    message: string;
    placeholder?: string;
    default?: string;
    validate?: (value: string) => true | string;
    condition?: (values: Record<string, unknown>) => boolean;
  }

  export interface AuthResult {
    key?: string;
    config?: {
      endpoint?: string;
      apiKey?: string;
    };
  }

  export interface LoaderResult {
    apiKey: string;
    models?: string[];
    fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  }

  export interface AuthorizeResult {
    type: "success" | "failed";
    key?: string;
    provider?: string;
    config?: Record<string, unknown>;
    error?: string;
  }
}
