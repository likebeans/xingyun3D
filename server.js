/**
 * 星云具身驱动 Demo —— 零依赖本地服务
 *
 * 职责：
 *  1. 读取 .env 环境变量，通过 GET /api/config 注入页面（appId/appSecret 等）
 *  2. 代理积分消耗查询 GET /api/consume（服务端转发，规避浏览器跨域问题）
 *  3. 提供 public/ 静态文件服务
 *
 * 启动：npm start  （默认 http://localhost:3000）
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/* ---------------- .env 加载（零依赖） ---------------- */
function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const eq = s.indexOf('=');
    if (eq <= 0) continue;
    const key = s.slice(0, eq).trim();
    let val = s.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (key && !(key in process.env)) process.env[key] = val;
  }
}
loadEnvFile(path.join(__dirname, '.env'));

const PORT = Number(process.env.PORT) || 3000;
const GATEWAY_HOST = 'https://nebula-agent.xingyun3d.com';

const config = {
  configured: Boolean(process.env.XMOV_APP_ID && process.env.XMOV_APP_SECRET),
  appId: process.env.XMOV_APP_ID || '',
  appSecret: process.env.XMOV_APP_SECRET || '',
  gatewayServer:
    process.env.XMOV_GATEWAY_SERVER ||
    `${GATEWAY_HOST}/user/v1/ttsa/session`,
  authorization: process.env.XMOV_AUTHORIZATION || '',
};

/* ---------------- 静态服务 ---------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
};

const PUBLIC_DIR = path.join(__dirname, 'public');

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function serveStatic(res, pathname) {
  let rel = '/index.html';
  try {
    rel = decodeURIComponent(pathname) || '/index.html';
  } catch {
    return sendJson(res, 400, { error: 'bad request' });
  }
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) {
    return sendJson(res, 403, { error: 'forbidden' });
  }
  fs.readFile(file, (err, data) => {
    if (err) return sendJson(res, 404, { error: 'not found' });
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    res.end(data);
  });
}

/* ---------------- 积分消耗查询（服务端代理） ----------------
 * 官方接口：GET {host}/user/v1/external/consume_record
 * 鉴权（见「具身驱动KA查询接口使用说明」）：
 *   X-APP-ID     = 应用 appId
 *   X-TIMESTAMP  = 秒级时间戳（60s 内有效）
 *   X-TOKEN      = md5( lower(api_path) + lower(method) + sort_json(data) + secret + timestamp )
 *   其中 GET 无 body 时 data = {} → sort_json = '{}'
 */
function computeXToken(secret, method, apiPath, timestampSec) {
  const sign = `${apiPath.toLowerCase()}${method.toLowerCase()}{}${secret}${timestampSec}`;
  return crypto.createHash('md5').update(sign, 'utf8').digest('hex');
}

async function handleConsume(res) {
  if (!config.configured) {
    return sendJson(res, 400, {
      error_code: -1,
      error_reason: '未配置 XMOV_APP_ID / XMOV_APP_SECRET',
    });
  }
  const apiPath = '/user/v1/external/consume_record';
  const timestampSec = Math.floor(Date.now() / 1000);
  try {
    const upstream = await fetch(`${GATEWAY_HOST}${apiPath}`, {
      headers: {
        'X-APP-ID': config.appId,
        'X-TOKEN': computeXToken(config.appSecret, 'GET', apiPath, timestampSec),
        'X-TIMESTAMP': String(timestampSec),
      },
      signal: AbortSignal.timeout(10000),
    });
    const body = await upstream.text();
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      parsed = { error_code: -3, error_reason: '星云网关返回非 JSON 数据' };
    }
    sendJson(res, upstream.status, parsed);
  } catch (err) {
    sendJson(res, 502, {
      error_code: -2,
      error_reason: `请求星云网关失败：${err.message}`,
    });
  }
}

/* ---------------- HTTP 服务 ---------------- */
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/api/config') {
    return sendJson(res, 200, config);
  }
  if (req.method === 'GET' && url.pathname === '/api/consume') {
    return handleConsume(res);
  }
  serveStatic(res, url.pathname);
});

server.listen(PORT, () => {
  console.log('');
  console.log('  ┌──────────────────────────────────────────────┐');
  console.log('  │  星云具身驱动 Demo                           │');
  console.log(`  │  已启动：http://localhost:${PORT}                    │`);
  console.log('  └──────────────────────────────────────────────┘');
  console.log('');
  if (config.configured) {
    console.log(`  ✓ 已读取应用凭证（appId: ${config.appId.slice(0, 8)}…）`);
  } else {
    console.log('  ⚠ 尚未配置凭证：请编辑 .env 填入 XMOV_APP_ID / XMOV_APP_SECRET 后重启');
  }
  console.log('');
});
