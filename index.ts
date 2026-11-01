import { OmniRouteAuthPlugin } from './src/plugin.js';
import { v2Definition } from './src/plugin-v2.js';

export { OmniRouteAuthPlugin };
export { v2Definition };

/**
 * Dual V1/V2 entry point (see https://opencode.ai/v2/docs/build/plugins/migrate-v1).
 *
 * - OpenCode V2 loads the plugin through `setup(ctx)` and requires a default
 *   export object with a stable string `id`.
 * - OpenCode V1 (1.18.29 and newer) supports object entrypoints and calls
 *   `server(ctx)` to obtain the classic hooks object.
 *
 * The two APIs stay separate; this shape does not translate hooks
 * automatically.
 */
export default {
  ...v2Definition,
  server: OmniRouteAuthPlugin,
};

export type {
  OmniRouteApiMode,
  OmniRouteConfig,
  OmniRouteModel,
  OmniRouteModelMetadata,
  OmniRouteModelMetadataBlock,
  OmniRouteModelMetadataConfig,
  OmniRouteModelsDevConfig,
} from './src/types.js';
