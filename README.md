# OpenCode OmniRoute Auth Plugin

🔌 Authentication plugin for [OpenCode](https://opencode.ai) to connect to [OmniRoute](https://omniroute.ai) API.

## Features

- ✅ **Simple `/connect` Command** - No manual configuration needed
- ✅ **API Key Authentication** - Simple and secure API key-based auth
- ✅ **Dynamic Model Fetching** - Automatically fetches available models from `/v1/models` endpoint
- ✅ **Provider Auto-Registration** - Registers an `omniroute` provider via plugin hooks
- ✅ **Model Caching** - Intelligent caching with TTL for better performance
- ✅ **Fallback Models** - Default models when API is unavailable
- ✅ **Combo Model Capability Enrichment** - Automatically calculates lowest common capabilities for OmniRoute combo models

- ✅ **Simple `/connect` Command** - No manual configuration needed
- ✅ **API Key Authentication** - Simple and secure API key-based auth
- ✅ **Dynamic Model Fetching** - Automatically fetches available models from `/v1/models` endpoint
- ✅ **Provider Auto-Registration** - Registers an `omniroute` provider via plugin hooks
- ✅ **Model Caching** - Intelligent caching with TTL for better performance
- ✅ **Fallback Models** - Default models when API is unavailable

## Installation

## Quick Start

### 1. Add plugin to opencode config
```json
{
  "plugin": [
    "opencode-omniroute-auth"
  ]
}
```

### 2. Connect to OmniRoute

Simply run the `/connect` command in OpenCode:

```
/connect omniroute
```

The plugin will prompt you for your **API key**.

### 3. Done! 🎉

The plugin automatically:
- Fetches available models from `/v1/models`
- Configures OpenCode to use OmniRoute
- Stores your credentials securely

No manual configuration file editing required!

## Usage

Once connected, OpenCode will automatically use OmniRoute for AI requests:

```bash
# The plugin is now active and ready to use
# All AI requests will be routed through OmniRoute
```

### Refresh Models

By default, the plugin refreshes the model list whenever provider options are reloaded (`refreshOnList: true`).

You can disable refreshes by setting `provider.omniroute.options.refreshOnList` to `false` and clear the cache programmatically:

```typescript
import { clearModelCache } from 'opencode-omniroute-auth/runtime';

clearModelCache();
```

## Configuration (Optional)

While the plugin works out-of-the-box with `/connect`, you can also configure it manually in your OpenCode config:

```json
{
  "plugin": [
    "opencode-omniroute-auth"
  ],
  "provider": {
    "omniroute": {
      "options": {
        "baseURL": "http://localhost:20128/v1",
        "apiMode": "chat",
        "refreshOnList": true,
        "modelCacheTtl": 300000
      }
    }
  }
}
```

Use `/connect omniroute` to store your API key in `~/.local/share/opencode/auth.json`.

### Configuration Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `plugin` | string[] | No | npm plugin packages to load (use `opencode-omniroute-auth` when installed from npm) |
| `provider.omniroute.options.baseURL` | string | No | OmniRoute API base URL (default: `http://localhost:20128/v1`) |
| `provider.omniroute.options.apiMode` | `'chat' \| 'responses'` | No | Provider API mode (default: `chat`) |
| `provider.omniroute.options.modelCacheTtl` | number | No | Model cache TTL in milliseconds (default: 5 minutes) |
| `provider.omniroute.options.refreshOnList` | boolean | No | Whether to refresh models when provider options load (default: true) |
| `provider.omniroute.options.modelsDev` | object | No | Enrich model metadata from models.dev on refresh (default: enabled) |
| `provider.omniroute.options.modelMetadata` | object \| array | No | Override/add metadata for custom/virtual models (works well in `opencode.js`) |

### Model Metadata Enrichment (models.dev)

OmniRoute may not expose model context/output limits in `/v1/models`. When enabled, this plugin attempts to
enrich `contextWindow` and `maxTokens` by matching your OmniRoute models against `models.dev`.

You can disable enrichment or override defaults:

```js
{
  provider: {
    omniroute: {
      options: {
        modelsDev: {
          enabled: true,
          url: 'https://models.dev/api.json',
          timeoutMs: 1000,
          cacheTtl: 86400000,
          providerAliases: {
            cx: 'openai',
          },
        },
      },
    },
  },
}
```

### Custom / Virtual Model Overrides (config blocks)

For custom/virtual models (or when matching is imperfect), you can provide metadata overrides.

In `opencode.js` you can use RegExp matchers:

```js
{
  provider: {
    omniroute: {
      options: {
        modelMetadata: [
          { match: /gpt-5\.3-codex$/i, contextWindow: 200000, maxTokens: 8192 },
          { match: 'omniroute/virtual/my-custom-model', addIfMissing: true, contextWindow: 50000 },
        ],
      },
    },
  },
}
```

In JSON configs, use an object keyed by model id:

```json
{
  "provider": {
    "omniroute": {
      "options": {
        "modelMetadata": {
          "virtual/my-custom-model": { "contextWindow": 50000, "maxTokens": 2048 }
        }
      }
    }
  }
}
```

### Combo Model Capability Enrichment

OmniRoute supports "combo models" - virtual models that route to multiple underlying models with fallback strategies. This plugin automatically detects combo models and calculates their capabilities using a **lowest common denominator** approach:

- **Context Window**: Minimum of all underlying models
- **Max Tokens**: Minimum of all underlying models  
- **Vision Support**: Only if ALL underlying models support vision
- **Tool Support**: Only if ALL underlying models support tools

This ensures safe operation by never exceeding the capabilities of any single model in the combo.

**How it works:**
1. The plugin fetches combo definitions from OmniRoute's `/api/combos` endpoint
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

Note: Some underlying models may not be found in `models.dev` (e.g., custom models). In such cases, they are excluded from capability calculation, and a warning is logged.

### API Mode

### API Mode

The plugin supports two provider API modes:

- `chat` (default) - best compatibility with existing OpenAI-compatible chat workflows.
- `responses` - enables Responses API mode when your OmniRoute/OpenCode setup supports it.

Example:

```json
{
  "provider": {
    "omniroute": {
      "options": {
        "apiMode": "responses"
      }
    }
  }
}
```

If an unsupported value is provided, the plugin falls back to `chat`.

## Dynamic Model Fetching

This plugin automatically fetches available models from OmniRoute's `/v1/models` endpoint. This ensures you always have access to the latest models without manual configuration.

### How It Works

1. On first request, the plugin fetches models from `/v1/models`
2. By default, models are refreshed every time you open the model list (`refreshOnList: true`)
3. If `refreshOnList` is disabled, models are cached for 5 minutes (configurable via `modelCacheTtl`)
4. If the API is unavailable, fallback models are used

## Default Models

When the `/v1/models` endpoint is unavailable, the plugin provides these fallback models:

- `gpt-4o` - GPT-4o model with full capabilities
- `gpt-4o-mini` - Fast and cost-effective
- `claude-3-5-sonnet` - Claude 3.5 Sonnet
- `llama-3-1-405b` - Llama 3.1 405B

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
  // New: Combo model utilities
  clearComboCache,
  fetchComboData,
  resolveUnderlyingModels,
  calculateModelCapabilities,
} from 'opencode-omniroute-auth/runtime';

