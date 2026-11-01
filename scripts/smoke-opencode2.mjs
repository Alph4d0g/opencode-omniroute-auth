import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = await mkdtemp(join(tmpdir(), 'omniroute-opencode2-'));
const requests = [];
let backend;
let backendOutput = '';
const executable = process.env.OPENCODE2_BIN || (process.platform === 'win32'
  ? join(process.env.APPDATA, 'npm', 'node_modules', '@opencode', 'cli', 'bin', 'opencode.exe')
  : 'opencode2');
const server = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString();
  requests.push({
    url: request.url, auth: request.headers.authorization,
    gateway: request.headers['x-smoke-gateway'], body: text,
  });
  if (request.headers['x-smoke-gateway'] !== 'gateway-test') {
    response.writeHead(403).end();
    return;
  }
  if (request.url === '/v1/models') {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ data: [{
      id: 'gemini-smoke', name: 'OmniRoute V2 smoke', contextWindow: 128000,
      maxTokens: 4096, supportsTools: true,
    }] }));
    return;
  }
  if (request.url === '/api/combos' || request.url === '/v1/combos') {
    response.setHeader('Content-Type', 'application/json');
    response.end('{"combos":[]}');
    return;
  }
  if (request.url === '/v1/chat/completions') {
    response.setHeader('Content-Type', 'text/event-stream');
    const chunk = (delta, finish_reason = null) => ({
      id: 'smoke', object: 'chat.completion.chunk', created: 1, model: 'gemini-smoke',
      choices: [{ index: 0, delta, finish_reason }],
    });
    response.end([
      chunk({ role: 'assistant', content: 'OMNIROUTE_V2_OK' }),
      chunk({}, 'stop'),
    ].map((item) => `data: ${JSON.stringify(item)}\n\n`).join('') + 'data: [DONE]\n\n');
    return;
  }
  response.writeHead(404).end();
});

function run(args, env) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(executable, args, { cwd: directory, env, windowsHide: true });
    child.stdin.end();
    let output = '';
    const timer = setTimeout(() => {
      void stop(child);
      reject(new Error(`OpenCode V2 timed out: ${args.join(' ')}\n${output}`));
    }, 60000);
    child.stdout.on('data', (data) => { output += data; });
    child.stderr.on('data', (data) => { output += data; });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`OpenCode V2 exited ${code}: ${output}`));
      else resolveRun(output);
    });
  });
}

async function stop(child) {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    await new Promise((resolveStop) => {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
      killer.on('error', resolveStop);
      killer.on('close', resolveStop);
    });
  } else child.kill('SIGTERM');
}

async function startBackend(env, port) {
  backend = spawn(executable, [
    'serve', '--hostname', '127.0.0.1', '--port', String(port), '--print-logs',
  ], { cwd: directory, env, windowsHide: true });
  let output = '';
  backend.stdout.on('data', (chunk) => { output += chunk; backendOutput += chunk; });
  backend.stderr.on('data', (chunk) => { output += chunk; backendOutput += chunk; });
  backend.on('error', (error) => { output += String(error); });
  for (let i = 0; i < 200; i++) {
    try {
      await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(1000) });
      return;
    } catch {
      if (backend.exitCode !== null) break;
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }
  }
  assert.fail(`OpenCode V2 backend did not start: ${output}`);
}

