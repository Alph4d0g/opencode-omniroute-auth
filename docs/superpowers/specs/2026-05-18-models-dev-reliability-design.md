## Title

Improve `models.dev` enrichment reliability with retries and stale in-memory fallback

## Background

`models.dev` enrichment currently depends on a single network fetch guarded by a hardcoded `1000ms` timeout. If that fetch times out or otherwise fails, the plugin returns `null` for the `models.dev` dataset and skips enrichment entirely.

Root-cause analysis showed that the current design is too brittle for real network conditions:

- timeout budget is only `1000ms`
- the abort covers the full request lifecycle, not just first byte
- there is no retry behavior
- there is no stale-cache fallback when live refresh fails
- the system fails open to "no enrichment" even for short-lived transient network issues

This design addresses reliability first while keeping scope intentionally limited to in-memory behavior.

## Goals

- Make `models.dev` enrichment resilient to transient network slowness and upstream instability.
- Preserve previously fetched enrichment data when later refreshes fail.
- Keep failure behavior safe: plugin should continue working even if enrichment is unavailable.
- Improve observability so future failures can be diagnosed from logs.
- Keep the change localized and testable.

## Non-Goals

- No persistent disk cache in this iteration.
- No background refresh worker.
- No changes to model matching, deduplication, or alias resolution behavior.
- No changes to combo capability calculation beyond consuming more reliable `models.dev` data.

## Recommended Approach

Adopt a reliability-first fetch pipeline for `models.dev` with:

- increased per-attempt timeout
- bounded retries with short backoff
- stale in-memory cache fallback when live refresh fails
- improved structured logging around failure class and retry behavior

This retains the current high-level contract of "best available enrichment" while removing the current single-point transient failure.

## Detailed Design

### 1. Timeout policy

Increase the default `models.dev` timeout from `1000ms` to `5000ms`.

Rationale:

- root-cause analysis showed that `1000ms` is an aggressive end-to-end budget for a public internet fetch
- the timeout includes connect, TLS, response body transfer, and JSON consumption
- a moderate increase materially improves reliability without creating extreme hangs

This timeout remains configurable through existing `modelsDev.timeoutMs` config.

### 2. Retry policy

Replace the current single-attempt fetch with a bounded retry loop.

Default behavior:

- maximum attempts: `3`
- backoff sequence: `250ms`, then `500ms`

Retryable failures:

- request aborted due to timeout (`AbortError`)
- network-level fetch errors
- HTTP `429`
- HTTP `5xx`

Non-retryable failures:

- HTTP `4xx` other than `429`
- definitively invalid response structure

Reasoning:

- transient network and upstream capacity issues should be retried
- permanent client-side problems should fail fast to avoid unnecessary delay

### 3. Cache behavior

Retain the existing in-memory cache and refine fallback behavior.

#### Fresh cache

If cached `models.dev` data exists and is within TTL:

- return it immediately
- do not make a network request

#### Stale cache fallback

If cached data exists but is older than TTL:

- attempt live refresh first
- if live refresh succeeds, replace cache and return new data
- if live refresh fails after retries, return stale cached data instead of `null`

#### Cold start failure

If there is no cache and all attempts fail:

- return `null`
- enrichment is skipped, preserving current fail-open behavior

This makes the system best-available rather than all-or-nothing.

### 4. Logging and diagnostics

Add explicit logging around fetch attempts and fallback decisions.

Per failed attempt, log:

- attempt number
- failure class: timeout / network / HTTP / parse / invalid-structure
- status code when available
- elapsed attempt duration

On success, log:

- success attempt number
- total elapsed duration
- provider count or equivalent summary

On stale-cache fallback, log:

- that live refresh failed
- stale cache age
- that stale cached `models.dev` data was returned

These logs should support future diagnosis without changing runtime semantics.

### 5. Code structure

Keep changes localized to `src/models-dev.ts`.

Recommended helper breakdown:

- `fetchModelsDevData(config)` — orchestration, cache policy, retries
- `fetchModelsDevOnce(url, timeoutMs)` — one attempt, returning validated data or typed failure
- `shouldRetryModelsDevFailure(...)` — retry decision helper
- `sleep(ms)` — backoff helper

This keeps retry semantics independent from lookup/index logic.

### 6. Error handling model

The fetch layer should classify failures into stable categories rather than treating all failures identically.

Suggested categories:

- `timeout`
- `network`
- `http_retryable`
- `http_non_retryable`
- `parse`
- `invalid_structure`

This improves clarity of both retry decisions and logs.

## Data Flow

### Current flow

1. `getModelsDevIndex()` calls `fetchModelsDevData()`
2. one fetch attempt is made
3. any failure returns `null`
4. `buildModelsDevIndex(null)` returns `null`
5. enrichment is skipped

### Proposed flow

1. `getModelsDevIndex()` calls `fetchModelsDevData()`
2. `fetchModelsDevData()` checks fresh cache
3. if no fresh cache, it runs bounded live fetch attempts
4. if live fetch succeeds, cache is updated and returned
5. if live fetch fails and stale cache exists, stale cache is returned
6. if live fetch fails and no cache exists, `null` is returned
7. `buildModelsDevIndex(...)` uses whichever data source was successfully returned

## Testing Strategy

Add focused tests for the fetch/reliability behavior.

### Required tests

1. **fresh cache hit**
   - fetch once successfully
   - fetch again within TTL
   - assert no second network call

2. **timeout then success**
   - first attempt aborts
   - second attempt succeeds
   - assert result is returned
   - assert cache is updated

3. **retryable HTTP failure then success**
   - first attempt returns `503`
   - second attempt succeeds
   - assert retry occurs and result is returned

4. **all attempts fail with stale cache available**
   - seed cache with successful data
   - expire TTL logically or via timestamp manipulation
   - force all refresh attempts to fail
   - assert stale cache is returned

5. **all attempts fail with no cache**
   - force timeout/network failure on every attempt
   - assert `null` is returned from fetch layer

6. **non-retryable HTTP failure**
   - return `404`
   - assert fail-fast behavior without unnecessary retries

7. **invalid response structure with stale cache**
   - return structurally invalid data
   - assert stale cache fallback is used when available

### Testing notes

- tests should isolate `models.dev` behavior from `/v1/models` and combo fetch behavior
- tests should avoid depending on the real `models.dev` endpoint
- tests should verify both result behavior and retry counts

## Trade-offs

### Benefits

- much higher enrichment reliability under transient failure
- protects previously fetched enrichment data
- preserves safe fail-open behavior
- keeps scope tight and localized

### Costs

- increased worst-case latency on cold start during repeated failures
- more state transitions and test surface area
- more log volume during repeated upstream failure

Given the chosen priority of reliability first, these trade-offs are acceptable.

## Alternatives Considered

### A. Increase timeout only

Rejected because it still leaves the system single-shot and fragile.

### B. Persistent disk cache

Deferred because it adds lifecycle and invalidation complexity beyond the immediate root cause.

### C. Vendored `models.dev` snapshot

Rejected for now due to maintenance and staleness burden.

## Success Criteria

The change is successful if:

- transient `models.dev` slowness no longer frequently removes enrichment
- previously fetched enrichment survives later refresh failures within the process lifetime
- logs clearly indicate why a refresh failed and whether fallback was used
- the existing plugin behavior remains safe when upstream is fully unavailable
- tests cover timeout, retry, and stale-cache fallback paths

## Implementation Notes

This spec intentionally stops short of implementation details like exact helper signatures or test harness mechanics. Those should be finalized in the implementation plan.