// Fetch models manually (with automatic enrichment)
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
import {
  fetchModels,
  clearModelCache,
  refreshModels,
} from 'opencode-omniroute-auth/runtime';

// Fetch models manually
const models = await fetchModels(config, apiKey);

// Clear model cache
clearModelCache();

// Force refresh models
const freshModels = await refreshModels(config, apiKey);
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
```

## Troubleshooting

### Connection Failed

If you see "Connection failed" when running `/connect omniroute`:

1. **Check your configured base URL** - Ensure `provider.omniroute.options.baseURL` points to your OmniRoute endpoint
2. **Verify your API key** - Ensure your API key starts with `sk-` and is valid
3. **Check OmniRoute is running** - Ensure your OmniRoute instance is accessible

### Models Not Loading

If models aren't loading:

1. Check your OmniRoute `/v1/models` endpoint is accessible
2. Ensure `provider.omniroute.options.baseURL` points to your OmniRoute endpoint
3. Re-run `/connect omniroute` to refresh your API key
4. If you use the package programmatically, call `clearModelCache()` from `opencode-omniroute-auth/runtime`
5. Check the OpenCode logs for error messages

### Plugin Not Loading Outside This Repo

If the plugin loads only through a local shim (for example from `.opencode/plugins` or `.opencode/plugi`) but not from npm in `opencode.json`:

1. Ensure you are using `opencode-omniroute-auth@1.0.1` or newer
2. Confirm your config includes `"plugin": ["opencode-omniroute-auth"]`
3. Restart OpenCode so npm plugins are reloaded
4. Check plugin install cache/logs under `~/.cache/opencode/node_modules`

If needed, clear and reinstall plugin dependencies, then restart OpenCode.

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Support

For support, please open an issue on GitHub or contact OmniRoute support.