try {
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const baseURL = `http://127.0.0.1:${server.address().port}/v1`;
  const configDirectory = join(directory, 'config', 'opencode');
  await mkdir(configDirectory, { recursive: true });
  const configuration = {
    plugins: [{ package: root, options: {
      baseURL, modelsDev: { enabled: false }, headers: { 'X-Smoke-Gateway': 'gateway-test' },
    } }],
  };
  await writeFile(join(configDirectory, 'opencode.json'), JSON.stringify(configuration));
  const env = {
    ...process.env,
    HOME: directory,
    USERPROFILE: directory,
    XDG_CONFIG_HOME: join(directory, 'config'),
    XDG_DATA_HOME: join(directory, 'data'),
    XDG_CACHE_HOME: join(directory, 'cache'),
    XDG_STATE_HOME: join(directory, 'state'),
    OPENCODE_CONFIG_DIR: configDirectory,
    OPENCODE_PASSWORD: 'isolated-server-password',
    OMNIROUTE_API_KEY: 'isolated-smoke-key',
  };
  delete env.OPENCODE_CONFIG;
  delete env.OPENCODE_CONFIG_CONTENT;
  console.log((await run(['--version'], env)).trim());
  const probe = createServer();
  await new Promise((resolveProbe) => probe.listen(0, '127.0.0.1', resolveProbe));
  const backendUrl = `http://127.0.0.1:${probe.address().port}`;
  const port = probe.address().port;
  await new Promise((resolveProbe) => probe.close(resolveProbe));
  await startBackend(env, port);
  let models = '';
  for (let i = 0; i < 10; i++) {
    try {
      models = await run(['models', '--server', backendUrl], env);
    } catch (error) {
      if (!String(error).includes('Location plugins did not finish activating')) throw error;
      continue;
    }
    if (models.includes('omniroute/gemini-smoke')) break;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  assert.ok(models.includes('omniroute/gemini-smoke'), models);
  assert.ok(requests.some((request) => request.url === '/v1/models'
    && request.auth === 'Bearer isolated-smoke-key'));
  console.log('Dynamic model discovery passed');
  const output = await run([
    'run', '--server', backendUrl, '--model', 'omniroute/gemini-smoke',
    '--format', 'json', 'Reply with the smoke marker.',
  ], env);
  assert.ok(output.includes('OMNIROUTE_V2_OK'), output);
  const completions = requests.filter((request) => request.url === '/v1/chat/completions');
  for (const completion of completions) {
    assert.equal(completion.auth, 'Bearer isolated-smoke-key');
    assert.equal(completion.gateway, 'gateway-test');
  }
  // The host can also send auxiliary title-generation requests without tools.
  const payload = completions.map((request) => JSON.parse(request.body))
    .find((body) => Array.isArray(body.tools) && body.tools.length > 0);
  assert.ok(payload, 'Expected a primary generation request with tools');
  assert.equal(payload.model, 'gemini-smoke');
  assert.ok(Array.isArray(payload.tools) && payload.tools.length > 0);
  for (const tool of payload.tools) {
    assert.equal(JSON.stringify(tool.function.parameters).includes('additionalProperties'), false);
  }
  console.log('Authenticated generation and Gemini tool schemas passed');

  // Store a native credential through the same endpoint used by /connect.
  const connected = await fetch(
    `${backendUrl}/api/integration/omniroute/connect/key?directory=${encodeURIComponent(directory)}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from('opencode:isolated-server-password').toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ key: 'isolated-native-key', label: 'Smoke account' }),
    },
  );
  assert.ok(connected.ok, `Native credential creation returned ${connected.status}`);
  await stop(backend);
  delete env.OMNIROUTE_API_KEY;
  requests.length = 0;
  await startBackend(env, port);
  for (let i = 0; i < 10; i++) {
    try {
      models = await run(['models', '--server', backendUrl], env);
    } catch (error) {
      if (!String(error).includes('Location plugins did not finish activating')) throw error;
      continue;
    }
    if (models.includes('omniroute/gemini-smoke')) break;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  assert.ok(models.includes('omniroute/gemini-smoke'), models);
  assert.ok(requests.some((request) => request.url === '/v1/models'
    && request.auth === 'Bearer isolated-native-key'));
  const nativeOutput = await run([
    'run', '--server', backendUrl, '--model', 'omniroute/gemini-smoke',
    '--format', 'json', 'Reply with the smoke marker.',
  ], env);
  assert.ok(nativeOutput.includes('OMNIROUTE_V2_OK'), nativeOutput);
  assert.ok(requests.some((request) => request.url === '/v1/chat/completions'
    && request.auth === 'Bearer isolated-native-key'));
  console.log('Native stored credential discovery and generation after restart passed');
} catch (error) {
  // The backend runs with this script's isolated profile and fake credentials.
  console.error(backendOutput);
  throw error;
} finally {
  await stop(backend);
  server.closeAllConnections();
  await new Promise((resolveClose) => server.close(resolveClose));
  // This directory is created by mkdtemp above, never taken from external input.
  assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + '\\')
    || resolve(directory).startsWith(resolve(tmpdir()) + '/'));
  await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
