/**
 * OpenCode V2 plugin implementation for OmniRoute.
 *
 * V2 plugins export a definition object `{ id, setup }` instead of an async
 * function (see the V1 -> V2 migration guide). This module implements the V2
 * lifecycle:
 *
 * - resolves the API key from the `omniroute` integration credential, the
 *   legacy `auth.json` store, or `OMNIROUTE_API_KEY`;
 * - registers the `omniroute` integration (display name + API key method for
 *   `/connect`);
 * - registers the `omniroute` provider with the matching V2 driver package
 *   (openai-compatible for chat mode, openai for responses mode) and passes
 *   `baseURL` + `apiKey` through provider `settings`;
 * - publishes the model list fetched from OmniRoute (same enrichment and
 *   metadata overrides as V1) and refreshes it on an interval;
 * - reuses the shared HTTP sanitization for request payloads and cached
 *   chat-usage normalization.
 *
 * All `@opencode/plugin` imports are type-only and erased at compile time, so
 * the built plugin has no runtime dependency on the SDK: the V2 host resolves
 * providers, credentials, and models from its own registry.
 */
import type { Plugin } from '@opencode/plugin';
import type { OmniRouteConfig, OmniRouteModel } from './types.js';
type Context = Plugin.Context;
/**
 * Structural representation of a V2 `Model.Info` entry. The host validates
 * against its runtime schema; this shape mirrors the V2 default factory
 * (`Model.Info.default`) field for field.
 */
export interface V2ModelVariant {
    id: string;
    settings?: Record<string, unknown>;
    body?: Record<string, unknown>;
}
export interface V2ModelCost {
    input: number;
    output: number;
    cache: {
        read: number;
        write: number;
    };
}
export interface V2ModelInfo {
    id: string;
    modelID: string;
    providerID: string;
    name: string;
    family?: string;
    capabilities: {
        tools: boolean;
        input: string[];
        output: string[];
    };
    variants: V2ModelVariant[];
    time: {
        released: number;
    };
    cost: V2ModelCost[];
    status: 'active';
    enabled: boolean;
    limit: {
        context: number;
        output: number;
    };
}
/**
 * Convert an OmniRoute model to a V2 model definition.
 *
 * Mirrors the V1 `toProviderModel` mapping: same display-name formatting,
 * family, capability defaults (tools assumed unless explicitly disabled),
 * cost (USD per 1M tokens) and limits.
 */
export declare function toV2Model(model: OmniRouteModel, config: OmniRouteConfig): V2ModelInfo;
export declare function toV2Models(models: OmniRouteModel[], config: OmniRouteConfig): V2ModelInfo[];
/**
 * V2 plugin setup. The returned cleanup function disposes the model refresh
 * timer and the session http hooks.
 */
export declare function setup(ctx: Context): Promise<() => Promise<void>>;
export declare const v2Definition: {
    id: string;
    setup: typeof setup;
};
export {};
//# sourceMappingURL=plugin-v2.d.ts.map