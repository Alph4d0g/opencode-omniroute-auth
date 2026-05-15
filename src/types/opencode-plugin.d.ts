declare module '@opencode-ai/plugin' {
  export interface PluginInput {
    client: unknown;
    project: unknown;
    directory: string;
    worktree: string;
    serverUrl: string;
    $: unknown;
  }

  export interface Provider {
    id?: string;
    name?: string;
    api?: string;
    npm?: string;
    env?: string[];
    options?: Record<string, unknown>;
    models?: Record<string, unknown>;
    [key: string]: unknown;
  }

  export interface Config {
    provider?: Record<string, Provider>;
    plugin?: string[];
    [key: string]: unknown;
  }

  export type AuthApi = {
    type: 'api';
    key: string;
  };

  export type AuthOauth = {
    type: 'oauth';
    refresh: string;
    access: string;
    expires: number;
    accountId?: string;
    enterpriseUrl?: string;
  };

  export type AuthWellKnown = {
    type: 'wellknown';
    key: string;
    token: string;
  };

  export type Auth = AuthApi | AuthOauth | AuthWellKnown;

  export type ApiAuthorizeResult =
    | {
        type: 'success';
        key: string;
        provider?: string;
      }
    | {
        type: 'failed';
      };

  export interface ApiMethod {
    type: 'api';
    label: string;
    prompts?: Prompt[];
    authorize?: (inputs?: Record<string, string>) => Promise<ApiAuthorizeResult>;
  }

  export interface OAuthMethod {
    type: 'oauth';
    label: string;
    auth: (provider: Provider, state: string) => Promise<string>;
    callback: (input: {
      code: string;
      provider: Provider;
      server: string;
      codeVerifier: string;
    }) => Promise<AuthOauth>;
  }

  export type AuthMethod = ApiMethod | OAuthMethod;

  export type Prompt = {
    type: 'text';
    key: string;
    message: string;
    placeholder?: string;
    validate?: (value: string) => string | undefined;
    condition?: (value: Record<string, string>) => boolean;
  };

  export interface AuthHook {
    provider: string;
    loader?: (auth: () => Promise<Auth>, provider: Provider) => Promise<Record<string, unknown>>;
    methods: AuthMethod[];
  }

  // ProviderHook types (OpenCode >=1.14.49)
  export interface ProviderHookContext {
    auth?: Auth;
  }

  export interface ModelV2 {
    id: string;
    providerID: string;
    family: string;
    release_date: string;
    api: { id: string; url: string; npm: string };
    name: string;
    capabilities: {
      temperature: boolean;
      reasoning: boolean;
      attachment: boolean;
      toolcall: boolean;
      input: { text: boolean; audio: boolean; image: boolean; video: boolean; pdf: boolean };
      output: { text: boolean; audio: boolean; image: boolean; video: boolean; pdf: boolean };
      interleaved: boolean;
    };
    cost: { input: number; output: number; cache: { read: number; write: number } };
    limit: { context: number; output: number };
    status: 'active';
    options: Record<string, unknown>;
    headers: Record<string, string>;
    variants: Record<string, unknown>;
  }

  export interface ProviderV2 {
    id: string;
    name: string;
    source: string;
    env: string[];
    key?: string;
    options: Record<string, unknown>;
    models: Record<string, ModelV2>;
  }

  export interface ProviderHook {
    id: string;
    models?: (
      provider: ProviderV2,
      ctx: ProviderHookContext,
    ) => Promise<Record<string, ModelV2>>;
  }

  export interface Hooks {
    config?: (input: Config) => Promise<void>;
    auth?: AuthHook;
    provider?: ProviderHook;
    [key: string]: unknown;
  }

  export type Plugin = (input: PluginInput) => Promise<Hooks>;
}
