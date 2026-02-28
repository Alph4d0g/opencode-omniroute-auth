# OpenCode OmniRoute Auth Plugin

🔌 Authentication plugin for [OpenCode](https://opencode.ai) to connect to [OmniRoute](https://omniroute.ai) API.

## Features

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
import { clearModelCache } from "opencode-omniroute-auth";

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
| `provider.omniroute.options.modelCacheTtl` | number | No | Model cache TTL in milliseconds (default: 5 minutes) |
| `provider.omniroute.options.refreshOnList` | boolean | No | Whether to refresh models when provider options load (default: true) |

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
import type { OmniRouteConfig, OmniRouteModel } from "opencode-omniroute-auth";

interface OmniRouteConfig {
  baseUrl: string;
  apiKey: string;
  defaultModels?: OmniRouteModel[];
  modelCacheTtl?: number;
  refreshOnList?: boolean;
}

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
  refreshModels 
} from "opencode-omniroute-auth";

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
4. If you use the package programmatically, call `clearModelCache()`
5. Check the OpenCode logs for error messages

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Support

For support, please open an issue on GitHub or contact OmniRoute support.
