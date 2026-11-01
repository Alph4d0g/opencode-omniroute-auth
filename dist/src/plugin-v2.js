import { DEFAULT_CONTEXT_LIMIT, MODEL_CACHE_TTL, OMNIROUTE_CHAT_PROVIDER_PACKAGE, OMNIROUTE_DEFAULT_MODELS, OMNIROUTE_PLUGIN_ID, OMNIROUTE_PROVIDER_ID, OMNIROUTE_RESPONSES_PROVIDER_PACKAGE, } from './constants.js';
import { buildReasoningVariants, fetchModels, resolveOutputLimit } from './models.js';
import { debug, describeError, warn } from './logger.js';
import { sanitizeForLog } from './omniroute-combos.js';
import { applyModelMetadataOverrides, createRuntimeConfig, formatModelDisplayName, getModelFamily, readAuthFromStore, } from './plugin.js';
import { isRecord, normalizeChatUsageResponse, sanitizeChatPayload } from './http-sanitize.js';
const OMNIROUTE_PROVIDER_NAME = 'OmniRoute';
/**
 * Variant keys that are OpenCode provider-package options and must stay in
 * `settings`. Everything else in a variant record is a raw request-body field
 * (e.g. `chat_template_kwargs`) and must go to `body`: the openai-compatible
 * driver only knows a fixed set of options, and silently drops unknown
 * `settings` keys, so putting body fields there makes them disappear.
 */
const VARIANT_SETTINGS_KEYS = new Set(['reasoningEffort']);
/**
 * Map a V1 variant record to a V2 variant, splitting provider options
 * (`settings`) from raw request-body fields (`body`).
 */
function toV2Variant(id, variant) {
    if (!isRecord(variant) || Object.keys(variant).length === 0) {
        return { id };
    }
    const settings = {};
    const body = {};
    for (const [key, value] of Object.entries(variant)) {
        if (VARIANT_SETTINGS_KEYS.has(key)) {
            settings[key] = value;
        }
        else {
            body[key] = value;
        }
    }
    return {
        id,
        ...(Object.keys(settings).length > 0 ? { settings } : {}),
        ...(Object.keys(body).length > 0 ? { body } : {}),
    };
}
/**
 * Convert an OmniRoute model to a V2 model definition.
 *
 * Mirrors the V1 `toProviderModel` mapping: same display-name formatting,
 * family, capability defaults (tools assumed unless explicitly disabled),
 * cost (USD per 1M tokens) and limits.
 */
export function toV2Model(model, config) {
    const supportsVision = model.supportsVision === true;
    // Default to true: if the API does not explicitly disable tools, assume the
    // capability exists (matches the V1 behavior for OpenAI-compatible models).
    const supportsTools = model.supportsTools !== false;
    // V1 variant records (`{ low: { reasoningEffort: 'low' }, ... }`) become
    // V2 variant arrays. Provider options go to `settings` (`reasoningEffort` is
    // a semantic key the V2 core maps to `reasoning_effort` in the request body),
    // while raw body fields such as `chat_template_kwargs` go to `body` — see
    // `toV2Variant`.
    const variantSource = model.variants && Object.keys(model.variants).length > 0
        ? model.variants
        : buildReasoningVariants(model);
    const variants = Object.entries(variantSource).map(([id, variant]) => toV2Variant(id, variant));
    return {
        id: model.id,
        modelID: model.id,
        providerID: OMNIROUTE_PROVIDER_ID,
        name: formatModelDisplayName(model.id, model.name || model.id, config.modelNameDisplay),
        family: getModelFamily(model.id),
        capabilities: {
            tools: supportsTools,
            input: supportsVision ? ['text', 'image'] : ['text'],
            output: ['text'],
        },
        variants,
        time: { released: 0 },
        cost: [
            {
                input: model.pricing?.input ?? 0,
                output: model.pricing?.output ?? 0,
                cache: { read: 0, write: 0 },
            },
        ],
        status: 'active',
        enabled: true,
        limit: {
            context: model.contextWindow ?? DEFAULT_CONTEXT_LIMIT,
            output: resolveOutputLimit(model),
        },
    };
}
export function toV2Models(models, config) {
    return models.map((model) => toV2Model(model, config));
}
/**
 * Resolve the OmniRoute API key.
 *
 * Order: active `omniroute` integration credential (set via `/connect` or
 * imported from the legacy `auth.json` by the V2 migration) -> legacy
 * `auth.json` store -> `OMNIROUTE_API_KEY` environment variable.
 */
