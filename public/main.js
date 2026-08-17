/* 星云具身驱动 Demo —— 前端逻辑
 * 流程：/api/config 读取凭证 → new XmovAvatar 创建实例 → init 下载资源
 *      → speak（整句/流式/KA动作）→ 状态切换 / 音量 → destroy 销毁
 */
'use strict';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const els = {
  banner: $('#setup-banner'),
  reconnectBanner: $('#reconnect-banner'),
  reconnectBtn: $('#reconnect-btn'),
  overlay: $('#progress-overlay'),
  progressBar: $('#progress-bar'),
  progressText: $('#progress-text'),
  subtitle: $('#subtitle'),
  stage: $('#stage-wrap'),
  statusDot: $('#status-dot'),
  statusText: $('#status-text'),
  netChip: $('#net-chip'),
  voiceDot: $('#voice-dot'),
  voiceText: $('#voice-text'),
  input: $('#say-input'),
  sendBtn: $('#send-btn'),
  randomBtn: $('#random-btn'),
  showBtn: $('#show-btn'),
  streamBtn: $('#stream-btn'),
  demoBtn: $('#demo-btn'),
  volume: $('#volume'),
  volumeVal: $('#volume-val'),
  log: $('#log'),
  consumeBtn: $('#consume-btn'),
  consumeResult: $('#consume-result'),
  setupBannerText: $('#setup-banner-text'),
  credBtn: $('#cred-btn'),
  credModal: $('#cred-modal'),
  credAppId: $('#cred-appid'),
  credSecret: $('#cred-secret'),
  credGateway: $('#cred-gateway'),
  credSave: $('#cred-save'),
  credClear: $('#cred-clear'),
  credCancel: $('#cred-cancel'),
  credErr: $('#cred-err'),
};

let sdk = null;
let streaming = false;
let streamTimer = null;
let demoRunning = false;
let demoIndex = 0;
let demoTimer = null;
let demoWaitVoice = false;

/* ---------------- 主题切换（亮 / 暗） ---------------- */
const themeBtn = $('#theme-btn');
const themeSun = $('#theme-icon-sun');
const themeMoon = $('#theme-icon-moon');
const themeLabel = $('#theme-label');

function applyTheme(theme, persist = true) {
  document.documentElement.dataset.theme = theme;
  if (persist) {
    try { localStorage.setItem('xmoy-theme', theme); } catch (e) { /* ignore */ }
  }
  /* 亮色下展示“月亮 + 暗色”（点击切暗），暗色下反之 */
  const wantDark = theme === 'light';
  themeSun.classList.toggle('hidden', wantDark);
  themeMoon.classList.toggle('hidden', !wantDark);
  themeLabel.textContent = wantDark ? '暗色' : '亮色';
  themeBtn.setAttribute('aria-label', wantDark ? '切换到暗色主题' : '切换到亮色主题');
}

themeBtn.addEventListener('click', () => {
  const cur = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  applyTheme(cur === 'dark' ? 'light' : 'dark');
});
/* 与 <head> 中预置的主题同步图标（不重复写入 localStorage） */
applyTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light', false);

/* ---------------- 配置解析与凭证弹窗（静态部署） ---------------- */
const DEFAULT_GATEWAY = 'https://nebula-agent.xingyun3d.com/user/v1/ttsa/session';

/* 配置来源优先级：服务端（npm start / Docker）→ 构建注入（GitHub Pages Variables）
 * → 访问者浏览器内填写的凭证（localStorage） */
async function resolveConfig() {
  /* 1) 服务端模式：/api/config 存在且返回合法 JSON */
  try {
    const res = await fetch('/api/config', { headers: { Accept: 'application/json' } });
    if (res.ok) {
      const cfg = await res.json();
      if (cfg && typeof cfg.configured === 'boolean') {
        return { mode: 'server', cfg };
      }
    }
  } catch (e) { /* 静态部署没有该接口，走下方分支 */ }

  /* 2) 构建时注入（Pages 工作流从仓库 Variables 生成 config.js） */
  const w = window.XMOV_CONFIG || {};
  if (w.appId && w.appSecret) {
    return {
      mode: 'static',
      cfg: {
        configured: true,
        appId: w.appId,
        appSecret: w.appSecret,
        gatewayServer: w.gatewayServer || DEFAULT_GATEWAY,
        authorization: w.authorization || '',
      },
    };
  }

  /* 3) 访问者自己填写的凭证（仅存当前浏览器） */
  try {
    const saved = JSON.parse(localStorage.getItem('xmoy-cred') || 'null');
    if (saved && saved.appId && saved.appSecret) {
      return {
        mode: 'static',
        cfg: {
          configured: true,
          appId: saved.appId,
          appSecret: saved.appSecret,
          gatewayServer: saved.gatewayServer || DEFAULT_GATEWAY,
          authorization: '',
        },
      };
    }
  } catch (e) { /* ignore */ }

  return {
    mode: 'static',
    cfg: { configured: false, appId: '', appSecret: '', gatewayServer: DEFAULT_GATEWAY, authorization: '' },
  };
}

