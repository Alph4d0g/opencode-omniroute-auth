import type { OmniRouteConfig } from './types.js';
/** Use the same header precedence as the generation interceptor. */
export declare function createDiscoveryHeaders(config: OmniRouteConfig, apiKey: string): Headers;
/** Keep discovery caches separate for each gateway and authentication context. */
export declare function getDiscoveryCacheKey(config: OmniRouteConfig, apiKey: string): string;
//# sourceMappingURL=discovery.d.ts.map