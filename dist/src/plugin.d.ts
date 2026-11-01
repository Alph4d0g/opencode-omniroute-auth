import type { Plugin } from '@opencode-ai/plugin';
import type { OmniRouteConfig, OmniRouteModel } from './types.js';
export declare const OmniRouteAuthPlugin: Plugin;
export declare function createRuntimeConfig(options: Record<string, unknown> | undefined, apiKey: string): OmniRouteConfig;
export declare function readAuthFromStore(providerId: string): Promise<{
    key?: string;
    type?: string;
} | null>;
export declare function applyModelMetadataOverrides(models: OmniRouteModel[], rawUserConfig: unknown): OmniRouteModel[];
export declare function formatModelDisplayName(id: string, baseName: string, modelNameDisplay?: 'name' | 'id' | 'prefixed'): string;
export declare function getModelFamily(modelId: string): string;
//# sourceMappingURL=plugin.d.ts.map