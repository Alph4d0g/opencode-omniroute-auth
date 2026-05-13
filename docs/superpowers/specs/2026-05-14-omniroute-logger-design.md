# OmniRoute Plugin Logger Design

**Date:** 2026-05-14  
**Status:** Spec Ready for Implementation  
**Topic:** Proper logging implementation for opencode-omniroute-auth plugin

## Problem Statement

The plugin currently uses `console.log` and `console.warn` for debug output, which pollutes the OpenCode terminal. We need a proper logger that:
- Writes to the OpenCode log file instead of console
- Supports debug/warn levels with environment-based toggling
- Integrates with OpenCode's existing log format

## Goals

1. Replace all `console.log`/`console.warn` calls with a proper logger
2. Write logs to OpenCode's log directory (`~/.local/share/opencode/log/`)
3. Use OpenCode's native log format with `service=omniroute`
4. Keep warnings always-on, debug opt-in via `OMNIROUTE_DEBUG` env var
5. Zero I/O overhead when debug is disabled (no-op for debug calls — no file writes, but string interpolation at call site still executes)

## Non-Goals

- Multi-level logging (error/info/debug/trace) — only warn and debug
- Log rotation or retention policies — handled by OpenCode
- Structured logging with JSON — plain text matching OpenCode format
- Configurable log destination — always OpenCode's log directory

## Architecture

### Components

#### 1. `src/logger.ts` — Logger Module

A lightweight logger that appends to the current OpenCode log file.

**Interface:**
```typescript
export function warn(message: string): void;
export function debug(message: string): void;
```

Note: Call sites must stringify any objects/arrays/errors before passing. For multi-argument calls like `console.warn(msg, errorObject)`, use template literals: `` logger.warn(`${msg}: ${errorObject}`) ``. For Error objects, use `error.message` or `error.stack` rather than `JSON.stringify(error)` (which returns `{}`).

**Call Site Audit (existing console calls to migrate):**

