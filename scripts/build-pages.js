'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const publicDir = path.join(root, 'public');
const defaultOutputDir = path.join(root, 'dist');
const configKeys = {
  XMOV_APP_ID: 'appId',
  XMOV_APP_SECRET: 'appSecret',
  XMOV_GATEWAY_SERVER: 'gatewayServer',
  XMOV_AUTHORIZATION: 'authorization',
};

function makePublicConfig(env) {
  const config = {};
  for (const [envName, configName] of Object.entries(configKeys)) {
    if (typeof env[envName] === 'string' && env[envName] !== '') {
      config[configName] = env[envName];
    }
  }
  return config;
}

function serializeConfig(config) {
  const lineSeparator = String.fromCharCode(0x2028);
  const paragraphSeparator = String.fromCharCode(0x2029);
  const json = JSON.stringify(config, null, 2)
    .replaceAll(lineSeparator, '\\u2028')
    .replaceAll(paragraphSeparator, '\\u2029');
  return [
    '/* 此文件由 scripts/build-pages.js 生成。仓库 Variables 会公开在页面源码中。 */',
    `window.XMOV_CONFIG = ${json};`,
    '',
  ].join('\n');
}

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function assertSafeOutput(outputDir) {
  const resolved = path.resolve(outputDir);
  const temporaryRoot = path.resolve(os.tmpdir());
  if (resolved !== defaultOutputDir && !isWithin(temporaryRoot, resolved)) {
    throw new Error(`输出目录只能是项目 dist 或系统临时目录的子目录：${resolved}`);
  }
}

function buildPages({ outputDir = defaultOutputDir, env = process.env } = {}) {
  const resolvedOutput = path.resolve(outputDir);
  assertSafeOutput(resolvedOutput);

  fs.rmSync(resolvedOutput, { recursive: true, force: true });
  fs.cpSync(publicDir, resolvedOutput, { recursive: true });

  const config = makePublicConfig(env);
  fs.writeFileSync(
    path.join(resolvedOutput, 'config.js'),
    serializeConfig(config),
    'utf8',
  );

  return { config, outputDir: resolvedOutput };
}

if (require.main === module) {
  const { config, outputDir } = buildPages();
  const mode = config.appId && config.appSecret ? '公开演示配置' : '访问者自带配置';
  console.log(`Pages 站点已生成：${outputDir}（${mode}）`);
}

module.exports = { buildPages, makePublicConfig, serializeConfig };