async function resolveCredential(ctx, allowLegacy) {
    try {
        const connection = await ctx.integration.connection.active(OMNIROUTE_PROVIDER_ID);
        if (connection) {
            const credential = await ctx.integration.connection.resolve(connection);
            if (credential && credential.type === 'key' && typeof credential.key === 'string' && credential.key) {
                return { apiKey: credential.key, connection, native: true };
            }
            return { connection, native: true };
        }
    }
    catch (error) {
        debug(`V2 integration credential resolution failed: ${sanitizeForLog(describeError(error))}`);
        return { native: true };
    }
    if (!allowLegacy)
        return { native: true };
    const stored = await readAuthFromStore(OMNIROUTE_PROVIDER_ID);
    if (stored?.key) {
        return { apiKey: stored.key, native: false };
    }
    const envKey = process.env.OMNIROUTE_API_KEY;
    return { apiKey: envKey || undefined, native: false };
}
function buildProviderInfo(packageID, config, apiKey) {
    const settings = { baseURL: config.baseUrl };
    const headers = {};
    new Headers(config.headers).forEach((value, name) => { headers[name] = value; });
    if (apiKey) {
        settings.apiKey = apiKey;
    }
    return {
        id: OMNIROUTE_PROVIDER_ID,
        name: OMNIROUTE_PROVIDER_NAME,
        activation: apiKey ? 'enabled' : 'auto',
        package: packageID,
        integrationID: OMNIROUTE_PROVIDER_ID,
        settings,
        ...(config.headers ? { headers } : {}),
    };
}
/**
 * V2 plugin setup. The returned cleanup function disposes the model refresh
 * timer and the session http hooks.
 */