function readSavedCred() {
  try { return JSON.parse(localStorage.getItem('xmoy-cred') || 'null'); } catch (e) { return null; }
}

function openCredModal() {
  const saved = readSavedCred();
  const w = window.XMOV_CONFIG || {};
  els.credAppId.value = (saved && saved.appId) || w.appId || '';
  els.credSecret.value = (saved && saved.appSecret) || w.appSecret || '';
  els.credGateway.value = (saved && saved.gatewayServer) || w.gatewayServer || DEFAULT_GATEWAY;
  els.credErr.textContent = '';
  els.credModal.classList.remove('hidden');
  els.credAppId.focus();
}

function closeCredModal() {
  els.credModal.classList.add('hidden');
}

els.credSave.addEventListener('click', () => {
  const appId = els.credAppId.value.trim();
  const appSecret = els.credSecret.value.trim();
  if (!appId || !appSecret) {
    els.credErr.textContent = '请填写 App ID 与 App Secret';
    return;
  }
  localStorage.setItem('xmoy-cred', JSON.stringify({
    appId,
    appSecret,
    gatewayServer: els.credGateway.value.trim() || DEFAULT_GATEWAY,
  }));
  location.reload();
});

els.credClear.addEventListener('click', () => {
  localStorage.removeItem('xmoy-cred');
  location.reload();
});

els.credCancel.addEventListener('click', closeCredModal);
els.credBtn.addEventListener('click', openCredModal);

