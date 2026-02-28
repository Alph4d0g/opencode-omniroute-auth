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

  export interface Hooks {
    config?: (input: Config) => Promise<void>;
    auth?: AuthHook;
    [key: string]: unknown;
  }

  export type Plugin = (input: PluginInput) => Promise<Hooks>;
}