export async function setup(ctx) {
    const options = isRecord(ctx.options) ? { ...ctx.options } : {};
    // Options come from the `plugins` config entry, not the provider config.
    // The plugin owns the provider: it registers driver, settings, and models.
    const config = createRuntimeConfig(options, '');
    const state = {
        native: false,
        models: toV2Models(OMNIROUTE_DEFAULT_MODELS, config),
    };
    // 1. Integration: display name + key auth method so `/connect omniroute`
    //    offers an API key form and the credential store is addressable.
    try {
        await ctx.integration.transform((editor) => {
            editor.method.update({
                integrationID: OMNIROUTE_PROVIDER_ID,
                method: { type: 'env', names: ['OMNIROUTE_API_KEY'] },
            });
            editor.method.update({
                integrationID: OMNIROUTE_PROVIDER_ID,
                method: { type: 'key', label: 'API Key' },
            });
            const existing = editor.get(OMNIROUTE_PROVIDER_ID);
            if (existing && existing.name !== OMNIROUTE_PROVIDER_NAME) {
                editor.update(OMNIROUTE_PROVIDER_ID, (integration) => {
                    integration.name = OMNIROUTE_PROVIDER_NAME;
                });
            }
        });
    }
    catch (error) {
        warn(`OmniRoute V2: failed to register integration: ${sanitizeForLog(describeError(error))}`);
    }
    Object.assign(state, await resolveCredential(ctx, true));
    // 2. Provider registration. The transform must be synchronous and
    //    replayable: it reads the current state from the closure, so the
    //    refreshed model list and key are picked up by `ctx.provider.reload()`.
    const providerPackage = config.apiMode === 'responses'
        ? OMNIROUTE_RESPONSES_PROVIDER_PACKAGE
        : OMNIROUTE_CHAT_PROVIDER_PACKAGE;
    await ctx.provider.transform((editor) => {
        editor.add({
            info: buildProviderInfo(providerPackage, config, state.apiKey),
            models: state.models,
            ...(state.connection ? { sourceConnection: state.connection } : {}),
        });
    });
    // 3. Model fetching: initial pass + periodic refresh. When the key or the
    //    model list changes, replay the provider transform via reload().
    let disposed = false;
    let pendingRefresh;
    let refreshRequested = false;
    const eventsController = new AbortController();
    const refreshOnce = async () => {
        if (disposed) {
            return;
        }
        const credential = await resolveCredential(ctx, !state.native);
        if (disposed)
            return;
        state.native ||= credential.native;
        const key = credential.apiKey;
        if (!key) {
            const hadKey = state.apiKey !== undefined;
            state.apiKey = undefined;
            state.connection = undefined;
            config.apiKey = '';
            state.models = toV2Models(applyModelMetadataOverrides(OMNIROUTE_DEFAULT_MODELS, options.modelMetadata), config);
            if (hadKey)
                await ctx.provider.reload();
            return;
        }
        // Each discovery pass captures its own key, including combo enrichment.
        const runtimeConfig = { ...config, apiKey: key };
        try {
            const fetched = await fetchModels(runtimeConfig, key, config.refreshOnList !== false);
            if (disposed)
                return;
            const current = await resolveCredential(ctx, !state.native);
            if (disposed)
                return;
            if (current.apiKey !== key || !sameConnection(current.connection, credential.connection)) {
                refreshRequested = true;
                return;
            }
            const effective = applyModelMetadataOverrides(fetched, options.modelMetadata);
            const models = toV2Models(effective, config);
            if (models.length === 0) {
                warn('OmniRoute V2: model list is empty; keeping previous models');
                return;
            }
            state.models = models;
            state.apiKey = key;
            state.connection = credential.connection;
            await ctx.provider.reload();
            debug(`OmniRoute V2: published ${models.length} models`);
        }
        catch (error) {
            warn(`OmniRoute V2: model refresh failed: ${sanitizeForLog(describeError(error))}`);
        }
    };
    const refreshModels = () => {
        if (disposed)
            return Promise.resolve();
        refreshRequested = true;
        if (pendingRefresh)
            return pendingRefresh;
        pendingRefresh = (async () => {
            while (refreshRequested && !disposed) {
                refreshRequested = false;
                await refreshOnce();
            }
        })().catch((error) => {
            warn(`OmniRoute V2: credential refresh failed: ${sanitizeForLog(describeError(error))}`);
        }).finally(() => { pendingRefresh = undefined; });
        return pendingRefresh;
    };
    const watching = (async () => {
        try {
            for await (const event of ctx.event.subscribe({ signal: eventsController.signal })) {
                if (event.type === 'credential.switched'
                    && event.data.integrationID === OMNIROUTE_PROVIDER_ID) {
                    state.native = true;
                    void refreshModels();
                }
                else if (event.type === 'credential.updated' || event.type === 'integration.updated') {
                    // Boot batches integration transforms until setup returns. This event
                    // makes native stored credentials visible without waiting for the TTL.
                    void refreshModels();
                }
            }
        }
        catch {
            if (!disposed)
                warn('OmniRoute V2: credential subscription stopped');
        }
    })();
    void refreshModels();
    const ttl = typeof config.modelCacheTtl === 'number' && Number.isFinite(config.modelCacheTtl) && config.modelCacheTtl > 0
        ? config.modelCacheTtl
        : MODEL_CACHE_TTL;
    const timer = setInterval(() => {
        void refreshModels();
    }, ttl);
    // Node returns a Timeout object that supports `unref()` so the interval does
    // not keep the process alive; browsers return a numeric handle without it.
    if (typeof timer === 'object' && timer !== null && typeof timer.unref === 'function') {
        timer.unref();
    }
    // 4. Session http hooks, scoped to the omniroute provider.
    const requestRegistration = await ctx.session.hook('http.request', async (event) => {
        try {
            const request = event.request;
            if (!isOmniRouteUrl(request.url, config.baseUrl))
                return;
            if (config.headers) {
                new Headers(config.headers).forEach((value, name) => request.headers.set(name, value));
            }
            // Fallback auth: the provider settings carry the key, but if the
            // driver did not attach it (e.g. key arrived after provider load),
            // make sure the request is authorized.
            if (!request.headers.get('authorization') && state.apiKey) {
                request.headers.set('authorization', `Bearer ${state.apiKey}`);
            }
            const url = request.url;
            if (!url.includes('/chat/completions') && !url.includes('/responses')) {
                return;
            }
            const contentType = request.headers.get('content-type')?.toLowerCase() ?? '';
            if (!contentType.includes('application/json')) {
                return;
            }
            const rawBody = await request.clone().text();
            const sanitizedBody = sanitizeChatPayload(rawBody, url);
            if (sanitizedBody === undefined) {
                return;
            }
            const headers = new Headers(request.headers);
            headers.set('content-type', 'application/json');
            headers.delete('content-length');
            event.request = new Request(request, { headers, body: sanitizedBody });
            debug(`OmniRoute V2: sanitized request payload for ${sanitizeForLog(url)}`);
        }
        catch (error) {
            warn(`OmniRoute V2: http.request hook failed: ${sanitizeForLog(describeError(error))}`);
        }
    }, { providerID: OMNIROUTE_PROVIDER_ID });
    const responseRegistration = await ctx.session.hook('http.response', async (event) => {
        try {
            const url = event.request.url;
            if (!isOmniRouteUrl(url, config.baseUrl) || !url.includes('/chat/completions')) {
                return;
            }
            event.response = await normalizeChatUsageResponse(url, event.response);
        }
        catch (error) {
            warn(`OmniRoute V2: http.response hook failed: ${sanitizeForLog(describeError(error))}`);
        }
    }, { providerID: OMNIROUTE_PROVIDER_ID });
    return async () => {
        disposed = true;
        clearInterval(timer);
        eventsController.abort();
        await watching;
        await Promise.allSettled([requestRegistration.dispose(), responseRegistration.dispose()]);
    };
}
function isOmniRouteUrl(value, baseUrl) {
    const url = new URL(value);
    const base = new URL(baseUrl);
    const path = base.pathname.replace(/\/$/, '');
    return url.origin === base.origin
        && (url.pathname === path || url.pathname.startsWith(`${path}/`));
}
function sameConnection(left, right) {
    if (!left || !right)
        return left === right;
    if (left.type !== right.type)
        return false;
    return left.type === 'credential' && right.type === 'credential'
        ? left.id === right.id
        : left.type === 'env' && right.type === 'env' && left.name === right.name;
}
export const v2Definition = {
    id: OMNIROUTE_PLUGIN_ID,
    setup,
};
//# sourceMappingURL=plugin-v2.js.map