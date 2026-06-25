import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, utimesSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

function getDummyBaseUrl(port = 20128) {
  return `http://localhost:${port}/v1`;
}

test('config hook warns when provider npm conflicts with apiMode', async () => {
  const dataHome = join(tmpdir(), `opencode-npm-warn-${Date.now()}`);
  process.env.XDG_DATA_HOME = dataHome;
  const logDir = join(dataHome, 'opencode', 'log');
  const logFile = join(logDir, 'omniroute.log');
  mkdirSync(logDir, { recursive: true });
  writeFileSync(logFile, '');
  // Ensure this file is selected by the logger's mtime-based picker.
  utimesSync(logFile, Date.now() / 1000, (Date.now() / 1000) + 1000);

  const { default: OmniRouteAuthPlugin } = await import('../dist/index.js');
  const plugin = await OmniRouteAuthPlugin({});
  const config = {
    provider: {
      omniroute: {
        npm: '@ai-sdk/openai-compatible',
        options: {
          baseURL: getDummyBaseUrl(),
          apiMode: 'responses',
        },
      },
    },
  };

  await plugin.config(config);

  await new Promise((resolve) => setTimeout(resolve, 50));
  const logContent = readFileSync(logFile, 'utf-8');
  assert.ok(
    logContent.includes('provider.npm') && logContent.includes('@ai-sdk/openai-compatible'),
    'expected warning about npm/apiMode conflict in log file',
  );
});
