# OmniRoute Plugin Logger Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all console.log/console.warn calls with a proper logger that writes to OpenCode's log file, controlled by OMNIROUTE_DEBUG env var.

**Architecture:** Create a lightweight logger module (`src/logger.ts`) that appends to the current OpenCode log file. Warn always writes; debug only writes when OMNIROUTE_DEBUG=1. Replace all console calls across 4 source files.

**Tech Stack:** TypeScript, Node.js fs module, native fetch (for tests)

---

## File Structure

**New files:**
- `src/logger.ts` — Logger module with warn/debug functions
- `test/logger.test.mjs` — Unit tests for logger

**Modified files:**
- `src/plugin.ts` — Replace 13 console calls with logger
- `src/models.ts` — Replace 11 console calls with logger
- `src/models-dev.ts` — Replace 7 console calls with logger
- `src/omniroute-combos.ts` — Replace 15 console calls with logger

---

## Chunk 1: Logger Module

### Task 1: Create Logger Module

**Files:**
- Create: `src/logger.ts`
- Test: `test/logger.test.mjs`

**Behavior:**
- `warn(message: string)`: Always appends to log file (unless I/O fails)
- `debug(message: string)`: Only appends when `OMNIROUTE_DEBUG === "1"`
- Log format: `WARN  2026-05-14T12:34:56.789Z +0ms service=omniroute message`
- Log file: most recent `.log` file in `~/.local/share/opencode/log/`
- Silently fail on all I/O errors (don't crash plugin)
- Cache log file path at module load, re-scan on ENOENT

- [ ] **Step 1: Write failing tests for logger**

```javascript
import { test } from 'node:test';
import assert from 'node:assert';
import { writeFileSync, readFileSync, mkdirSync, rmSync, statSync, utimesSync, chmodSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_LOG_DIR = join(__dirname, 'test-logs');

// Set up isolated test environment
process.env.XDG_DATA_HOME = join(TEST_LOG_DIR, 'data');
const LOG_DIR = join(TEST_LOG_DIR, 'data', 'opencode', 'log');

// Helper to create a test log file with most recent mtime
function createTestLogFile(name) {
  const path = join(LOG_DIR, name);
  mkdirSync(LOG_DIR, { recursive: true });
  writeFileSync(path, '');
  // Set mtime to now + 1s to ensure it's the most recent
  const now = Date.now() / 1000;
  utimesSync(path, now, now + 1);
  return path;
}

// Cleanup before and after tests
function cleanupTestLogs() {
  try {
    const files = readdirSync(LOG_DIR);
    for (const file of files) {
      if (file.startsWith('test-')) {
        rmSync(join(LOG_DIR, file));
      }
    }
  } catch {}
}

// Run cleanup before all tests
cleanupTestLogs();

// Run cleanup after all tests (using process.on since node:test doesn't have global after)
process.on('exit', cleanupTestLogs);

test('warn() writes to log file with correct format', async () => {
  const testLogFile = createTestLogFile('test-warn.log');
  
  // Import fresh logger module with cache buster
  const { warn } = await import(`../dist/src/logger.js?v=${Date.now()}`);
  
  warn('Test warning message');
  
  const content = readFileSync(testLogFile, 'utf-8');
  assert.ok(content.includes('Test warning message'), 'warn should write message');
  assert.ok(content.includes('WARN'), 'log should have WARN level');
  assert.ok(content.includes('service=omniroute'), 'log should include service tag');
  assert.ok(content.includes('+0ms'), 'log should include +0ms offset');
  assert.match(content, /^(WARN|DEBUG)\s+\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z \+0ms service=omniroute .+$/m, 'log format should match spec');
  
  rmSync(testLogFile);
});

test('debug() writes when OMNIROUTE_DEBUG=1', async () => {
  const testLogFile = createTestLogFile('test-debug-enabled.log');
  process.env.OMNIROUTE_DEBUG = '1';
  
  // Import fresh module to pick up env var
  const { debug } = await import('../dist/src/logger.js?cache=' + Date.now());
  
  debug('Test debug message');
  
  const content = readFileSync(testLogFile, 'utf-8');
  assert.ok(content.includes('Test debug message'), 'debug should write when enabled');
  assert.ok(content.includes('DEBUG'), 'log should have DEBUG level');
  
  delete process.env.OMNIROUTE_DEBUG;
  rmSync(testLogFile);
});

test('debug() does not write when OMNIROUTE_DEBUG is not set', async () => {
  const testLogFile = createTestLogFile('test-debug-disabled.log');
  delete process.env.OMNIROUTE_DEBUG;
  
  const { debug } = await import(`../dist/src/logger.js?v=${Date.now()}`);
  
  debug('Test debug message');
  
  const content = readFileSync(testLogFile, 'utf-8');
  assert.strictEqual(content, '', 'debug should not write when disabled');
  
  rmSync(testLogFile);
});

test('debug() does not write when OMNIROUTE_DEBUG is "true"', async () => {
  const testLogFile = createTestLogFile('test-debug-true.log');
  process.env.OMNIROUTE_DEBUG = 'true';
  
  const { debug } = await import(`../dist/src/logger.js?v=${Date.now()}`);
  
  debug('Test debug message');
  
  const content = readFileSync(testLogFile, 'utf-8');
  assert.strictEqual(content, '', 'debug should not write when OMNIROUTE_DEBUG is "true"');
  
  delete process.env.OMNIROUTE_DEBUG;
  rmSync(testLogFile);
});

test('debug() does not write when OMNIROUTE_DEBUG is "0"', async () => {
  const testLogFile = createTestLogFile('test-debug-zero.log');
  process.env.OMNIROUTE_DEBUG = '0';
  
  const { debug } = await import(`../dist/src/logger.js?v=${Date.now()}`);
  
  debug('Test debug message');
  
  const content = readFileSync(testLogFile, 'utf-8');
  assert.strictEqual(content, '', 'debug should not write when OMNIROUTE_DEBUG is "0"');
  
  delete process.env.OMNIROUTE_DEBUG;
  rmSync(testLogFile);
});

test('warn() always writes regardless of OMNIROUTE_DEBUG', async () => {
  const testLogFile = createTestLogFile('test-warn-always.log');
  delete process.env.OMNIROUTE_DEBUG;
  
  const { warn } = await import('../dist/src/logger.js?cache=' + Date.now());
  
  warn('Test warning message');
  
  const content = readFileSync(testLogFile, 'utf-8');
  assert.ok(content.includes('Test warning message'), 'warn should always write');
  
  rmSync(testLogFile);
});

test('logger handles missing log directory gracefully', async () => {
  const originalXdg = process.env.XDG_DATA_HOME;
  try {
    process.env.XDG_DATA_HOME = '/nonexistent/path';
    
    const { warn } = await import('../dist/src/logger.js?cache=' + Date.now());
    
    // Should not throw
    warn('Test message');
  } finally {
    process.env.XDG_DATA_HOME = originalXdg;
  }
});

test('logger handles log file rotation', async () => {
  const oldLogFile = createTestLogFile('test-old.log');
  
  const { warn } = await import(`../dist/src/logger.js?v=${Date.now()}`);
  warn('First message');
  
  // Simulate log rotation: delete old file, create new one
  rmSync(oldLogFile);
  const newLogFile = createTestLogFile('test-new.log');
  
  warn('Second message after rotation');
  
  const content = readFileSync(newLogFile, 'utf-8');
  assert.ok(content.includes('Second message after rotation'), 'should write to new log file after rotation');
  
  rmSync(newLogFile);
});

test('logger re-scans when no log file exists at module load', async () => {
  // Ensure no test log files exist in LOG_DIR
  cleanupTestLogs();
  
  // Import logger when no log file exists
  const { warn } = await import(`../dist/src/logger.js?v=${Date.now()}`);
  
  // Create log file after module load
  const testLogFile = createTestLogFile('test-rescan.log');
  
  warn('Message after log file created');
  
  const content = readFileSync(testLogFile, 'utf-8');
  assert.ok(content.includes('Message after log file created'), 'should re-scan and write to new log file');
  
  rmSync(testLogFile);
});

test('logger silently skips on non-ENOENT write errors', async () => {
  // Create a read-only log file (skip on Windows where chmod behaves differently)
  if (process.platform === 'win32') {
    return;
  }
  
  const testLogFile = createTestLogFile('test-readonly.log');
  chmodSync(testLogFile, 0o444);
  
  const { warn } = await import(`../dist/src/logger.js?v=${Date.now()}`);
  
  // Should not throw even though file is read-only
  warn('Test read-only message');
  
  // Restore permissions and verify nothing was written
  chmodSync(testLogFile, 0o644);
  const content = readFileSync(testLogFile, 'utf-8');
  assert.strictEqual(content, '', 'should not write to read-only file');
  
  rmSync(testLogFile);
});

test('logger silently skips on unreadable log directory', async () => {
  // Skip on Windows where chmod behaves differently
  if (process.platform === 'win32') {
    return;
  }
  
  // Create a log directory that is not readable
  const unreadableDir = join(TEST_LOG_DIR, 'unreadable');
  const logSubdir = join(unreadableDir, 'opencode', 'log');
  mkdirSync(logSubdir, { recursive: true });
  
  const originalXdg = process.env.XDG_DATA_HOME;
  try {
    process.env.XDG_DATA_HOME = unreadableDir;
    chmodSync(logSubdir, 0o000);
    
    const { warn } = await import(`../dist/src/logger.js?v=${Date.now()}`);
    
    // Should not throw even though directory is unreadable
    warn('Test unreadable directory');
  } finally {
    process.env.XDG_DATA_HOME = originalXdg;
    chmodSync(logSubdir, 0o755);
    rmSync(unreadableDir, { recursive: true });
  }
});

test('logger excludes directories with .log suffix', async () => {
  // Create a directory named like a log file
  const fakeDir = join(LOG_DIR, 'fake-dir.log');
  mkdirSync(fakeDir, { recursive: true });
  
  // Create a real log file
  const testLogFile = createTestLogFile('test-real.log');
  
  const { warn } = await import(`../dist/src/logger.js?v=${Date.now()}`);
  warn('Test directory exclusion');
  
  const content = readFileSync(testLogFile, 'utf-8');
  assert.ok(content.includes('Test directory exclusion'), 'should write to real log file, not directory');
  
  rmSync(testLogFile);
  rmSync(fakeDir, { recursive: true });
});

test('logger uses alphabetical tie-breaker for identical mtime', async () => {
  // Create two log files with identical mtime
  const fileA = join(LOG_DIR, 'test-alpha.log');
  const fileB = join(LOG_DIR, 'test-beta.log');
  mkdirSync(LOG_DIR, { recursive: true });
  writeFileSync(fileA, '');
  writeFileSync(fileB, '');
  const now = Date.now() / 1000;
  utimesSync(fileA, now, now);
  utimesSync(fileB, now, now);
  
  const { warn } = await import(`../dist/src/logger.js?v=${Date.now()}`);
  warn('Test tie-breaker');
  
  // Should write to test-alpha.log (alphabetically first)
  const contentA = readFileSync(fileA, 'utf-8');
  const contentB = readFileSync(fileB, 'utf-8');
  assert.ok(contentA.includes('Test tie-breaker'), 'should write to alphabetically first file');
  assert.strictEqual(contentB, '', 'should not write to second file');
  
  rmSync(fileA);
  rmSync(fileB);
});
```

Run: `node --test test/logger.test.mjs`
Expected: FAIL - logger module doesn't exist

- [ ] **Step 2: Create logger.ts**

```typescript
import { appendFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const LOG_DIR = join(process.env.XDG_DATA_HOME || join(process.env.HOME || homedir(), '.local', 'share'), 'opencode', 'log');

function findCurrentLogFile(): string | null {
  try {
    if (!existsSync(LOG_DIR)) return null;
    
    const files = readdirSync(LOG_DIR)
      .filter(f => f.endsWith('.log'))
      .map(f => {
        const path = join(LOG_DIR, f);
        const stat = statSync(path);
        return { path, mtime: stat.mtime.getTime(), isFile: stat.isFile() };
      })
      .filter(f => f.isFile)
      .sort((a, b) => b.mtime - a.mtime || a.path.localeCompare(b.path));
    
    return files[0]?.path ?? null;
  } catch {
    return null;
  }
}

// Resolve log file path at module load (wrapped in try/catch per spec)
let cachedLogFile: string | null;
try {
  cachedLogFile = findCurrentLogFile();
} catch {
  cachedLogFile = null;
}

function getLogFile(): string | null {
  if (cachedLogFile === null) {
    // Re-scan if no file found at module load (OpenCode may create one later)
    cachedLogFile = findCurrentLogFile();
  }
  return cachedLogFile;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as NodeJS.ErrnoException).code === 'string'
  );
}

function writeLog(level: string, message: string): void {
  const logFile = getLogFile();
  if (!logFile) return;
  
  const timestamp = new Date().toISOString();
  const line = `${level.padEnd(5)} ${timestamp} +0ms service=omniroute ${message}\n`;
  
  try {
    appendFileSync(logFile, line);
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      // Log file was deleted, re-scan
      cachedLogFile = findCurrentLogFile();
      // Retry once with new file
      const newLogFile = cachedLogFile;
      if (newLogFile) {
        try {
          appendFileSync(newLogFile, line);
        } catch {
          // Silently fail on second attempt
        }
      }
    }
    // Silently fail for all other errors
  }
}

export function warn(message: string): void {
  writeLog('WARN', message);
}

export function debug(message: string): void {
  // Strict comparison: only "1" enables debug logging
  if (process.env.OMNIROUTE_DEBUG !== '1') return;
  writeLog('DEBUG', message);
}
```

- [ ] **Step 3: Build and run tests**

Run: `npm run build && node --test test/logger.test.mjs`
Expected: Tests pass

- [ ] **Step 4: Commit**

```bash
git add src/logger.ts test/logger.test.mjs
git commit -m "feat: add logger module with warn/debug levels"
```

---

## Chunk 2: Replace Console Calls in plugin.ts

### Task 2: Migrate plugin.ts

**Files:**
- Modify: `src/plugin.ts`

- [ ] **Step 1: Add logger import**

Add at top of file:
```typescript
import { warn, debug } from './logger.js';
```

- [ ] **Step 2: Replace console calls**

Replace each console call (remove `[OmniRoute] ` prefix):

Line 46: `console.warn('[OmniRoute] Eager model fetch failed, using defaults:', error)`
→ `warn(\`Eager model fetch failed, using defaults: ${error}\`)`

Line 102: `console.log(\`[OmniRoute] Available models: ${models.map((model) => model.id).join(', ')}\`)`
→ `debug(\`Available models: ${models.map((model) => model.id).join(', ')}\`)`

Line 104: `console.warn('[OmniRoute] Failed to fetch models, using defaults:', error)`
→ `warn(\`Failed to fetch models, using defaults: ${error}\`)`

Line 110: `console.log(\`[OmniRoute] Provider models hydrated: ${Object.keys(provider.models).length}\`)`
→ `debug(\`Provider models hydrated: ${Object.keys(provider.models).length}\`)`

Line 157: `console.warn('[OmniRoute] Unexpected error reading auth store:', error)`
→ `warn(\`Unexpected error reading auth store: ${error}\`)`

Line 165-166: `console.warn(...)`
→ `warn('provider.api and options.apiMode differ; using options.apiMode')`

Line 173: `console.warn(...)`
→ `warn(\`Unsupported provider.api value. Using ${apiMode}.\`)`

Line 189: `console.warn(...)`
→ `warn('Unsupported apiMode option. Using chat.')`

Line 211: `console.warn(...)`
→ `warn(\`Ignoring unsupported baseURL protocol: ${parsed.protocol}\`)`

Line 217: `console.warn(...)`
→ `warn(\`Ignoring invalid baseURL: ${trimmed}\`)`

Line 443: `console.log(...)`
→ `debug(\`Intercepting request to ${url}\`)`

Line 471: `console.log(...)`
→ `debug('Processing /v1/models response')`

Line 521: `console.log(...)`
→ `debug('Sanitized Gemini tool schema keywords')`

- [ ] **Step 3: Build and verify**

Run: `npm run build`
Expected: No TypeScript errors

- [ ] **Step 4: Commit**

```bash
git add src/plugin.ts
git commit -m "refactor: replace console calls with logger in plugin.ts"
```

---

## Chunk 3: Replace Console Calls in models.ts

### Task 3: Migrate models.ts

**Files:**
- Modify: `src/models.ts`

- [ ] **Step 1: Add logger import**

```typescript
import { warn, debug } from './logger.js';
```

- [ ] **Step 2: Replace console calls**

Line 56: `console.log('[OmniRoute] Using cached models')`
→ `debug('Using cached models')`

Line 60: `console.log('[OmniRoute] Forcing model refresh')`
→ `debug('Forcing model refresh')`

Line 67: `console.log(\`[OmniRoute] Fetching models from ${modelsUrl}\`)`
→ `debug(\`Fetching models from ${modelsUrl}\`)`

Line 85-87: `console.error(...)`
→ `warn(\`Failed to fetch models: ${response.status} ${response.statusText}\`)`

Line 96: `console.error('[OmniRoute] Invalid models response structure:', rawData)`
→ `warn(\`Invalid models response structure: ${JSON.stringify(rawData)}\`)`

Line 131: `console.log(\`[OmniRoute] Successfully fetched ${models.length} models\`)`
→ `debug(\`Successfully fetched ${models.length} models\`)`

Line 134: `console.error('[OmniRoute] Error fetching models:', error)`
→ `warn(\`Error fetching models: ${error}\`)`

Line 139: `console.log('[OmniRoute] Returning expired cached models as fallback')`
→ `debug('Returning expired cached models as fallback')`

Line 144: `console.log('[OmniRoute] Returning default models as fallback')`
→ `debug('Returning default models as fallback')`

Line 161: `console.log('[OmniRoute] Model cache cleared for provided configuration')`
→ `debug('Model cache cleared for provided configuration')`

Line 164: `console.log('[OmniRoute] All model caches cleared')`
→ `debug('All model caches cleared')`

- [ ] **Step 3: Build and verify**

Run: `npm run build`
Expected: No TypeScript errors

- [ ] **Step 4: Commit**

```bash
git add src/models.ts
git commit -m "refactor: replace console calls with logger in models.ts"
```

---

## Chunk 4: Replace Console Calls in models-dev.ts

### Task 4: Migrate models-dev.ts

**Files:**
- Modify: `src/models-dev.ts`

- [ ] **Step 1: Add logger import**

```typescript
import { warn, debug } from './logger.js';
```

- [ ] **Step 2: Replace console calls**

Line 93: `console.log('[OmniRoute] Using cached models.dev data')`
→ `debug('Using cached models.dev data')`

Line 97: `console.log(\`[OmniRoute] Fetching models.dev data from ${url}\`)`
→ `debug(\`Fetching models.dev data from ${url}\`)`

Line 112: `console.warn(\`[OmniRoute] Failed to fetch models.dev data: ${response.status}\`)`
→ `warn(\`Failed to fetch models.dev data: ${response.status}\`)`

Line 120: `console.warn('[OmniRoute] Invalid models.dev data structure')`
→ `warn('Invalid models.dev data structure')`

Line 130: `console.log('[OmniRoute] Successfully fetched models.dev data')`
→ `debug('Successfully fetched models.dev data')`

Line 133: `console.warn('[OmniRoute] Error fetching models.dev data:', error)`
→ `warn(\`Error fetching models.dev data: ${error}\`)`

Line 208: `console.log('[OmniRoute] models.dev cache cleared')`
→ `debug('models.dev cache cleared')`

- [ ] **Step 3: Build and verify**

Run: `npm run build`
Expected: No TypeScript errors

- [ ] **Step 4: Commit**

```bash
git add src/models-dev.ts
git commit -m "refactor: replace console calls with logger in models-dev.ts"
```

---

## Chunk 5: Replace Console Calls in omniroute-combos.ts

### Task 5: Migrate omniroute-combos.ts

**Files:**
- Modify: `src/omniroute-combos.ts`

- [ ] **Step 1: Add logger import**

```typescript
import { warn, debug } from './logger.js';
```

- [ ] **Step 2: Replace console calls**

Line 58: `console.log('[OmniRoute] Using cached combo data')`
→ `debug('Using cached combo data')`

Line 63: `console.log(\`[OmniRoute] Fetching combo data from ${combosUrl}\`)`
→ `debug(\`Fetching combo data from ${combosUrl}\`)`

Line 79: `console.warn(\`[OmniRoute] Failed to fetch combo data: ${response.status}\`)`
→ `warn(\`Failed to fetch combo data: ${response.status}\`)`

Line 87: `console.warn('[OmniRoute] Invalid combo data structure')`
→ `warn('Invalid combo data structure')`

Line 105: `console.log(\`[OmniRoute] Successfully fetched ${comboMap.size} combos\`)`
→ `debug(\`Successfully fetched ${comboMap.size} combos\`)`

Line 108: `console.warn('[OmniRoute] Error fetching combo data:', error)`
→ `warn(\`Error fetching combo data: ${error}\`)`

Line 120: `console.log('[OmniRoute] Combo cache cleared')`
→ `debug('Combo cache cleared')`

Line 141: `console.log(\`[OmniRoute] Resolved combo "${modelId}" to ${combo.models.length} underlying models\`)`
→ `debug(\`Resolved combo "${modelId}" to ${combo.models.length} underlying models\`)`

Line 149: `console.warn('[OmniRoute] Unexpected model entry in combo:', m)`
→ `warn(\`Unexpected model entry in combo: ${JSON.stringify(m)}\`)`

Line 276: `console.log(\`[OmniRoute] Calculating capabilities for combo "${model.id}" from ${underlyingModels.length} models\`)`
→ `debug(\`Calculating capabilities for combo "${model.id}" from ${underlyingModels.length} models\`)`

Line 291-293: `console.warn(...)`
→ `warn(\`Could not resolve ${unresolvedModels.length} underlying models for "${model.id}": ${unresolvedModels.join(', ')}\`)`

Line 297: `console.warn(\`[OmniRoute] No models.dev matches found for combo "${model.id}"\`)`
→ `warn(\`No models.dev matches found for combo "${model.id}"\`)`

Line 301: `console.log(\`[OmniRoute] Resolved ${resolvedModels.length}/${underlyingModels.length} underlying models for "${model.id}"\`)`
→ `debug(\`Resolved ${resolvedModels.length}/${underlyingModels.length} underlying models for "${model.id}"\`)`

Line 306-308: `console.log(...)`
→ `debug(\`Calculated capabilities for "${model.id}": context=${capabilities.contextWindow ?? 'N/A'}, maxTokens=${capabilities.maxTokens ?? 'N/A'}, vision=${capabilities.supportsVision ?? false}, tools=${capabilities.supportsTools ?? false}\`)`

Line 355: `console.log(\`[OmniRoute] Enriching combo model: ${model.id}\`)`
→ `debug(\`Enriching combo model: ${model.id}\`)`

- [ ] **Step 3: Build and verify**

Run: `npm run build`
Expected: No TypeScript errors

- [ ] **Step 4: Commit**

```bash
git add src/omniroute-combos.ts
git commit -m "refactor: replace console calls with logger in omniroute-combos.ts"
```

---

## Chunk 6: Final Verification

### Task 6: Verify No Console Calls Remain

- [ ] **Step 1: Run grep to find any remaining console calls**

```bash
grep -En "console\.(log|warn|error)" src/
```

Expected: No output (no matches)

- [ ] **Step 2: Run full test suite**

```bash
npm test
```

Expected: All tests pass (or same failures as baseline)

- [ ] **Step 3: Manual verification**

Run plugin with OMNIROUTE_DEBUG=1 and verify debug messages appear in latest OpenCode log:
```bash
OMNIROUTE_DEBUG=1 npm test
```

Check log file:
```bash
tail -20 ~/.local/share/opencode/log/$(ls -t ~/.local/share/opencode/log/*.log | head -1)
```

Expected: See DEBUG entries with `service=omniroute`

- [ ] **Step 4: Commit**

```bash
git commit -m "chore: verify no console calls remain"
```

---

## Completion Checklist

- [ ] `src/logger.ts` created with warn/debug functions
- [ ] `test/logger.test.mjs` created with unit tests
- [ ] All console calls removed from `src/plugin.ts`
- [ ] All console calls removed from `src/models.ts`
- [ ] All console calls removed from `src/models-dev.ts`
- [ ] All console calls removed from `src/omniroute-combos.ts`
- [ ] Build passes without errors
- [ ] Tests pass (or match baseline)
- [ ] Manual verification shows logs in OpenCode log file