| File | Line | Current | New Level | Notes |
|------|------|---------|-----------|-------|
| `src/plugin.ts` | 46 | `console.warn(..., error)` | `warn` | Eager model fetch failed |
| `src/plugin.ts` | 102 | `console.log(...)` | `debug` | Available models list |
| `src/plugin.ts` | 104 | `console.warn(..., error)` | `warn` | Failed to fetch models |
| `src/plugin.ts` | 110 | `console.log(...)` | `debug` | Provider models hydrated |
| `src/plugin.ts` | 157 | `console.warn(..., error)` | `warn` | Unexpected error reading auth store |
| `src/plugin.ts` | 165 | `console.warn(...)` | `warn` | provider.api and options.apiMode differ |
| `src/plugin.ts` | 173 | `console.warn(...)` | `warn` | Unsupported provider.api value |
| `src/plugin.ts` | 189 | `console.warn(...)` | `warn` | Unsupported apiMode option |
| `src/plugin.ts` | 211 | `console.warn(...)` | `warn` | Ignoring unsupported baseURL protocol |
| `src/plugin.ts` | 217 | `console.warn(...)` | `warn` | Ignoring invalid baseURL |
| `src/plugin.ts` | 443 | `console.log(...)` | `debug` | Intercepting request |
| `src/plugin.ts` | 471 | `console.log(...)` | `debug` | Processing /v1/models response |
| `src/plugin.ts` | 521 | `console.log(...)` | `debug` | Sanitized Gemini tool schema keywords |
| `src/models.ts` | 56 | `console.log(...)` | `debug` | Using cached models |
| `src/models.ts` | 60 | `console.log(...)` | `debug` | Forcing model refresh |
| `src/models.ts` | 67 | `console.log(...)` | `debug` | Fetching models from URL |
| `src/models.ts` | 85 | `console.error(...)` | `warn` | Failed to fetch models (HTTP error) |
| `src/models.ts` | 96 | `console.error(...)` | `warn` | Invalid models response structure |
| `src/models.ts` | 131 | `console.log(...)` | `debug` | Successfully fetched N models |
| `src/models.ts` | 134 | `console.error(...)` | `warn` | Error fetching models |
| `src/models.ts` | 139 | `console.log(...)` | `debug` | Returning expired cached models |
| `src/models.ts` | 144 | `console.log(...)` | `debug` | Returning default models |
| `src/models.ts` | 161 | `console.log(...)` | `debug` | Model cache cleared (specific) |
| `src/models.ts` | 164 | `console.log(...)` | `debug` | All model caches cleared |
| `src/models-dev.ts` | 93 | `console.log(...)` | `debug` | Using cached models.dev data |
| `src/models-dev.ts` | 97 | `console.log(...)` | `debug` | Fetching models.dev data from URL |
| `src/models-dev.ts` | 112 | `console.warn(...)` | `warn` | Failed to fetch models.dev data |
| `src/models-dev.ts` | 120 | `console.warn(...)` | `warn` | Invalid models.dev data structure |
| `src/models-dev.ts` | 130 | `console.log(...)` | `debug` | Successfully fetched models.dev data |
| `src/models-dev.ts` | 133 | `console.warn(...)` | `warn` | Error fetching models.dev data |
| `src/models-dev.ts` | 208 | `console.log(...)` | `debug` | models.dev cache cleared |
| `src/omniroute-combos.ts` | 58 | `console.log(...)` | `debug` | Using cached combo data |
| `src/omniroute-combos.ts` | 63 | `console.log(...)` | `debug` | Fetching combo data from URL |
| `src/omniroute-combos.ts` | 79 | `console.warn(...)` | `warn` | Failed to fetch combo data |
| `src/omniroute-combos.ts` | 87 | `console.warn(...)` | `warn` | Invalid combo data structure |
| `src/omniroute-combos.ts` | 105 | `console.log(...)` | `debug` | Successfully fetched N combos |
| `src/omniroute-combos.ts` | 108 | `console.warn(...)` | `warn` | Error fetching combo data |
| `src/omniroute-combos.ts` | 120 | `console.log(...)` | `debug` | Combo cache cleared |
| `src/omniroute-combos.ts` | 141 | `console.log(...)` | `debug` | Resolved combo to N models |
| `src/omniroute-combos.ts` | 149 | `console.warn(...)` | `warn` | Unexpected model entry in combo |
| `src/omniroute-combos.ts` | 276 | `console.log(...)` | `debug` | Calculating capabilities for combo |
| `src/omniroute-combos.ts` | 291 | `console.warn(...)` | `warn` | Could not resolve underlying models |
| `src/omniroute-combos.ts` | 297 | `console.warn(...)` | `warn` | No models.dev matches found for combo |
| `src/omniroute-combos.ts` | 301 | `console.log(...)` | `debug` | Resolved N/N underlying models |
| `src/omniroute-combos.ts` | 306 | `console.log(...)` | `debug` | Calculated capabilities for combo |
| `src/omniroute-combos.ts` | 355 | `console.log(...)` | `debug` | Enriching combo model |

**Behavior:**
- `warn()`: Always writes to log file (unless write fails)
- `debug()`: Only writes when `OMNIROUTE_DEBUG` environment variable is exactly `"1"` (strict string comparison; all other values including `"true"`, `"yes"`, `"0"`, empty string are treated as disabled)
- Both functions use synchronous I/O (`fs.appendFileSync` wrapped in `try/catch`) for simplicity and fire-and-forget semantics

**Implementation Details:**
- Log file path is resolved once at module load and cached (wrapped in `try/catch` to prevent crash on import)
- Resolution: finds the most recent `.log` file in `~/.local/share/opencode/log/` by modification time (`mtime`)
  - Only considers regular files (not directories) via `stat.isFile()`
  - Tie-breaker: alphabetical sort if multiple files have identical `mtime`
- If no log file exists at module load, logger attempts re-scan on every `warn()` and `debug()` call (in case OpenCode creates a log file later)
- If cached file becomes unavailable (e.g., OpenCode rotated logs), falls back to re-scanning on next write failure
  - Write failures that trigger re-scan: `ENOENT` (file deleted)
  - Other failures (`EACCES`, `ENOSPC`, `EIO`): silently skip without re-scan
  - Re-scan updates the cached path; the current log call uses the newly discovered file (same-call retry)
- Appends entries in OpenCode's format: `LEVEL  ISO-TIMESTAMP +0ms service=omniroute MESSAGE`
  - `OFFSET` is hardcoded to `+0ms` to match observed OpenCode log format
