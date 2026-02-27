# Agent Guidelines for opencode-omniroute-auth

This file provides guidelines for AI agents operating in this repository.

## Overview
OpenCode authentication plugin for the OmniRoute API. Features `/connect` command setup, API key auth, dynamic model fetching (`/v1/models`), and TTL caching.

## Commands

### Build & Development
```bash
npm install           # Install dependencies
npm run build         # Build the project (TypeScript compilation)
npm run dev           # Watch mode for development
npm run clean         # Clean build output
npm run prepublishOnly # Build before publishing
```

### Single File Build / Type-Check
```bash
npx tsc --noEmit src/plugin.ts  # Type-check a single file
npx tsc --build --verbose       # Build with verbose output
```

### Testing
*Note: No test suite currently exists. When implemented, use:*
```bash
npm test                      # Run all tests
npx jest src/plugin.test.ts   # Run a single test file
npm run test:watch            # Run tests in watch mode
```

## Code Style Guidelines

### TypeScript & Formatting
- **Target**: ES2022, **Module**: NodeNext (ESM).
- **Strict Mode**: Enabled. Never disable strict checks.
- **Formatting**: 2 spaces, max 100 chars/line, semicolons required, **single quotes** for strings, trailing commas in multi-line objects/arrays.

### Naming Conventions
- **Constants**: `UPPER_SNAKE_CASE` (e.g., `OMNIROUTE_PROVIDER_ID`)
- **Variables/Functions**: `camelCase` (e.g., `modelCache`, `fetchModels()`)
- **Classes/Interfaces/Types**: `PascalCase` (e.g., `OmniRouteConfig`)
- **Files**: `kebab-case` (e.g., `opencode-plugin.d.ts`)

### Imports
- **CRITICAL**: Always use explicit `.js` extensions for relative imports (e.g., `import { x } from './file.js'`).
- Group imports: external → internal → types.
- Use named exports only (no default exports).

### Type Safety
- **Never use `any`**. Use `unknown` if uncertain, then narrow.
- Always type function parameters and return types.
- **Prefer runtime validation** over unsafe type assertions.
```typescript
// ✅ Correct
const rawData = await response.json();
if (!rawData || typeof rawData !== 'object' || !Array.isArray(rawData.data)) {
  throw new Error('Invalid response structure');
}
const data = rawData as OmniRouteModelsResponse;
```

### Error Handling & Logging
- Always use `try/catch/finally` for resource cleanup (e.g., `clearTimeout`).
- Provide meaningful error messages.
- **Security**: Sanitize error logs. Never log full API responses or sensitive keys (e.g., log "Cache cleared for provided config" instead of logging the API key).
```typescript
// ✅ Correct
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
try {
  const response = await fetch(url, { signal: controller.signal });
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  return await response.json();
} finally {
  clearTimeout(timeoutId);
}
```

### Headers & URL Handling
- **Headers**: Use the `Headers` constructor for proper normalization.
  ```typescript
  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${apiKey}`);
  ```
- **URLs**: Handle both `Request` objects and string URLs safely.
  ```typescript
  const url = input instanceof Request ? input.url : input.toString();
  ```
- **Security**: When intercepting requests, ensure `baseUrl` ends with a slash for safe prefix matching to prevent domain spoofing. Validate endpoint URLs strictly (require `http:` or `https:`).

## Project Structure
- `src/plugin.ts`: Main plugin implementation & `/connect` command.
- `src/models.ts`: Model fetching, caching, and validation.
- `src/constants.ts`: Configuration constants (`OMNIROUTE_ENDPOINTS`, etc.).
- `src/types.ts`: TypeScript definitions.
- `index.ts`: Main exports.

## Common Tasks
- **Adding Exports**: Add in source file, re-export in `index.ts` (with `.js`), run `npm run build`.
- **Debugging**: Look for `[OmniRoute]` prefix in console logs.
