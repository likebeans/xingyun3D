'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const files = [
  'server.js',
  'public/config.js',
  'public/main.js',
  'public/scenes.js',
  'public/sdk-agent.js',
  'scripts/build-pages.js',
  'scripts/check.js',
  'scripts/smoke-test.js',
  'scripts/test-pages-build.js',
];

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `${file} 语法检查失败\n${result.stderr || result.stdout}`);
}

console.log(`语法检查通过（${files.length} 个文件）`);
