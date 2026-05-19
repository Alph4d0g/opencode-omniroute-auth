# Release v1.4.1

## Highlights

- **models.dev enrichment no longer fails on transient network slowness.** The fetch pipeline now retries up to 3 times with exponential backoff and falls back to stale cached data if live refresh fails.
- **Default context limit corrected** from 4096 to 128000 tokens to match OmniRoute API behavior.
- **Structured observability** for enrichment failures with per-attempt diagnostics and fallback decisions.

## What Changed

### Reliability

- `fetchModelsDevData()` now uses a bounded retry loop:
  - Maximum 3 attempts with 250ms / 500ms backoff.
  - Retries on: timeouts (`AbortError`), network errors, HTTP 429, and HTTP 5xx.
  - Fail-fast on: HTTP 4xx (non-429) and structurally invalid responses.
- Stale in-memory cache fallback:
  - If cached data exists but TTL expired, live refresh is attempted first.
  - If all refresh attempts fail, the stale cached data is returned instead of `null`.
  - If no cache exists and all attempts fail, returns `null` (safe fail-open).
- Timeout budget increased from 1000ms to 5000ms per attempt.
- Failure classification: `timeout`, `network`, `http_retryable`, `http_non_retryable`, `parse`, `invalid_structure`.

### Fixes

- `DEFAULT_CONTEXT_LIMIT` corrected from `4096` to `128000`.

### Testing

- Added 8 focused tests in `test/models-dev.test.mjs` covering all retry, cache, and fallback paths.
- Full regression suite: 50/50 tests pass (0 failures).

### Documentation

- Added design spec: `docs/superpowers/specs/2026-05-18-models-dev-reliability-design.md`.

## Verification

- `npm run prepublishOnly` passes (`clean`, `build`, `check:exports`).
- `npm test` passes: 50 tests, 0 failures.
- TypeScript strict mode compiles cleanly.

## Upgrade Notes

- No breaking changes. Plugin behavior remains safe when `models.dev` is fully unavailable.
- Existing `modelsDev.timeoutMs` and `modelsDev.cacheTtl` config options continue to work as before.