- Silently fails if log file cannot be written (don't crash the plugin)
- If no log files exist, skips logging (does not create new files to avoid conflicts with OpenCode's log rotation)

#### 2. Updated Source Files

Replace console calls in all source files. Mapping rules:
- `console.log()` → `logger.debug()` (informational messages)
- `console.warn()` → `logger.warn()` (warnings)
- `console.error()` → `logger.warn()` (errors that don't stop execution — plugin continues with fallbacks)

Files to update:
- `src/plugin.ts` — 13 console statements (mix of log/warn)
- `src/models.ts` — 11 console statements (mix of log/error)
- `src/models-dev.ts` — 7 console statements (mix of log/warn)
- `src/omniroute-combos.ts` — 15 console statements (mix of log/warn)

### Log Format

Following OpenCode's existing format:

```
WARN   2026-05-14T12:34:56.789Z +0ms service=omniroute Invalid baseURL: foo://bar, using default
DEBUG  2026-05-14T12:34:56.789Z +0ms service=omniroute Available models: gpt-4o, claude-3-5-sonnet
```

Format: `{LEVEL} {ISO-TIMESTAMP} +0ms service=omniroute {MESSAGE}`
  - `LEVEL` is right-padded to 5 characters (`WARN ` or `DEBUG`)
  - Timestamp uses `Date.prototype.toISOString()` format: `YYYY-MM-DDTHH:MM:SS.sssZ` (UTC with milliseconds)
  - The `+0ms` offset is hardcoded to match observed OpenCode log format (actual offset meaning is internal to OpenCode)

### Data Flow

```
Plugin Code
    |
    v
logger.warn("Invalid baseURL")     logger.debug("Fetching models")
    |                                    |
    v                                    v
Always write                      Check OMNIROUTE_DEBUG
    |                                    |
    v                                    v
Find current log file             Find current log file
    |                                    |
    v                                    v
Append formatted entry            Append formatted entry
    |                                    |
    v                                    v
~/.local/share/opencode/log/*.log
```

### Error Handling

- **Log directory missing**: Silently skip logging (don't create directory)
- **Log directory not readable** (`EACCES`, `EPERM` on `readdirSync`): Silently skip logging
- **Log file not writable** (`EACCES`, `EPERM`): Silently skip (don't throw)
- **Log file deleted** (`ENOENT`): Trigger re-scan for new log file on next write
- **No log files exist**: Silently skip logging (don't create files to avoid conflicts with OpenCode's log rotation)
- **Disk full** (`ENOSPC`): Silently skip
- **Other I/O errors** (`EIO`, etc.): Silently skip

## Testing Strategy

### Unit Tests

1. **Debug enabled**: Set `OMNIROUTE_DEBUG=1`, call `debug()`, verify log file contains entry
2. **Debug disabled**: Unset `OMNIROUTE_DEBUG`, call `debug()`, verify no entry written
3. **Warn always**: Call `warn()` with and without `OMNIROUTE_DEBUG`, verify always written
4. **Format correct**: Verify output matches OpenCode format with `service=omniroute`
5. **Graceful failure**: Mock unreadable log directory, verify no exceptions thrown
6. **Log rotation**: Simulate OpenCode log rotation by deleting the cached log file, then call `warn()` — verify logger re-scans directory and writes to new most-recent file

### Integration Tests

1. Run plugin with `OMNIROUTE_DEBUG=1`, verify debug messages appear in latest OpenCode log
2. Run plugin without env var, verify only warnings appear

## Migration Plan

1. Create `src/logger.ts` with warn/debug functions
2. Replace console calls in `src/plugin.ts` — remove `[OmniRoute] ` prefix from messages (redundant with `service=omniroute`)
3. Replace console calls in `src/models.ts` — remove `[OmniRoute] ` prefix
4. Replace console calls in `src/models-dev.ts` — remove `[OmniRoute] ` prefix
5. Replace console calls in `src/omniroute-combos.ts` — remove `[OmniRoute] ` prefix
6. Add unit tests for logger module
7. Verify no console calls remain: `grep -En "console\.(log|warn|error)" src/`

## Open Questions

None — design approved by user.

## References

- OpenCode log format observed in `~/.local/share/opencode/log/*.log`
- Existing plugin code in `src/plugin.ts`, `src/models.ts`, `src/models-dev.ts`, `src/omniroute-combos.ts`
