import { test } from 'node:test';
import assert from 'node:assert';
import {
  writeFileSync,
  readFileSync,
  mkdirSync,
  rmSync,
  statSync,
  utimesSync,
  chmodSync,
  readdirSync,
} from 'fs';
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
  const { warn } = await import(`../dist/src/logger.js#${Date.now()}-${Math.random()}-${Math.random()}`);

  warn('Test warning message');

  const content = readFileSync(testLogFile, 'utf-8');
  assert.ok(content.includes('Test warning message'), 'warn should write message');
  assert.ok(content.includes('WARN'), 'log should have WARN level');
  assert.ok(content.includes('service=omniroute'), 'log should include service tag');
  assert.ok(content.includes('+0ms'), 'log should include +0ms offset');
  assert.match(
    content,
    /^(WARN|DEBUG)\s+\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z \+0ms service=omniroute .+$/m,
    'log format should match spec'
  );

  rmSync(testLogFile);
});

test('debug() writes when OMNIROUTE_DEBUG=1', async () => {
  const testLogFile = createTestLogFile('test-debug-enabled.log');
  process.env.OMNIROUTE_DEBUG = '1';

  // Import fresh module to pick up env var
  const { debug } = await import('../dist/src/logger.js#' + Date.now() + '-' + Math.random());

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

  const { debug } = await import(`../dist/src/logger.js#${Date.now()}-${Math.random()}`);

  debug('Test debug message');

  const content = readFileSync(testLogFile, 'utf-8');
  assert.strictEqual(content, '', 'debug should not write when disabled');

  rmSync(testLogFile);
});

test('debug() does not write when OMNIROUTE_DEBUG is "true"', async () => {
  const testLogFile = createTestLogFile('test-debug-true.log');
  process.env.OMNIROUTE_DEBUG = 'true';

  const { debug } = await import(`../dist/src/logger.js#${Date.now()}-${Math.random()}`);

  debug('Test debug message');

  const content = readFileSync(testLogFile, 'utf-8');
  assert.strictEqual(content, '', 'debug should not write when OMNIROUTE_DEBUG is "true"');

  delete process.env.OMNIROUTE_DEBUG;
  rmSync(testLogFile);
});

test('debug() does not write when OMNIROUTE_DEBUG is "0"', async () => {
  const testLogFile = createTestLogFile('test-debug-zero.log');
  process.env.OMNIROUTE_DEBUG = '0';

  const { debug } = await import(`../dist/src/logger.js#${Date.now()}-${Math.random()}`);

  debug('Test debug message');

  const content = readFileSync(testLogFile, 'utf-8');
  assert.strictEqual(content, '', 'debug should not write when OMNIROUTE_DEBUG is "0"');

  delete process.env.OMNIROUTE_DEBUG;
  rmSync(testLogFile);
});

test('warn() always writes regardless of OMNIROUTE_DEBUG', async () => {
  const testLogFile = createTestLogFile('test-warn-always.log');
  delete process.env.OMNIROUTE_DEBUG;

  const { warn } = await import('../dist/src/logger.js#' + Date.now() + '-' + Math.random());

  warn('Test warning message');

  const content = readFileSync(testLogFile, 'utf-8');
  assert.ok(content.includes('Test warning message'), 'warn should always write');

  rmSync(testLogFile);
});

test('logger handles missing log directory gracefully', async () => {
  const originalXdg = process.env.XDG_DATA_HOME;
  try {
    process.env.XDG_DATA_HOME = '/nonexistent/path';

    const { warn } = await import('../dist/src/logger.js#' + Date.now() + '-' + Math.random());

    // Should not throw
    warn('Test message');
  } finally {
    process.env.XDG_DATA_HOME = originalXdg;
  }
});

test('logger handles log file rotation', async () => {
  const oldLogFile = createTestLogFile('test-old.log');

  const { warn } = await import(`../dist/src/logger.js#${Date.now()}-${Math.random()}`);
  warn('First message');

  // Simulate log rotation: delete old file, create new one
  rmSync(oldLogFile);
  const newLogFile = createTestLogFile('test-new.log');

  warn('Second message after rotation');

  const content = readFileSync(newLogFile, 'utf-8');
  assert.ok(
    content.includes('Second message after rotation'),
    'should write to new log file after rotation'
  );

  rmSync(newLogFile);
});

test('logger re-scans when no log file exists at module load', async () => {
  // Ensure no test log files exist in LOG_DIR
  cleanupTestLogs();

  // Import logger when no log file exists
  const { warn } = await import(`../dist/src/logger.js#${Date.now()}-${Math.random()}`);

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

  const { warn } = await import(`../dist/src/logger.js#${Date.now()}-${Math.random()}`);

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

    const { warn } = await import(`../dist/src/logger.js#${Date.now()}-${Math.random()}`);

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

  const { warn } = await import(`../dist/src/logger.js#${Date.now()}-${Math.random()}`);
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

  const { warn } = await import(`../dist/src/logger.js#${Date.now()}-${Math.random()}`);
  warn('Test tie-breaker');

  // Should write to test-alpha.log (alphabetically first)
  const contentA = readFileSync(fileA, 'utf-8');
  const contentB = readFileSync(fileB, 'utf-8');
  assert.ok(contentA.includes('Test tie-breaker'), 'should write to alphabetically first file');
  assert.strictEqual(contentB, '', 'should not write to second file');

  rmSync(fileA);
  rmSync(fileB);
});
