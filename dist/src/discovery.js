import { OMNIROUTE_ENDPOINTS } from './constants.js';
/** Use the same header precedence as the generation interceptor. */
export function createDiscoveryHeaders(config, apiKey) {
    const headers = new Headers({
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
    });
    for (const [name, value] of Object.entries(config.headers ?? {})) {
        headers.set(name, value);
    }
    return headers;
}
/** Keep discovery caches separate for each gateway and authentication context. */
export function getDiscoveryCacheKey(config, apiKey) {
    const baseUrl = (config.baseUrl || OMNIROUTE_ENDPOINTS.BASE_URL).replace(/\/+$/, '');
    const headers = [];
    createDiscoveryHeaders(config, apiKey).forEach((value, name) => {
        headers.push([name, value]);
    });
    headers.sort(([left], [right]) => left.localeCompare(right));
    return JSON.stringify([baseUrl, apiKey, headers]);
}
//# sourceMappingURL=discovery.js.map