/* ---------------- 工具 ---------------- */
const pad = (n) => String(n).padStart(2, '0');
const now = () => {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

function log(text, level = 'info') {
  const line = document.createElement('div');
  line.className = `log-line ${level}`;
  line.textContent = `[${now()}] ${text}`;
  els.log.appendChild(line);
  while (els.log.children.length > 200) els.log.removeChild(els.log.firstChild);
  els.log.scrollTop = els.log.scrollHeight;
}

const STATUS_LABEL = {
  0: '在线', 1: '离线', 2: '网络恢复', 3: '网络断开',
  4: '已关闭', 5: '隐身', 6: '可见', 7: '已停止',
};

const ERROR_LABEL = {
  10001: '容器不存在', 10002: 'Socket连接错误', 10003: '会话启动错误',
  10004: '会话停止错误', 10005: '超出房间并发限制，请调用 destroy() 释放连接',
  20001: '视频抽帧错误', 20002: '抽帧Worker错误', 20003: '视频流处理错误',
  20004: '表情处理错误', 30001: '背景图加载错误', 30002: '表情数据加载错误',
  30003: 'body数据无Name', 30004: '视频下载错误', 40001: '音频解码错误',
  40002: '表情解码错误', 40003: '身体视频解码错误', 40004: '事件解码错误',
  40005: 'ttsa数据类型错误', 40006: 'ttsa下行异常',
  50001: '离线模式', 50002: '在线模式', 50003: '网络重试', 50004: '网络断开',
};

function setStatus(status) {
  const label = STATUS_LABEL[status] ?? `未知(${status})`;
  els.statusText.textContent = label;
  els.statusDot.className = 'dot ' +
    ([0, 2, 6].includes(status) ? 'dot-ok'
      : [1, 3, 4, 7].includes(status) ? 'dot-warn' : 'dot-muted');
}

function setVoice(status) {
  if (status === 'start') {
    els.voiceDot.className = 'dot dot-live';
    els.voiceText.textContent = '说话中';
    els.stage.classList.add('live');
  } else {
    els.voiceDot.className = 'dot dot-muted';
    els.voiceText.textContent = '待机';
    els.stage.classList.remove('live');
  }
}

function setControlsEnabled(on) {
  els.sendBtn.disabled = !on || demoRunning;
  els.showBtn.disabled = !on || demoRunning || streaming;
  els.streamBtn.disabled = !on || demoRunning || streaming;
  $$('[data-ka]').forEach((b) => (b.disabled = !on || demoRunning || streaming));
  $$('[data-state]').forEach((b) => (b.disabled = !on));
  els.demoBtn.disabled = !on;
}

/* ---------------- 字幕 / Widget ---------------- */
function extractText(data) {
  if (data == null) return '';
  if (typeof data === 'string') return data;
  if (typeof data === 'object') {
    return data.text || data.content || data.subtitle ||
      data.sentence || data.data || JSON.stringify(data);
  }
  return String(data);
}

/* 高频内部 widget 事件，不写入日志面板 */
const WIDGET_NOISE = new Set([
  'text_times', 'face_ka_v2', 'break', 'voice_start', 'voice_end',
  'speak_end', 'set_character_canvas_offset', 'text_state', 'clear',
]);

/* ---------------- KA 动作 / SSML ---------------- */
const KA = {
  welcome:
    '<speak>热烈<ue4event><type>ka_intent</type><data><ka_intent>Welcome</ka_intent></data></ue4event>' +
    '欢迎各位来到魔珐星云具身驱动演示现场！我可以实时生成语音、表情和动作，' +
    '请在右侧输入任意文字，或者点击动作按钮，看我的表演吧！</speak>',
  dance:
    '<speak><ue4event><type>ka</type><data><action_semantic>dance</action_semantic></data></ue4event>' +
    '音乐响起来，一起跳舞吧！</speak>',
  hello:
    '<speak><ue4event><type>ka</type><data><action_semantic>Hello</action_semantic></data></ue4event>' +
    '你好呀，欢迎来到星云具身 3D 数字人平台，这里有超多精彩内容等你发现！</speak>',
};

const STREAM_TEXT =
  '魔珐星云具身驱动，将 AI 的表达从文本升级为 3D 多模态：实时合成语音、表情与动作，' +
  '驱动数字人或人形机器人，像真人一样自然交流。这段台词就是通过流式接口逐段送入的，' +
  '模拟对接大模型的流式输出效果，首段先积攒一小段内容，保证口型与动作自然衔接。';

/* 随机台词池 */
const RANDOM_LINES = [
  '大家好，我是魔珐星云的数字人主播，很高兴见到你们！',
  '星云具身驱动，让 AI 从会思考，走向能表达、会交流。',
  '我不仅能说话，还能根据语义做出自然的动作和表情，是不是很神奇？',
  '听说点赞的朋友，今年都会有好运气哦！',
  '要不要我给大家跳一支舞？音乐响起来！',
  '我可以一口气播报新闻、讲解产品，还能陪你聊天，全年无休。',
  '你知道吗，我的表情和口型都是实时合成的，不是提前录好的哦。',
];

/* 自动演示脚本：一段接一段，完整展示产品能力 */
const DEMO_SCRIPT = [
  { type: 'ka', label: '打招呼', text: KA.hello },
  {
    type: 'speak',
    label: '自我介绍',
    text: '大家好，欢迎来到星云具身驱动演示现场！我是一名由 AI 驱动的实时 3D 数字人，' +
      '能够实时合成语音、表情和动作。接下来，请欣赏我的完整表演！',
  },
  {
    type: 'stream',
    label: '流式播报',
    text: '接下来这段台词，模拟对接大语言模型的流式输出：AI 每生成一小段文字，我就同步开口，' +
      '表情和口型实时匹配。这就是未来 AI 交互的模样——所见即所听，毫秒级响应。',
  },
  { type: 'ka', label: '跳舞', text: KA.dance },
  {
    type: 'speak',
    label: '谢幕',
    text: '表演到此结束！你也可以在右侧输入任意文字让我即兴播报，或者点击动作按钮随时让我开演。' +
      '魔珐星云，让 AI 从会思考，走向能表达、会交流！',
  },
];

/* 按标点切块，模拟大模型流式输出 */
function chunkText(text, size = 12) {
  let parts;
  try {
    parts = text.split(/(?<=[，。！？；：、\n])/);
  } catch {
    parts = [text];
  }
  const out = [];
  let buf = '';
  for (let p of parts) {
    if (!p) continue;
    while (p.length > size * 2) {
      if (buf) { out.push(buf); buf = ''; }
      out.push(p.slice(0, size));
      p = p.slice(size);
    }
    if ((buf + p).length > size && buf) { out.push(buf); buf = p; }
    else buf += p;
  }
  if (buf) out.push(buf);
  return out.length ? out : [text];
}

/* ---------------- 说话 ---------------- */
function speakNow(text) {
  if (!sdk || !text || !text.trim()) return;
  const t = text.trim();
  try {
    sdk.speak(t, true, true);
    log(`speak（整句）：${t.length > 36 ? t.slice(0, 36) + '…' : t}`);
  } catch (e) {
    log(`speak 调用失败：${e.message}`, 'error');
  }
}

/* 流式播报：首段 is_start=true，末段 is_end=true，其余均 false */
function streamSpeak(text, onDone) {
  if (!sdk || streaming) return;
  const chunks = chunkText(text);
  streaming = true;
  setControlsEnabled(true);
  log(`开始流式播报，共 ${chunks.length} 段`);
  let i = 0;
  const done = () => {
    clearInterval(streamTimer);
    streamTimer = null;
    streaming = false;
    setControlsEnabled(true);
    log('流式播报结束');
    if (typeof onDone === 'function') onDone();
  };
  streamTimer = setInterval(() => {
    try {
      sdk.speak(chunks[i], i === 0, i === chunks.length - 1);
      log(`流式片段 ${i + 1}/${chunks.length}：${chunks[i]}`);
    } catch (e) {
      log(`流式 speak 失败：${e.message}`, 'error');
      done();
      return;
    }
    i++;
    if (i >= chunks.length) done();
  }, 320);
}

/* ---------------- 自动演示 ---------------- */
function updateDemoBtn() {
  els.demoBtn.textContent = demoRunning ? '停止演示' : '自动演示：完整跑一遍';
  els.demoBtn.classList.toggle('running', demoRunning);
}

function startDemo() {
  if (!sdk || demoRunning) return;
  demoRunning = true;
  demoIndex = 0;
  demoWaitVoice = false;
  setControlsEnabled(true);
  updateDemoBtn();
  log(`自动演示开始（共 ${DEMO_SCRIPT.length} 段）`);
  demoTimer = setTimeout(() => {
    try { sdk.interactiveidle(); } catch (e) { /* ignore */ }
    demoTimer = setTimeout(demoNext, 500);
  }, 600);
}

function stopDemo(silent) {
  if (!demoRunning) return;
  demoRunning = false;
  demoWaitVoice = false;
  clearTimeout(demoTimer);
  /* 中断进行中的流式播报 */
  if (streamTimer) {
    clearInterval(streamTimer);
    streamTimer = null;
    streaming = false;
  }
  setControlsEnabled(true);
  updateDemoBtn();
  if (!silent) {
    log('自动演示已停止');
    try { sdk && sdk.interactiveidle(); } catch (e) { /* ignore */ }
  }
}

function demoNext() {
  if (!demoRunning) return;
  const seg = DEMO_SCRIPT[demoIndex];
  if (!seg) {
    stopDemo(true);
    log('自动演示结束，谢谢观看！');
    return;
  }
  demoIndex++;
  const step = `自动演示 ${demoIndex}/${DEMO_SCRIPT.length} · ${seg.label}`;
  if (seg.type === 'stream') {
    log(step);
    streamSpeak(seg.text, () => {
      if (!demoRunning) return;
      demoTimer = setTimeout(() => {
        try { sdk.interactiveidle(); } catch (e) { /* ignore */ }
        demoTimer = setTimeout(demoNext, 900);
      }, 700);
    });
  } else {
    log(step);
    speakNow(seg.text);
    demoWaitVoice = true; /* 等语音播完再进入下一段 */
  }
}

/* ---------------- 主流程 ---------------- */
async function main() {
  const { mode, cfg } = await resolveConfig();

  if (!cfg.configured) {
    if (mode === 'server') {
      els.banner.classList.remove('hidden');
      log('未检测到应用凭证：请编辑 .env 后重启服务', 'error');
    } else {
      els.credBtn.classList.remove('hidden');
      els.banner.classList.remove('hidden');
      els.banner.querySelector('strong').textContent = '未配置驱动应用凭证';
      els.setupBannerText.innerHTML =
        '静态部署页面：点击右上角 <strong>凭证</strong> 按钮，填写你的驱动应用 App ID / App Secret（仅保存在当前浏览器）。';
      openCredModal();
      log('静态部署未配置凭证：请填写驱动应用凭证后开始', 'warn');
    }
    return;
  }

  if (mode === 'static') {
    els.credBtn.classList.remove('hidden');
    /* 静态版无服务端，积分查询依赖服务端代理，直接禁用 */
    els.consumeBtn.disabled = true;
    els.consumeBtn.title = '静态部署无服务端代理，积分查询不可用';
    log(`静态部署模式：已读取凭证（${readSavedCred() ? '当前浏览器填写' : '构建时注入'}）`);
  }

  if (typeof window.XmovAvatar !== 'function') {
    els.banner.querySelector('strong').textContent = 'SDK 脚本加载失败';
    els.banner.classList.remove('hidden');
    log('XmovAvatar SDK 加载失败，请检查网络后刷新页面', 'error');
    return;
  }

  log(`初始化数字人（appId: ${cfg.appId.slice(0, 8)}…）`);

  try {
    sdk = new XmovAvatar({
      containerId: '#sdk',
      appId: cfg.appId,
      appSecret: cfg.appSecret,
      gatewayServer: cfg.gatewayServer,
      headers: cfg.authorization ? { Authorization: cfg.authorization } : {},
      hardwareAcceleration: 'prefer-hardware',
      enableLogger: false,
      /* 字幕：onWidgetEvent 优先级最高，会接管所有 widget 事件，
       * 因此直接在回调中路由 subtitle_on / subtitle_off 到自绘字幕条 */
      onWidgetEvent: (data) => {
        const type = data && data.type;
        if (type === 'subtitle_on') {
          const t = extractText(data);
          if (t) {
            els.subtitle.textContent = t;
            els.subtitle.classList.add('show');
          }
          return;
        }
        if (type === 'subtitle_off') {
          els.subtitle.classList.remove('show');
          return;
        }
        /* 高频内部事件（逐字时间码/表情帧/分段等）不刷屏 */
        if (WIDGET_NOISE.has(type)) return;
        if (type === 'ka') {
          const act = data?.data?.action_semantic || data?.data?.ka_intent || '';
          if (!act || data?.data?.deleted) return;
          log(`KA 动作：${act}`);
          return;
        }
        log(`widget 事件：${JSON.stringify(data).slice(0, 120)}`);
      },
      onVoiceStateChange: (status) => {
        setVoice(status);
        log(`语音状态：${status}`);
        /* 自动演示：当前段说完后进入下一段（避免连续 speak） */
        if (status === 'end' && demoRunning && demoWaitVoice) {
          demoWaitVoice = false;
          demoTimer = setTimeout(() => {
            try { sdk.interactiveidle(); } catch (e) { /* ignore */ }
            demoTimer = setTimeout(demoNext, 900);
          }, 700);
        }
      },
      onStateChange: (state) => log(`数字人状态：${state}`),
      onStatusChange: (status) => setStatus(status),
      onStateRenderChange: (state, duration) =>
        log(`状态「${state}」首帧渲染耗时 ${duration}ms`),
      onNetworkInfo: (info) => {
        els.netChip.innerHTML = '';
        const dot = document.createElement('i');
        dot.className = 'dot dot-ok';
        els.netChip.appendChild(dot);
        els.netChip.appendChild(
          document.createTextNode(
            `网络 rtt ${info.rtt ?? '-'}ms · ${(info.downlink ?? 0).toFixed(2)} MB/s`
          )
        );
      },
      onMessage: (message) => {
        const label = ERROR_LABEL[message.code] || message.message || '';
        const isErr = message.code >= 40000 || message.code === 10005;
        log(`SDK 消息 [${message.code}] ${label}`, isErr ? 'error' : 'warn');
        /* 房间并发超限：同时只允许一个会话，给出明确提示和一键重连 */
        if (message.code === 10005) {
          els.reconnectBanner.classList.remove('hidden');
        }
      },
      onStartSessionWarning: (warning) => {
        log(`会话配置警告：${JSON.stringify(warning).slice(0, 160)}`, 'warn');
      },
    });
  } catch (e) {
    log(`创建实例失败：${e.message}`, 'error');
    return;
  }

  /* 初始化连接房间（onDownloadProgress 为必填参数） */
  sdk.init({
    initModel: 'normal',
    onDownloadProgress: (progress) => {
      const p = Math.max(0, Math.min(100, Number(progress) || 0));
      els.progressBar.style.width = p + '%';
      els.progressText.textContent = p + '%';
      if (p >= 100) {
        els.overlay.classList.add('hidden');
        log('资源加载完成，数字人就绪');
        setControlsEnabled(true);
      }
    },
  });

  /* ---------------- 控件绑定 ---------------- */
  els.sendBtn.addEventListener('click', () => speakNow(els.input.value));
  els.input.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') speakNow(els.input.value);
  });
  els.showBtn.addEventListener('click', () => speakNow(KA.welcome));
  els.streamBtn.addEventListener('click', () => streamSpeak(STREAM_TEXT));

  /* 自动演示：开始 / 停止 */
  els.demoBtn.addEventListener('click', () => {
    if (demoRunning) stopDemo(false);
    else startDemo();
  });

  /* 随机台词：填充输入框 */
  els.randomBtn.addEventListener('click', () => {
    els.input.value = RANDOM_LINES[Math.floor(Math.random() * RANDOM_LINES.length)];
    els.input.focus();
  });

  $$('[data-ka]').forEach((btn) => {
    btn.addEventListener('click', () => speakNow(KA[btn.dataset.ka]));
  });

  const stateActions = {
    idle: () => sdk.idle(),
    interactive: () => sdk.interactiveidle(),
    offline: () => sdk.offlineMode(),
    online: () => sdk.onlineMode(),
    invisible: () => sdk.switchInvisibleMode(),
  };
  $$('[data-state]').forEach((btn) => {
    btn.addEventListener('click', () => {
      try {
        stateActions[btn.dataset.state]();
        log(`执行状态动作：${btn.textContent.trim()}`);
      } catch (e) {
        log(`状态切换失败：${e.message}`, 'error');
      }
    });
  });

  els.volume.addEventListener('input', () => {
    const v = parseFloat(els.volume.value);
    els.volumeVal.textContent = Math.round(v * 100) + '%';
    try {
      sdk.setVolume(v);
    } catch (e) {
      log(`设置音量失败：${e.message}`, 'error');
    }
  });

  els.consumeBtn.addEventListener('click', async () => {
    els.consumeBtn.disabled = true;
    try {
      const res = await fetch('/api/consume');
      renderConsume(await res.json());
    } catch (e) {
      els.consumeResult.classList.remove('hidden');
      els.consumeResult.innerHTML = `<p class="consume-err">查询失败：${e.message}</p>`;
    } finally {
      els.consumeBtn.disabled = false;
    }
  });

  /* 页面卸载前销毁实例（官方最佳实践） */
  window.addEventListener('beforeunload', () => {
    try {
      sdk && sdk.destroy();
    } catch (e) { /* ignore */ }
  });

  /* 并发超限后一键重连：销毁旧实例并刷新 */
  els.reconnectBtn.addEventListener('click', () => {
    try {
      sdk && sdk.destroy();
    } catch (e) { /* ignore */ }
    location.reload();
  });
}

