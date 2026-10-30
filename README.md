# OpenCode OmniRoute Auth Plugin

[![npm](https://img.shields.io/npm/v/@lazygatto/opencode-omniroute-auth.svg)](https://www.npmjs.com/package/@lazygatto/opencode-omniroute-auth)

🔌 Authentication plugin for [OpenCode](https://opencode.ai) to connect to an [OmniRoute](https://omniroute.ai) API instance.

This is a fork of [Alph4d0g/opencode-omniroute-auth](https://github.com/Alph4d0g/opencode-omniroute-auth) (base: `v1.2.3`), extended with **OpenCode V2** support. Install it from npm as `@lazygatto/opencode-omniroute-auth`, or straight from this repo — the upstream npm package (`opencode-omniroute-auth@1.x`) only works on V1.

## Compatibility

| Host | Version | Entrypoint used |
|------|---------|-----------------|
| OpenCode V2 | ≥ 2.0.0 | `setup(ctx)` on the default-exported definition object |
| OpenCode V1 | ≥ 1.18.29 | `server(ctx)` on the same object |

One installation works on both hosts — the package default-exports a single definition object that carries both lifecycles. Older V1 releases (< 1.18.29) expect a plain function default export; use upstream `opencode-omniroute-auth@1.x` there.

The plugin has **no runtime dependency on the OpenCode SDK**: all SDK imports are type-only and erased at build time. The SDK packages are optional peer dependencies, used only for type-checking during development.

## Features

- ✅ **Simple `/connect` Command** - No manual key management needed
- ✅ **API Key Authentication** - Simple and secure API key-based auth
- ✅ **Dynamic Model Fetching** - Automatically fetches available models from `/v1/models`
- ✅ **Provider Auto-Registration** - Registers an `omniroute` provider (driver package, settings, models)
- ✅ **Model Caching** - Intelligent caching with TTL for better performance
- ✅ **Fallback Models** - Default models when the API is unavailable
- ✅ **Model Metadata Normalization** - Reads all OmniRoute field variants (camelCase, snake_case, capabilities object) with proper precedence
- ✅ **Provider Alias Deduplication** - Automatically deduplicates alias/canonical model entries (e.g. `cx/gpt-5.5` → `codex/gpt-5.5`)
- ✅ **Combo Model Capability Enrichment** - Automatically calculates lowest common capabilities for OmniRoute combo models
- ✅ **models.dev Enrichment** - Enriches model metadata from models.dev with provider alias resolution
- ✅ **Subscription Provider Fallback** - Falls back to public providers for subscription-based models
- ✅ **Model Variant Support** - Automatically strips reasoning-effort suffixes (e.g. `gpt-5.5-xhigh` → `gpt-5.5`) for lookup
- ✅ **Reasoning Effort Tiers** - Builds variants from OmniRoute's `capabilities.effort_tiers` (e.g. Qwen3.8 → `low/medium/xhigh`) and adds a `no-thinking` variant (`chat_template_kwargs.enable_thinking=false`) for models that advertise tiers
- ✅ **Secure Logging** - Sanitized log output with async file I/O to prevent event loop blocking

## Installation

The same release is available two ways — **use the package name that matches the route you installed from** in your config.

### From npm (recommended)

```bash
npm install @lazygatto/opencode-omniroute-auth
```

Published as an **unofficial** fork under the `@lazygatto` scope. Use `"package": "@lazygatto/opencode-omniroute-auth"` in your config.

### From GitHub (git spec)

```bash
# npm
npm install github:LazyGatto/opencode-omniroute-auth

# pnpm
pnpm add github:LazyGatto/opencode-omniroute-auth

# yarn
yarn add github:LazyGatto/opencode-omniroute-auth

# bun
bun add github:LazyGatto/opencode-omniroute-auth
```

This route keeps the upstream package name, so use `"package": "opencode-omniroute-auth"` in your config — all examples below use that name; substitute the scoped one if you installed from npm.

This installs the latest commit of `main`. To pin a release, add a ref:

```bash
npm install github:LazyGatto/opencode-omniroute-auth#v2.1.2
```

**Where to install.** OpenCode resolves plugin packages by walking up the directory tree from the config it loads, looking in `node_modules`. Run the install command in:

- your **project root** — for a project-level config (`opencode.json` or `.opencode/` in the project), or
- your **home directory** — for a global config (`~/.config/opencode/opencode.json`); the package lands in `~/node_modules`, which is visible when OpenCode walks up from `~/.config/opencode`.

The git route lands in `node_modules/opencode-omniroute-auth` (the upstream package name), so it replaces any previously installed upstream copy in that `node_modules`. The npm route lands in `node_modules/@lazygatto/opencode-omniroute-auth` and can sit alongside it.

`dist/` is committed to the repository, so **no build script runs during install**. That also sidesteps pnpm 10+ `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED` for git-hosted packages (no `prepare` script, no allowlist needed).

### From npm (upstream, V1 only)

```bash
npm install opencode-omniroute-auth   # v1.2.x — OpenCode V1 hosts only
```

## Quick start

### OpenCode V2 (≥ 2.0.0)

1. Install the package (above).
2. Register the plugin in `opencode.json` (the V1 `plugin` array is replaced by `plugins`, and entries become objects):

   ```jsonc
   {
     "plugins": [
       {
         "package": "opencode-omniroute-auth",
         "options": {
           "baseURL": "http://localhost:20128/v1"   // or "{env:OMNIROUTE_BASE_URL}"
         }
       }
     ]
   }
   ```

3. Provide an API key — any one of:
   - `/connect omniroute` in the TUI (stored in the V2 credential store),
   - a legacy `~/.local/share/opencode/auth.json` entry `omniroute.key` (V2 auto-imports it),
   - the `OMNIROUTE_API_KEY` environment variable.
4. Restart OpenCode (or the background service). The plugin registers the `omniroute` provider, fetches `/v1/models`, and the models appear in the picker.

The `provider.omniroute` config entry is **optional** in V2 — keep or drop it; the plugin fills in the driver package, `baseURL`/`apiKey` settings, and the model list either way.

### OpenCode V1 (≥ 1.18.29)

```jsonc
{
  "plugin": ["opencode-omniroute-auth"],
  "provider": {
    "omniroute": {
      "options": { "baseURL": "http://localhost:20128/v1" }
    }
  }
}
```

Then run `/connect omniroute` to store your key in `~/.local/share/opencode/auth.json`, or set `OMNIROUTE_API_KEY`.

## How it works (V2)

- `setup(ctx)` registers the `omniroute` **integration** (enables `/connect omniroute`) and the `omniroute` **provider**, resolves the API key, and fetches the model list.
- Driver packages are resolved by the V2 host — they are not bundled here:
  - `apiMode: "chat"` (default) → `@opencode/ai/providers/openai-compatible`
  - `apiMode: "responses"` → `@opencode/ai/providers/openai`
- `Provider.Info.settings` receives `{ baseURL, apiKey }` directly into the driver.
- `baseURL` supports `{env:VAR}` templates; an unresolved template is substituted from `process.env` as a last resort.
- The model list is refreshed on an interval and (optionally) every time the model list is opened.

**Key resolution order:**

1. Active `omniroute` integration credential (from `/connect omniroute`)
2. Legacy `~/.local/share/opencode/auth.json` → `omniroute.key`
3. `OMNIROUTE_API_KEY`
4. As a last resort, an idempotent `Authorization: Bearer <key>` backfill in the `http.request` hook

## Verifying the installation

1. **Plugin loaded** — no `Plugin must export a default definition` / `failed to load plugin` errors in `~/.local/share/opencode/log/opencode.log`; `opencode api get /api/plugin` lists `opencode-omniroute-auth`.
2. **Provider active** — `opencode api get /api/provider` shows `omniroute` with a driver package, `settings.baseURL`, a non-empty `settings.apiKey`, and the fetched model list.
3. **No combo 401s** — no `Failed to fetch combo data: 401` entries after startup.
4. **End-to-end** — send a short prompt through any `omniroute/*` model (e.g. `omniroute/auto/best-fast`).

## Configuration (Optional)

The plugin works out-of-the-box with just a base URL and a key. All options live in the **plugin entry's `options`** (V2) or **`provider.omniroute.options`** (V1):

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `baseURL` | string | `http://localhost:20128/v1` | OmniRoute API base URL. Supports `{env:VAR}` templates. |
| `apiMode` | `'chat' \| 'responses'` | `chat` | Provider API mode. Falls back to `chat` on unsupported values. |
| `modelCacheTtl` | number | `300000` | Model cache TTL in milliseconds. |
| `refreshOnList` | boolean | `true` | Refresh models when the model list is opened. |
| `modelsDev` | object | enabled | models.dev enrichment settings (see below). |
| `modelMetadata` | object \| array | — | Override/add metadata for custom/virtual models (RegExp matchers work in `opencode.js`). |
| `modelNameDisplay` | `'name' \| 'id' \| 'prefixed'` | `name` | Use model `name` (default), `id`, or provider-prefixed name in the model picker. |
| `hideModelAliases` | boolean | `false` | Hide alias models that have a `parent` field in `/v1/models`. |
| `headers` | `Record<string, string>` | — | Extra HTTP headers sent with every request to `baseURL`, in addition to `Authorization` and `Content-Type`. Useful for a reverse proxy/gateway in front of OmniRoute that needs its own credentials, e.g. Cloudflare Access service tokens. |

Full V2 example:

```jsonc
{
  "plugins": [
    {
      "package": "opencode-omniroute-auth",
      "options": {
        "baseURL": "{env:OMNIROUTE_BASE_URL}",
        "apiMode": "chat",
        "refreshOnList": true,
        "modelCacheTtl": 300000,
        "modelNameDisplay": "name",
        "hideModelAliases": false,
        "headers": {
          "CF-Access-Client-Id": "{env:CF_ACCESS_CLIENT_ID}",
          "CF-Access-Client-Secret": "{env:CF_ACCESS_CLIENT_SECRET}"
        }
      }
    }
  ]
}
```

On V1 the identical options block goes under `provider.omniroute.options`.

### Model Metadata Enrichment (models.dev)

OmniRoute may not expose model context/output limits in `/v1/models`. When enabled, this plugin attempts to enrich `contextWindow` and `maxTokens` by matching your OmniRoute models against `models.dev`.

You can disable enrichment or override defaults:

```jsonc
{
  "plugins": [
    {
      "package": "opencode-omniroute-auth",
      "options": {
        "modelsDev": {
          "enabled": true,
          "url": "https://models.dev/api.json",
          "timeoutMs": 1000,
          "cacheTtl": 86400000,
          "providerAliases": { "cx": "openai" }
        }
      }
    }
  ]
}
```

### Custom / Virtual Model Overrides (config blocks)

For custom/virtual models (or when matching is imperfect), you can provide metadata overrides.

In `opencode.js` you can use RegExp matchers:

```js
{
  plugins: [
    {
      package: 'opencode-omniroute-auth',
      options: {
        modelMetadata: [
          { match: /gpt-5\.3-codex$/i, contextWindow: 200000, maxTokens: 8192 },
          { match: 'omniroute/virtual/my-custom-model', addIfMissing: true, contextWindow: 50000 },
        ],
      },
    },
  ],
}
```

In JSON configs, use an object keyed by model id:

```jsonc
{
  "plugins": [
    {
      "package": "opencode-omniroute-auth",
      "options": {
        "modelMetadata": {
          "virtual/my-custom-model": { "contextWindow": 50000, "maxTokens": 2048 }
        }
      }
    }
  ]
}
```

### Combo Model Capability Enrichment

OmniRoute supports "combo models" — virtual models that route to multiple underlying models with fallback strategies. This plugin automatically detects combo models and calculates their capabilities using a **lowest common denominator** approach:

- **Context Window**: minimum of all underlying models
- **Max Tokens**: minimum of all underlying models
- **Vision Support**: only if ALL underlying models support vision
- **Tool Support**: only if ALL underlying models support tools

This ensures safe operation by never exceeding the capabilities of any single model in the combo.

**How it works:**

1. The plugin fetches combo definitions from OmniRoute's `/v1/combos` endpoint (with a legacy `/api/combos` fallback)
2. For each combo model, it resolves the underlying models
3. It looks up each underlying model's capabilities from `models.dev`
4. It calculates the lowest common capabilities across all resolvable models
5. These calculated capabilities are applied to the combo model

**Example:**
The "Designer" combo might route to:
- `kmc/kimi-k2.5` (context: 256000, tools: yes)
- `cx/gpt-5.1-codex-mini` (context: 204800, tools: yes)
- `gemini/models/gemini-3-flash-preview` (context: 1048576, tools: yes)

Calculated capabilities:
- Context: **204800** (minimum)
- Max Tokens: **32768** (minimum)
- Tools: **true** (all support tools)

Note: some underlying models may not be found in `models.dev` (e.g. self-hosted models). In that case they are excluded from the capability calculation, a warning is logged, and the plugin falls back to its default limits.

### API Mode

The plugin supports two provider API modes:

- `chat` (default) — best compatibility with existing OpenAI-compatible chat workflows.
- `responses` — enables Responses API mode when your OmniRoute/OpenCode setup supports it.

If an unsupported value is provided, the plugin falls back to `chat`.

## Dynamic Model Fetching

This plugin automatically fetches available models from OmniRoute's `/v1/models` endpoint, so you always have access to the latest models without manual configuration.

### How It Works

1. On startup the plugin fetches models from `/v1/models`
2. By default, models are refreshed every time you open the model list (`refreshOnList: true`)
3. If `refreshOnList` is disabled, models are cached for 5 minutes (configurable via `modelCacheTtl`)
4. If the API is unavailable, fallback models are used

### Refresh / clear the cache programmatically

```typescript
import { clearModelCache } from 'opencode-omniroute-auth/runtime';

clearModelCache();
```

## Default Models

When the `/v1/models` endpoint is unavailable, the plugin provides these fallback models:

- `gpt-4o` — GPT-4o model with full capabilities
- `gpt-4o-mini` — fast and cost-effective
- `claude-3-5-sonnet` — Claude 3.5 Sonnet
- `llama-3-1-405b` — Llama 3.1 405B

## API

### Types

```typescript
import type {
  OmniRouteApiMode,
  OmniRouteConfig,
  OmniRouteModel,
  OmniRouteModelMetadataConfig,
  OmniRouteModelsDevConfig,
} from "opencode-omniroute-auth";

interface OmniRouteConfig {
  baseUrl: string;
  apiKey: string;
  apiMode: OmniRouteApiMode;
  defaultModels?: OmniRouteModel[];
  modelCacheTtl?: number;
  refreshOnList?: boolean;
  modelsDev?: OmniRouteModelsDevConfig;
  modelMetadata?: OmniRouteModelMetadataConfig;
  /** Controls how model names appear in the picker: `"name"` (default), `"id"`, or `"prefixed"`. */
  modelNameDisplay?: 'name' | 'id' | 'prefixed';
  /** Hide alias models that have a `parent` field in `/v1/models`. */
  hideModelAliases?: boolean;
}

type OmniRouteApiMode = 'chat' | 'responses';

interface OmniRouteModel {
  id: string;
  name: string;
  description?: string;
  contextWindow?: number;
  maxTokens?: number;
  supportsStreaming?: boolean;
  supportsVision?: boolean;
  supportsTools?: boolean;
  supportsTemperature?: boolean;
  supportsReasoning?: boolean;
  supportsAttachment?: boolean;
  // OmniRoute native fields (normalized automatically)
  context_length?: number;
  max_input_tokens?: number;
  max_output_tokens?: number;
  capabilities?: {
    vision?: boolean;
    tool_calling?: boolean;
    reasoning?: boolean;
    thinking?: boolean;
    attachment?: boolean;
    temperature?: boolean;
  };
  pricing?: {
    input?: number;
    output?: number;
  };
}
```

### Functions

```typescript
import {
  fetchModels,
  clearModelCache,
  refreshModels,
  // Combo model utilities
  clearComboCache,
  fetchComboData,
  resolveUnderlyingModels,
  calculateModelCapabilities,
} from 'opencode-omniroute-auth/runtime';

// Fetch models manually (with automatic normalization and enrichment)
const models = await fetchModels(config, apiKey);

// Clear model cache (also clears combo cache)
clearModelCache();

// Force refresh models
const freshModels = await refreshModels(config, apiKey);

// Combo model utilities
const combos = await fetchComboData(config);
const underlyingModels = await resolveUnderlyingModels('Designer', config);
const capabilities = await calculateModelCapabilities(model, config, modelsDevIndex);
```

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Watch mode
npm run dev

# Clean
npm run clean

# Run tests (builds first)
npm test
```

`dist/` is committed to the repo: pnpm 10+ refuses to run build scripts for git-hosted packages unless they are allowlisted, so git installs must ship prebuilt output. After any source change, run `npm run build && git add dist` before committing.

### Publishing to npm

The published package is `@lazygatto/opencode-omniroute-auth`, built from the `release/npm` branch (`main` keeps the upstream package name for git installs and for the upstream PR). To cut a release:

```bash
git checkout release/npm
git merge main            # pick up new commits
npm version patch         # or minor / major; the same version cannot be published twice
git push origin release/npm
npm publish               # prepublishOnly rebuilds dist + runs check:exports, then asks for the 2FA code
```

`npm publish` accepts `--otp=<code>` if the code is passed non-interactively. 2FA is `auth-and-writes` on this account, so `npm login --auth-type=web` does not bypass the publish prompt — an authenticator code is always required. Automation tokens that skip 2FA are being restricted by npm for direct publishing.

## Troubleshooting

### Connection Failed

If you see "Connection failed" when running `/connect omniroute`:

1. **Check your configured base URL** — ensure the plugin `baseURL` option points to your OmniRoute endpoint
2. **Verify your API key** — ensure your key is valid for that instance
3. **Check OmniRoute is running** — ensure the instance is reachable from the machine OpenCode runs on

### Models Not Loading

1. Check your OmniRoute `/v1/models` endpoint is accessible
2. Ensure the plugin `baseURL` option points to your OmniRoute endpoint
3. Re-run `/connect omniroute` to refresh your API key
4. If you use the package programmatically, call `clearModelCache()` from `opencode-omniroute-auth/runtime`
5. Check the OpenCode logs (`~/.local/share/opencode/log/opencode.log`) for error messages

### Plugin Not Loading

1. On V2 use the `plugins` object entry (see Quick start); on V1 (≥ 1.18.29) use `"plugin": ["opencode-omniroute-auth"]`
2. Ensure the installed package is **2.0.0 or newer** (`node -e "console.log(require('./node_modules/opencode-omniroute-auth/package.json').version)"` from the config's directory tree)
3. Ensure the package is in a `node_modules` visible from the config directory (see Installation → Where to install)
4. Restart OpenCode — or the background service — after installing or updating the package; a running server keeps the old module in memory
5. Check plugin install cache/logs under `~/.cache/opencode/node_modules`

### Combo Fetch Returns 401

`Failed to fetch combo data: 401` after startup means the combo request went out with an empty `Authorization` header. That was fixed in this fork (commit `f4c56a3`, shipped with the `v2.0.0` tag). Upgrade to the latest `main`/tag and restart OpenCode.

### pnpm 10+ `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`

Current tags install cleanly — `dist/` is committed and there is no `prepare` script. If you pin a tag from before `562ab61`, either move to a newer tag or allowlist the build in your `pnpm-workspace.yaml`.

## License

MIT

## Upstream

Forked from [Alph4d0g/opencode-omniroute-auth](https://github.com/Alph4d0g/opencode-omniroute-auth). Upstream fixes are merged in from time to time; V2-specific changes live in this fork.
