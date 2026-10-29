'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { buildPages } = require('./build-pages');

function readGeneratedConfig(outputDir) {
  const source = fs.readFileSync(path.join(outputDir, 'config.js'), 'utf8');
  const context = { window: {} };
  vm.runInNewContext(source, context, { filename: 'config.js' });
  return JSON.parse(JSON.stringify(context.window.XMOV_CONFIG));
}

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xingyun-pages-'));

try {
  const emptyOutput = path.join(temporaryRoot, 'empty');
  buildPages({ outputDir: emptyOutput, env: {} });
  assert.deepEqual(readGeneratedConfig(emptyOutput), {});
  assert.equal(fs.existsSync(path.join(emptyOutput, 'index.html')), true);
  assert.equal(fs.existsSync(path.join(emptyOutput, 'assets', 'avatar-preview.png')), true);

  const specialOutput = path.join(temporaryRoot, 'special');
  const special = {
    XMOV_APP_ID: `app-'"-\\-\n- `,
    XMOV_APP_SECRET: `secret-$-\\-\r\n- `,
    XMOV_GATEWAY_SERVER: 'https://example.invalid/path?value=a&next="quoted"',
    XMOV_AUTHORIZATION: "Bearer 'quoted' \\ token",
  };
  buildPages({ outputDir: specialOutput, env: special });
  assert.deepEqual(readGeneratedConfig(specialOutput), {
    appId: special.XMOV_APP_ID,
    appSecret: special.XMOV_APP_SECRET,
    gatewayServer: special.XMOV_GATEWAY_SERVER,
    authorization: special.XMOV_AUTHORIZATION,
  });

  console.log('Pages 构建测试通过（无凭证与特殊字符）');
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
