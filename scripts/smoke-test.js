'use strict';

const assert = require('node:assert/strict');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const defaultGateway = 'https://nebula-agent.xingyun3d.com/user/v1/ttsa_v2/session';

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function startServer(port, overrides = {}) {
  const env = {
    NODE_ENV: 'test',
    PORT: String(port),
    XMOV_APP_ID: '',
    XMOV_APP_SECRET: '',
    XMOV_GATEWAY_SERVER: '',
    XMOV_AUTHORIZATION: '',
    ...overrides,
  };
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });

  return { child, getOutput: () => output };
}

async function waitUntilReady(baseUrl, child, getOutput) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`服务提前退出（${child.exitCode}）\n${getOutput()}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/config`);
      if (response.ok) return;
    } catch {
      // 服务仍在启动。
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`等待服务启动超时\n${getOutput()}`);
}

async function stopServer(child, getOutput) {
  if (child.exitCode !== null) return;

  const exited = new Promise((resolve, reject) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
    child.once('error', reject);
  });
  child.kill('SIGTERM');

  const result = await Promise.race([
    exited,
    new Promise((_, reject) => {
      setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`服务未能在 3 秒内退出\n${getOutput()}`));
      }, 3000).unref();
    }),
  ]);
  assert.equal(result.signal, 'SIGTERM', `服务退出信号异常：${JSON.stringify(result)}`);
}

async function withServer(overrides, test) {
  const port = await reservePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const running = startServer(port, overrides);

  try {
    await waitUntilReady(baseUrl, running.child, running.getOutput);
    await test(baseUrl);
  } finally {
    await stopServer(running.child, running.getOutput);
  }
}

async function expectStaticFile(baseUrl, pathname, expectedType) {
  const response = await fetch(`${baseUrl}${pathname}`);
  assert.equal(response.status, 200, `${pathname} 应返回 200`);
  assert.match(response.headers.get('content-type') || '', expectedType);
  const body = await response.arrayBuffer();
  assert.ok(body.byteLength > 0, `${pathname} 不应为空`);
}

async function main() {
  await withServer({}, async (baseUrl) => {
    const configResponse = await fetch(`${baseUrl}/api/config`);
    assert.equal(configResponse.status, 200);
    assert.deepEqual(await configResponse.json(), {
      configured: false,
      appId: '',
      appSecret: '',
      gatewayServer: defaultGateway,
      authorization: '',
    });

    await expectStaticFile(baseUrl, '/', /text\/html/);
    await expectStaticFile(baseUrl, '/style.css', /text\/css/);
    await expectStaticFile(baseUrl, '/main.js', /text\/javascript/);
    await expectStaticFile(baseUrl, '/sdk-agent.js', /text\/javascript/);
    await expectStaticFile(baseUrl, '/scenes.js', /text\/javascript/);
    await expectStaticFile(baseUrl, '/assets/avatar-preview.png', /image\/png/);

    const consumeResponse = await fetch(`${baseUrl}/api/consume`);
    assert.equal(consumeResponse.status, 400);
    assert.deepEqual(await consumeResponse.json(), {
      error_code: -1,
      error_reason: '未配置 XMOV_APP_ID / XMOV_APP_SECRET',
    });
  });

  await withServer({
    XMOV_APP_ID: 'dummy_app',
    XMOV_APP_SECRET: 'dummy_secret',
    XMOV_GATEWAY_SERVER: 'https://example.invalid/session',
    XMOV_AUTHORIZATION: 'Bearer dummy',
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/config`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      configured: true,
      appId: 'dummy_app',
      appSecret: 'dummy_secret',
      gatewayServer: 'https://example.invalid/session',
      authorization: 'Bearer dummy',
    });
  });

  await withServer({
    XMOV_GATEWAY_SERVER: 'https://nebula-agent.xingyun3d.com/user/v1/ttsa/session',
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/config`);
    assert.equal(response.status, 200);
    const config = await response.json();
    assert.equal(config.configured, false);
    assert.equal(config.gatewayServer, defaultGateway);
  });

  console.log('本地服务冒烟测试通过（未向云端发送请求）');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