/* ---------------- 积分消耗渲染 ---------------- */
function renderConsume(data) {
  els.consumeResult.classList.remove('hidden');
  if (data.error_code && data.error_code !== 0) {
    els.consumeResult.innerHTML =
      `<p class="consume-err">查询失败 [${data.error_code}]：${data.error_reason || '未知错误'}</p>`;
    return;
  }
  const rows = (data.data || []).slice(0, 6);
  if (!rows.length) {
    els.consumeResult.innerHTML = '<p class="consume-err">暂无消耗记录</p>';
    return;
  }
  els.consumeResult.innerHTML = `
    <table>
      <thead><tr><th>应用</th><th>积分</th><th>时长</th><th>开始时间</th></tr></thead>
      <tbody>${rows.map((r) => `
        <tr>
          <td>${escapeHtml(r.app_name || '-')}</td>
          <td>${r.amount ?? '-'}</td>
          <td>${r.duration ?? '-'}s</td>
          <td>${escapeHtml(formatTime(r.start_time))}</td>
        </tr>`).join('')}
      </tbody>
    </table>`;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function formatTime(ts) {
  if (!ts) return '-';
  const fmt = (d) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (typeof ts === 'string') {
    const iso = new Date(ts);
    if (!isNaN(iso.getTime())) return fmt(iso);
    const n = Number(ts);
    if (!isNaN(n)) return formatTime(n);
    return ts;
  }
  const n = Number(ts);
  const d = new Date(n < 1e12 ? n * 1000 : n);
  return isNaN(d.getTime()) ? String(ts) : fmt(d);
}

main();
