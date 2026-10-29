/* 星云数字人互动空间：页面、场景与一次一轮的对话。 */
'use strict';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
const DEFAULT_GATEWAY = 'https://nebula-agent.xingyun3d.com/user/v1/ttsa_v2/session';
const els = {
  stage: $('#stage-wrap'), preview: $('#stage-preview'), welcome: $('#stage-welcome'),
  overlay: $('#progress-overlay'), progress: $('#progress-text'), bar: $('#progress-bar'),
  subtitle: $('#subtitle'), input: $('#say-input'), messages: $('#messages'),
  empty: $('#empty-conversation'), send: $('#send-btn'), mic: $('#mic-btn'),
  micLabel: $('#mic-label'), hint: $('#composer-hint'), interrupt: $('#interrupt-btn'),
  scenes: $('#scene-list'), examples: $('#example-list'), start: $('#start-practice-btn'),
  actions: $('#practice-actions'), review: $('#review-btn'), round: $('#round-badge'),
  dialog: $('#settings-dialog'), notice: $('#notice'), noticeText: $('#notice-text'),
};
const state = {
  mode: 'chat', sceneId: 'comfort', ready: false, agentRunning: false, connecting: false,
  busy: false, listening: false, micStarting: false, micStopping: false, acceptASR: false,
  started: false, round: 0, reviewed: false, blessingText: '', config: null,
  configSource: '尚未配置', serverConfig: null,
};
let session = null;
let sessionGeneration = 0;
let turn = null;
let records = [];
let initializationError = null;
let micAttempt = 0;
let asrFinalTimer = null;
let resumeContext = '';
let autoSendASR = true;

const selectedScene = () => window.AVATAR_SCENES[state.mode].find((scene) => scene.id === state.sceneId);
const isPractice = () => state.mode === 'practice';
const isBlessing = () => state.mode === 'blessing';
const canAnswer = () => state.ready && state.agentRunning && !state.connecting && !state.busy && !state.micStopping && state.started &&
  (!isPractice() || (state.round < 3 && !state.reviewed));
const escapeHtml = (text) => String(text ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------------- 主题和配置 ---------------- */
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $('#theme-icon').setAttribute('href', theme === 'dark' ? '#icon-sun' : '#icon-moon');
  $('#theme-label').textContent = theme === 'dark' ? '亮色' : '暗色';
  $('#theme-btn').setAttribute('aria-label', theme === 'dark' ? '切换到亮色主题' : '切换到暗色主题');
  try { localStorage.setItem('xmoy-theme', theme); } catch (e) { /* 本次页面仍可切换主题 */ }
}

function readSavedConfig() {
  try { return JSON.parse(localStorage.getItem('xmoy-cred') || 'null'); } catch (e) { return null; }
}

function normalizeConfig(config) {
  let gatewayServer = config.gatewayServer || DEFAULT_GATEWAY;
  if (gatewayServer === 'https://nebula-agent.xingyun3d.com/user/v1/ttsa/session') {
    gatewayServer = DEFAULT_GATEWAY;
  }
  return { ...config, gatewayServer, configured: Boolean(config.appId && config.appSecret) };
}

async function loadConfig() {
  try {
    const response = await fetch('api/config', { headers: { Accept: 'application/json' } });
    if (response.ok) {
      const config = await response.json();
      if (typeof config.configured === 'boolean') state.serverConfig = config;
    }
  } catch (e) { /* 静态站点使用 config.js 或浏览器填写的配置 */ }
  const saved = readSavedConfig();
  const built = window.XMOV_CONFIG || {};
  const choices = [
    [saved, '当前浏览器'], [state.serverConfig, '本地服务'], [built, '站点配置'],
  ];
  const chosen = choices.find(([config]) => config?.appId && config?.appSecret);
  state.config = normalizeConfig(chosen ? chosen[0] : {});
  state.configSource = chosen ? chosen[1] : '尚未配置';
  $('#config-source').textContent = state.configSource;
  updateControls();
}

function openSettings() {
  const config = state.config || {};
  $('#cred-appid').value = config.appId || '';
  $('#cred-secret').value = config.appSecret || '';
  $('#cred-gateway').value = config.gatewayServer || DEFAULT_GATEWAY;
  $('#cred-error').textContent = '';
  els.dialog.showModal();
}

function log(text, error = false) {
  const line = document.createElement('div');
  line.textContent = `${new Date().toLocaleTimeString('zh-CN', { hour12: false })}  ${text}`;
  if (error) line.className = 'error';
  $('#event-log').appendChild(line);
  while ($('#event-log').children.length > 60) $('#event-log').firstChild.remove();
  $('#event-log').scrollTop = $('#event-log').scrollHeight;
}

function showNotice(text, retry = false) {
  els.noticeText.textContent = text;
  $('#retry-btn').classList.toggle('hidden', !retry);
  els.notice.classList.remove('hidden');
}

/* ---------------- 页面与消息 ---------------- */
function setActivity(label, detail) {
  $('#stage-label').textContent = label;
  $('#voice-text').textContent = label;
  $('#stage-state').textContent = detail;
}

function updateControls() {
  const available = canAnswer();
  els.input.disabled = !available || state.listening || state.micStarting;
  els.send.disabled = !available || state.listening || state.micStarting || !els.input.value.trim();
  els.mic.disabled = !state.agentRunning || (!available && !state.listening) || state.micStarting;
  els.mic.classList.toggle('listening', state.listening);
  els.micLabel.textContent = state.micStarting ? '开启麦克风…' : state.micStopping ? '等待识别…' : state.listening ? '结束监听' : '点击说话';
  els.interrupt.disabled = !state.ready || !state.agentRunning || (!state.busy && !state.listening && !state.micStarting && !state.micStopping);
  els.start.disabled = !state.ready || !state.agentRunning || state.connecting || state.busy;
  $('#restart-btn').disabled = state.connecting;
  $$('[data-mode], .scene-card').forEach((button) => { button.disabled = state.connecting; });
  $$('[data-ka], #speak-btn').forEach((button) => {
    button.disabled = !state.ready || !state.agentRunning || state.busy || state.listening || state.micStarting || state.micStopping;
  });
  const needsReview = isPractice() && state.started && state.round >= 3;
  els.actions.classList.toggle('hidden', !needsReview);
  els.review.classList.toggle('hidden', state.reviewed);
  els.review.disabled = state.busy || !state.ready || !state.agentRunning;
  $('#again-btn').disabled = state.connecting || state.busy;
  $('#change-scene-btn').disabled = state.connecting || state.busy;
  $('#practice-result-label').textContent = state.reviewed
    ? '这次练习完成了。下一次，试着再往前一步。'
    : '三轮练习完成，听听反馈吧。';
  const hasBlessing = isBlessing() && Boolean(state.blessingText);
  $('#blessing-actions').classList.toggle('hidden', !hasBlessing);
  $('#copy-blessing-btn').disabled = !hasBlessing;
  $('#replay-blessing-btn').disabled = !hasBlessing || !available || state.listening || state.micStarting;
  $('#new-blessing-btn').disabled = state.connecting || state.busy || state.listening || state.micStarting || state.micStopping;
  $('#blessing-result-label').textContent = state.busy
    ? turn?.kind === 'replay' ? '正在再播一遍这份祝福。' : '正在准备，完成后可以复制或继续修改。'
    : '可以复制祝福，或在下方说说想怎样修改。';
  $('#send-label').textContent = isBlessing() ? state.blessingText ? '修改祝福' : '生成祝福' : '发送';
  $('#copy-btn').disabled = !records.some((message) => message.text);
  $('#credential-form button[type="submit"]').disabled = state.connecting;
  $('#cred-clear').disabled = state.connecting;
  const canConsume = state.serverConfig?.configured && state.config?.appId === state.serverConfig.appId;
  $('#consume-btn').disabled = !canConsume;
  $('#consume-btn').title = canConsume ? '查询本地服务所配置应用的消耗记录' : '积分查询需要本地服务中的应用凭证';
  els.hint.textContent = state.connecting ? '正在连接，请稍等'
    : !state.ready ? isBlessing() ? '配置后就可以生成祝福' : '配置后就可以开始聊天'
      : !state.agentRunning ? '连接正在恢复，请稍等'
        : state.micStarting ? '请允许浏览器使用麦克风'
        : state.micStopping ? '等待最后的识别结果，也可以打断取消'
          : state.listening ? '说完停顿片刻，会自动开始回答'
          : state.busy ? '正在接话，随时可以打断'
            : needsReview ? '点击生成点评，或再练一次'
              : isPractice() && !state.started ? '先点击上方按钮，开始这次练习'
                : '⌘ / Ctrl + Enter 发送';
}

function renderScenes() {
  const scenes = window.AVATAR_SCENES[state.mode];
  els.scenes.replaceChildren();
  scenes.forEach((scene, index) => {
    const button = document.createElement('button');
    button.className = `scene-card${scene.id === state.sceneId ? ' active' : ''}`;
    button.setAttribute('aria-pressed', String(scene.id === state.sceneId));
    button.innerHTML = '<span class="scene-card-top"><span class="scene-card-number"></span><svg class="scene-card-check"><use href="#icon-check"/></svg></span><strong></strong><p></p>';
    button.querySelector('.scene-card-number').textContent = `0${index + 1}`;
    button.querySelector('strong').textContent = scene.title;
    button.querySelector('p').textContent = scene.description;
    button.addEventListener('click', () => selectScene(state.mode, scene.id));
    els.scenes.appendChild(button);
  });
  const scene = selectedScene();
  const index = scenes.findIndex((item) => item.id === state.sceneId);
  $('#scene-count').textContent = `${String(index + 1).padStart(2, '0')} / ${String(scenes.length).padStart(2, '0')}`;
  $('#mode-title').textContent = isPractice() ? '先在这里，勇敢一次。' : isBlessing() ? '把心意，说给重要的人。' : '选一种心情，慢慢聊。';
  $('#mode-eyebrow').textContent = isPractice() ? '三轮就好，给自己一点底气' : isBlessing() ? '不用套话，也能好好表达' : '不必想好怎么说';
  $('#conversation-label').textContent = isPractice() ? `${scene.title} · 三轮练习` : isBlessing() ? `${scene.title} · 这份心意` : '这次聊天';
  $('#empty-title').textContent = isPractice() ? '先练一次，真正开口时更从容。' : isBlessing() ? '有些心意，值得认真说一次。' : '有些话，说出来就轻松一点。';
  $('#empty-description').textContent = isPractice() ? scene.description : isBlessing() ? '选一句灵感，或写下对象、心意和想要的语气。' : '选一句开场白，或者说说你自己的故事。';
  $('#input-label').textContent = isBlessing() ? '输入祝福对象、心意或修改要求' : '输入想说的话';
  els.input.placeholder = scene.placeholder || (isPractice() ? '把你的回答写在这里…' : '今天有什么想说的？');
  els.start.classList.toggle('hidden', !isPractice());
  els.examples.classList.toggle('hidden', isPractice());
  els.examples.replaceChildren();
  scene.examples.forEach((text) => {
    const button = document.createElement('button');
    button.className = 'example-btn';
    button.innerHTML = '<span></span><svg><use href="#icon-arrow"/></svg>';
    button.querySelector('span').textContent = text;
    button.addEventListener('click', () => {
      els.input.value = text;
      updateControls();
      if (!state.ready) openSettings();
      else if (canAnswer()) sendText();
    });
    els.examples.appendChild(button);
  });
  $$('[data-mode]').forEach((button) => {
    const active = button.dataset.mode === state.mode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  updatePrompt();
  updateControls();
}

function updatePrompt(title, body) {
  const scene = selectedScene();
  const prompt = scene.prompts[Math.min(state.round, scene.prompts.length - 1)];
  $('#prompt-label').textContent = isPractice() ? '本轮小提示' : isBlessing() ? '让祝福更像你' : '给你一个小提示';
  $('#prompt-title').textContent = title || prompt?.title || '不用组织好语言';
  $('#prompt-body').textContent = body || prompt?.body || '从今天发生的一件小事开始就好。';
  els.round.classList.toggle('hidden', !isPractice());
  els.round.textContent = state.reviewed ? '练习完成' : state.round >= 3 ? '3 / 3 已完成' : `第 ${state.round + 1} / 3 轮`;
}

function resetMicrophone() {
  micAttempt++;
  clearTimeout(asrFinalTimer);
  asrFinalTimer = null;
  state.listening = false;
  state.micStarting = false;
  state.micStopping = false;
  state.acceptASR = false;
}

function clearConversation() {
  resetMicrophone();
  resumeContext = '';
  records = [];
  turn = null;
  state.started = false;
  state.round = 0;
  state.reviewed = false;
  state.blessingText = '';
  state.busy = false;
  $$('#messages .message').forEach((message) => message.remove());
  els.empty.classList.remove('hidden');
  els.input.value = '';
  els.subtitle.classList.remove('show');
  els.stage.classList.remove('live');
  $('#voice-dot').className = 'dot';
  updatePrompt();
}

function addMessage(role, text, pending = false) {
  els.empty.classList.add('hidden');
  const node = document.createElement('div');
  node.className = `message ${role}${pending ? ' pending' : ''}`;
  const name = document.createElement('span');
  name.className = 'message-name';
  name.textContent = role === 'user' ? '你' : '星云伙伴';
  const body = document.createElement('div');
  body.className = 'message-body';
  body.textContent = text;
  node.append(name, body);
  els.messages.appendChild(node);
  const message = { role, text, node, body };
  records.push(message);
  scrollMessages();
  updateControls();
  return message;
}

function scrollMessages() {
  els.messages.scrollTop = els.messages.scrollHeight;
}

function rollbackSubmission(activeTurn) {
  const submission = activeTurn?.submission;
  if (!submission) return;
  activeTurn.submission = null;
  const index = records.indexOf(submission.message);
  if (index >= 0) records.splice(index, 1);
  submission.message.node.remove();
  state.round = submission.round;
  if (!els.input.value) els.input.value = submission.draft;
  if (!records.some((message) => message.text)) els.empty.classList.remove('hidden');
  updatePrompt();
}

function beginTurn(kind, text = '') {
  state.busy = true;
  turn = { kind, reply: text ? addMessage('assistant', text) : null, text: '', llmDone: false, speechEnded: false };
  setActivity(['opening', 'direct', 'replay'].includes(kind) ? '正在说话' : '想一想', kind === 'review' ? '正在回顾你的表达…' : kind === 'blessing' ? '正在把你的心意，写成一段祝福。' : '你的话，我认真接住了。');
  updateControls();
  return turn;
}

function finishTurn() {
  if (!turn) return;
  const completed = turn;
  turn = null;
  state.busy = false;
  if (completed.reply) completed.reply.node.classList.remove('pending');
  if (completed.kind === 'review') state.reviewed = true;
  if (completed.kind === 'setup' && isBlessing()) {
    els.messages.appendChild(els.empty);
    els.empty.classList.remove('hidden');
  }
  if (completed.kind === 'direct' && isPractice() && !state.started) {
    els.empty.classList.remove('hidden');
    els.messages.scrollTop = 0;
  }
  els.stage.classList.remove('live');
  $('#voice-dot').className = 'dot online';
  els.subtitle.classList.remove('show');
  setActivity('等你开口', state.reviewed ? '练习完成。你已经比刚才更有底气了。' : '我在听，接下来想说什么？');
  updatePrompt();
  updateControls();
  if (completed.kind !== 'direct' || state.started || !isPractice()) scrollMessages();
  if (completed.kind === 'opening') {
    queueMicrotask(() => askForScene());
  } else if (canAnswer()) {
    els.input.focus({ preventScroll: true });
  }
}

function failTurn(error) {
  const message = error?.message || String(error);
  if (turn?.submission) rollbackSubmission(turn);
  if (state.listening || state.micStarting || state.micStopping) {
    session?.stopASR().catch((stopError) => log(stopError.message, true));
  }
  if (turn?.kind === 'setup') state.started = false;
  if (turn?.reply && !turn.reply.text) turn.reply.body.textContent = '这次没有接上话，重新试试吧。';
  turn = null;
  state.busy = false;
  resetMicrophone();
  els.stage.classList.remove('live');
  showNotice(message, !state.ready || !state.started);
  log(message, true);
  setActivity('稍等一下', '这次没有接上话，可以重新试试。');
  updateControls();
}

/* ---------------- SDK 回调与连接 ---------------- */
function handleWidget(event) {
  const payload = event.data || event;
  if (event.type === 'show_text') {
    updatePrompt(payload.title, payload.text_content || payload.text);
  } else if (event.type === 'subtitle_on') {
    const text = typeof payload === 'string' ? payload : payload.text || payload.content || payload.subtitle;
    if (text) {
      els.subtitle.textContent = text;
      els.subtitle.classList.add('show');
    }
  } else if (event.type === 'subtitle_off') {
    els.subtitle.classList.remove('show');
  }
}

function handleLLM(response) {
  if (state.connecting || !turn || ['opening', 'direct', 'replay'].includes(turn.kind)) return;
  if (!turn.reply) turn.reply = addMessage('assistant', '', true);
  if (response.event === 'chunk') {
    if (response.isFirst) turn.text = '';
    turn.text += response.text || '';
  } else if (response.event === 'done') {
    turn.llmDone = true;
    if (response.text) turn.text = response.text;
    if (turn.kind === 'blessing' && turn.text.trim()) {
      state.blessingText = turn.text;
      updateControls();
    }
  }
  turn.reply.text = turn.text;
  turn.reply.body.textContent = turn.text || '正在想怎么回答你…';
  turn.reply.node.classList.remove('pending');
  scrollMessages();
  if (turn.llmDone && turn.speechEnded) finishTurn();
}

function handleASR(result) {
  if (!state.acceptASR || !state.ready || !state.agentRunning || !state.started) return;
  els.input.value = result.text;
  if (!result.isFinal || !result.text.trim()) return;
  resetMicrophone();
  addMessage('user', result.text.trim());
  els.input.value = '';
  if (isPractice()) state.round++;
  const activeTurn = beginTurn(isBlessing() ? 'blessing' : 'answer');
  updatePrompt();
  // 默认由 SDK 自动送问；打断重建后改为手动携带恢复语境，只提交一次。
  if (!autoSendASR) void askInContext(result.text.trim(), activeTurn);
  const activeSession = session;
  queueMicrotask(() => {
    if (session === activeSession) activeSession.stopASR().catch((error) => log(error.message, true));
  });
}

function waitForASRFinal() {
  if (!state.acceptASR || state.micStopping) return;
  state.micStarting = false;
  state.listening = false;
  state.micStopping = true;
  const activeSession = session;
  asrFinalTimer = setTimeout(() => {
    if (session !== activeSession || !state.acceptASR) return;
    showNotice('没有等到最终识别结果，正在重新建立连接。');
    void interrupt();
  }, 10000);
  setActivity('等待识别', '收音已结束，正在等待最后的识别结果。');
  updateControls();
}

function createCallbacks(generation = sessionGeneration) {
  const isCurrentSession = () => generation === sessionGeneration;
  return {
    onProgress(progress) {
      if (!isCurrentSession()) return;
      const percent = Math.round(progress);
      els.progress.textContent = `${percent}%`;
      els.bar.style.width = `${percent}%`;
      if (percent >= 100) $('#progress-hint').textContent = '资源已就绪，正在建立对话连接…';
    },
    onAgentStateChange(status) {
      if (!isCurrentSession()) return;
      log(`连接：${status}`);
      state.agentRunning = status === 'running';
      if (state.agentRunning) {
        state.ready = true;
        $('#status-text').textContent = '已连接';
        $('#status-dot').className = 'dot online';
      } else if (['failed', 'stopped', 'destroyed'].includes(status)) {
        state.ready = false;
        $('#status-text').textContent = status === 'failed' ? '连接失败' : '已断开';
        $('#status-dot').className = 'dot';
        if (!state.connecting) showNotice('连接已结束，点击重新开始。', true);
      } else {
        $('#status-text').textContent = status === 'reconnecting' ? '正在重连' : '正在连接';
        $('#status-dot').className = 'dot';
      }
      if (!state.connecting || state.ready) updateControls();
      if (state.agentRunning && !state.connecting && !state.started && !isPractice()) queueMicrotask(() => askForScene());
    },
    onASRStateChange(status) {
      log(`麦克风：${status}`);
      state.micStarting = ['requesting-permission', 'starting'].includes(status);
      state.listening = status === 'listening';
      if (state.listening) setActivity('正在听', '说完停顿片刻，我就接着回答。');
      if (['stopping', 'idle'].includes(status)) waitForASRFinal();
      if (status === 'failed') resetMicrophone();
      updateControls();
    },
    onASRResult: handleASR,
    onLLMResponse: handleLLM,
    onSpeakStateChange(event) {
      if (event.state === 'speak_start') {
        els.stage.classList.add('live');
        $('#voice-dot').className = 'dot live';
        setActivity('正在说话', '想插一句？随时点「打断一下」。');
      } else if (event.state === 'speak_end') {
        if (!turn) return;
        turn.speechEnded = true;
        if (turn.llmDone || ['opening', 'direct', 'replay'].includes(turn.kind)) finishTurn();
      } else if (event.state === 'speak_error') {
        failTurn(new Error('这次播报没有完成，请重试。'));
      }
    },
    onConversationChange(event) {
      log(`对话：${event.state}`);
      if (event.state === 'failed' && turn) failTurn(new Error('暂时没有收到回答，请检查应用的对话服务配置。'));
      if (event.state === 'interrupted' && !state.connecting && (turn || state.listening || state.micStarting || state.micStopping)) void interrupt();
    },
    onVoiceStateChange(status) {
      if (status === 'start') $('#voice-dot').className = 'dot live';
    },
    onWidgetEvent: handleWidget,
    onNetworkInfo(info) {
      $('#network-info').textContent = `网络 RTT ${Math.round(info.rtt || 0)} ms`;
    },
    onMessage(message) {
      log(`SDK [${message.code}] ${message.message || ''}`, message.code === 10005);
    },
    onError(error) {
      if (!isCurrentSession()) return;
      if (state.connecting) initializationError ||= error;
      else failTurn(error);
    },
  };
}

async function connectScenario(options = {}) {
  if (state.connecting) return;
  const resume = options.resume === true;
  if (!state.config?.configured) { openSettings(); return; }
  state.connecting = true;
  state.ready = false;
  state.agentRunning = false;
  initializationError = null;
  if (resume) resetMicrophone();
  else clearConversation();
  els.notice.classList.add('hidden');
  els.overlay.classList.remove('hidden');
  els.welcome.classList.add('hidden');
  els.preview.classList.remove('hidden');
  els.progress.textContent = '0%';
  els.bar.style.width = '0%';
  $('#progress-hint').textContent = '正在连接数字人…';
  $('#status-text').textContent = '正在连接';
  $('#status-dot').className = 'dot';
  setActivity('准备见面', '稍等一下，马上就能开聊。');
  updateControls();
  try {
    if (session) await session.destroy();
    const generation = ++sessionGeneration;
    session = new window.AvatarSession(createCallbacks(generation));
    autoSendASR = !resume;
    await session.init({ ...state.config, autoSendASR });
    state.ready = true;
    state.connecting = false;
    session.setVolume(Number($('#volume').value));
    els.overlay.classList.add('hidden');
    els.preview.classList.add('hidden');
    $('#status-text').textContent = '已连接';
    $('#status-dot').className = 'dot online';
    $('#voice-dot').className = 'dot online';
    setActivity('等你开口', isPractice() ? '准备好了，就开始这次练习。' : isBlessing() ? '这份心意，想送给谁？' : '今天的故事，从你开始。');
    log(`已连接，配置来源：${state.configSource}`);
    updateControls();
    if (resume) {
      if (state.started) resumeContext = buildResumeContext();
      setActivity('等你开口', '停下来了，准备好后可以继续。');
      updateControls();
    } else if (!isPractice()) await askForScene();
  } catch (error) {
    state.ready = false;
    state.agentRunning = false;
    state.connecting = false;
    els.overlay.classList.add('hidden');
    els.welcome.classList.remove('hidden');
    $('#connect-btn').innerHTML = '<svg><use href="#icon-restart"/></svg>重新连接';
    $('#status-text').textContent = '连接失败';
    failTurn(initializationError || error);
  }
}

async function selectScene(mode, id) {
  if (state.connecting || (state.mode === mode && state.sceneId === id)) return;
  state.mode = mode;
  state.sceneId = id;
  clearConversation();
  renderScenes();
  if (state.config?.configured) await connectScenario();
}

function buildResumeContext() {
  const history = records.filter((message) => message.text && !message.node.querySelector('.message-caption')).map((message) =>
    `${message.role === 'user' ? '用户' : '数字人'}：${message.text}`).join('\n');
  const progress = isPractice() ? `用户已回答 ${state.round} / 3 轮，点评${state.reviewed ? '已' : '未'}完成。` : '';
  const blessing = isBlessing() && state.blessingText ? `最近一份完整祝福：${state.blessingText}` : '';
  return `${selectedScene().setup}\n上一次播放已停止。以下记录仅供恢复语境，不作为新的用户请求：\n${history}\n${progress}\n${blessing}`;
}

async function askInContext(text, activeTurn) {
  const activeSession = session;
  const context = resumeContext;
  const request = context ? `${context}\n请直接回应以下新的请求，不要另外播报恢复话术：\n${text}` : text;
  try {
    await activeSession.ask(request);
    activeTurn.submission = null;
    if (session === activeSession && turn === activeTurn) {
      if (resumeContext === context) resumeContext = '';
      return true;
    }
  } catch (error) {
    if (session === activeSession && turn === activeTurn) failTurn(error);
  }
  return false;
}

async function askForScene() {
  if (!state.ready || !state.agentRunning || state.busy) return;
  state.started = true;
  const activeSession = session;
  const activeTurn = beginTurn('setup');
  try {
    const opening = isPractice() ? '练习，并提出第一个问题' : isBlessing() ? '祝福创作，邀请我说说祝福对象和心意，先不要生成祝福，不超过40字' : '聊天，不超过40字';
    await activeSession.ask(`${selectedScene().setup}\n请先用一句简短的话开始这次${opening}。`);
  } catch (error) {
    if (session === activeSession && turn === activeTurn) failTurn(error);
  }
}

function startPractice() {
  if (!state.ready || !state.agentRunning || state.busy || state.started) return;
  const scene = selectedScene();
  const prompt = scene.prompts[0];
  beginTurn('opening', scene.opening);
  const ssml = `<speak><uievent><type>show_text</type><data><title>${escapeHtml(prompt.title)}</title><text_content>${escapeHtml(prompt.body)}</text_content></data></uievent>${escapeHtml(scene.opening)}</speak>`;
  try { session.speak(ssml); } catch (error) { failTurn(error); }
}

async function sendText() {
  const draft = els.input.value;
  const text = draft.trim();
  if (!text || !canAnswer() || state.listening || state.micStarting) return;
  state.acceptASR = false;
  const previousRound = state.round;
  const message = addMessage('user', text);
  if (els.input.value === draft) els.input.value = '';
  if (isPractice()) state.round++;
  const activeTurn = beginTurn(isBlessing() ? 'blessing' : 'answer');
  activeTurn.submission = { message, draft, round: previousRound };
  updatePrompt();
  await askInContext(text, activeTurn);
}

async function reviewPractice() {
  if (!state.ready || !state.agentRunning || state.busy || state.round < 3 || state.reviewed) return;
  const activeTurn = beginTurn('review');
  await askInContext(selectedScene().review, activeTurn);
}

async function toggleMicrophone() {
  if (!session || state.micStarting || state.micStopping) return;
  const activeSession = session;
  if (state.listening) {
    waitForASRFinal();
    try { await activeSession.stopASR(); } catch (error) {
      if (session === activeSession && state.acceptASR) failTurn(error);
    }
    return;
  }
  if (!canAnswer()) return;
  const attempt = ++micAttempt;
  state.acceptASR = true;
  state.micStarting = true;
  updateControls();
  try {
    await activeSession.startASR();
  } catch (error) {
    if (session === activeSession && attempt === micAttempt) failTurn(error);
  } finally {
    if (session === activeSession && attempt === micAttempt) {
      state.micStarting = false;
      updateControls();
    }
  }
}

function stopTurn() {
  const interruptedOpening = turn?.kind === 'opening';
  const interruptedSetup = turn?.kind === 'setup';
  if (interruptedSetup && isPractice()) state.started = false;
  if ((interruptedOpening || interruptedSetup || turn?.kind === 'direct') && isPractice() && !state.started) {
    els.empty.classList.remove('hidden');
    els.messages.scrollTop = 0;
  }
  if (turn?.reply) {
    if (!turn.reply.text) {
      turn.reply.text = '这次先停在这里。';
      turn.reply.body.textContent = turn.reply.text;
    }
    const caption = document.createElement('span');
    caption.className = 'message-caption';
    caption.textContent = '已停止播报';
    turn.reply.node.classList.remove('pending');
    turn.reply.node.appendChild(caption);
  }
  turn = null;
  state.busy = false;
  els.stage.classList.remove('live');
  els.subtitle.classList.remove('show');
  $('#voice-dot').className = 'dot online';
  setActivity('等你开口', '停下来了，你接着说。');
  if (interruptedOpening) showNotice('开场已停止，点击重新开始这次练习。', true);
  updateControls();
}

async function interrupt() {
  if (!session || !state.ready || !state.agentRunning || state.connecting) return;
  const activeSession = session;
  const wasListening = state.listening || state.micStarting || state.micStopping;
  state.connecting = true;
  resetMicrophone();
  stopTurn();
  try { activeSession.interrupt(); } catch (error) { log(error.message, true); }
  if (wasListening) {
    try { await activeSession.stopASR(); } catch (error) { log(error.message, true); }
  }
  state.connecting = false;
  state.agentRunning = false;
  await connectScenario({ resume: true });
}

function directSpeak(text) {
  if (!state.ready || !state.agentRunning || state.connecting || state.busy || state.listening || state.micStarting || state.micStopping || !text.trim()) return;
  beginTurn('direct', text.replace(/<(uievent|ue4event)>[\s\S]*?<\/\1>/g, '').replace(/<[^>]*>/g, ''));
  try { session.speak(text); } catch (error) { failTurn(error); }
}

function replayBlessing() {
  if (!isBlessing() || !state.blessingText || !canAnswer() || state.listening || state.micStarting) return;
  beginTurn('replay');
  try { session.speak(`<speak>${escapeHtml(state.blessingText)}</speak>`); } catch (error) { failTurn(error); }
}

/* ---------------- 控件绑定 ---------------- */
$('#theme-btn').addEventListener('click', () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
$('#settings-btn').addEventListener('click', openSettings);
$('#settings-close').addEventListener('click', () => els.dialog.close());
$('#connect-btn').addEventListener('click', () => state.config?.configured ? connectScenario() : openSettings());
$('#retry-btn').addEventListener('click', connectScenario);
$('#notice-close').addEventListener('click', () => els.notice.classList.add('hidden'));
$('#restart-btn').addEventListener('click', connectScenario);
$('#again-btn').addEventListener('click', connectScenario);
$('#change-scene-btn').addEventListener('click', () => {
  const scenes = window.AVATAR_SCENES.practice;
  const index = scenes.findIndex((scene) => scene.id === state.sceneId);
  selectScene('practice', scenes[(index + 1) % scenes.length].id);
});
$$('[data-mode]').forEach((button) => button.addEventListener('click', () => {
  const mode = button.dataset.mode;
  if (state.mode !== mode) selectScene(mode, window.AVATAR_SCENES[mode][0].id);
}));
$('#chat-form').addEventListener('submit', (event) => { event.preventDefault(); sendText(); });
els.input.addEventListener('input', updateControls);
els.input.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !event.isComposing) {
    event.preventDefault();
    sendText();
  }
});
els.mic.addEventListener('click', toggleMicrophone);
els.interrupt.addEventListener('click', interrupt);
els.start.addEventListener('click', startPractice);
els.review.addEventListener('click', reviewPractice);
$('#copy-blessing-btn').addEventListener('click', async () => {
  if (!isBlessing() || !state.blessingText) return;
  try {
    await navigator.clipboard.writeText(state.blessingText);
    $('#blessing-result-label').textContent = '祝福已复制，可以粘贴到你想发送的地方。';
  } catch (error) { showNotice('浏览器没有允许复制，可以直接选中祝福文字复制。'); }
});
$('#replay-blessing-btn').addEventListener('click', replayBlessing);
$('#new-blessing-btn').addEventListener('click', connectScenario);

$('#credential-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (state.connecting) return;
  const config = normalizeConfig({
    appId: $('#cred-appid').value.trim(), appSecret: $('#cred-secret').value.trim(),
    gatewayServer: $('#cred-gateway').value.trim(),
  });
  if (!config.configured) { $('#cred-error').textContent = '请填写 App ID 和 App Secret。'; return; }
  try { localStorage.setItem('xmoy-cred', JSON.stringify(config)); } catch (e) { log('浏览器无法保存凭证，本次页面仍可使用。'); }
  state.config = config;
  state.configSource = '当前浏览器';
  $('#config-source').textContent = state.configSource;
  els.dialog.close();
  await connectScenario();
});
$('#cred-clear').addEventListener('click', async () => {
  if (state.connecting) return;
  try { localStorage.removeItem('xmoy-cred'); } catch (e) { /* 继续清除当前页面配置 */ }
  els.dialog.close();
  await loadConfig();
  if (state.config.configured) { await connectScenario(); return; }
  if (session) await session.destroy();
  session = null;
  sessionGeneration++;
  state.ready = false;
  state.agentRunning = false;
  clearConversation();
  els.preview.classList.remove('hidden');
  els.welcome.classList.remove('hidden');
  $('#connect-btn').innerHTML = '<svg><use href="#icon-spark"/></svg>配置后开始';
  $('#status-text').textContent = '等待连接';
  $('#status-dot').className = 'dot';
  setActivity('准备见面', '你的下一句话，有人认真听。');
  updateControls();
});

const KA = {
  hello: '<speak><ue4event><type>ka</type><data><action_semantic>Hello</action_semantic></data></ue4event>你好呀！很高兴在这里见到你。</speak>',
  dance: '<speak><ue4event><type>ka</type><data><action_semantic>dance</action_semantic></data></ue4event>休息一下，一起放松放松吧！</speak>',
  welcome: '<speak><ue4event><type>ka_intent</type><data><ka_intent>Welcome</ka_intent></data></ue4event>欢迎来到星云互动空间。今天想聊聊心事，还是练练表达？</speak>',
};
$$('[data-ka]').forEach((button) => button.addEventListener('click', () => {
  directSpeak(KA[button.dataset.ka]);
  els.dialog.close();
}));
$('#speak-btn').addEventListener('click', () => {
  const text = $('#speak-input').value.trim();
  if (!text) return;
  directSpeak(text);
  els.dialog.close();
});
$('#volume').addEventListener('input', (event) => {
  const volume = Number(event.target.value);
  $('#volume-value').textContent = `${Math.round(volume * 100)}%`;
  if (state.ready && state.agentRunning) session.setVolume(volume);
});
$('#copy-btn').addEventListener('click', async () => {
  const text = `${selectedScene().title}\n\n${records.filter((message) => message.text).map((message) => `${message.role === 'user' ? '我' : '数字人'}：${message.text}`).join('\n\n')}`;
  try {
    await navigator.clipboard.writeText(text);
    $('#copy-btn').textContent = '已复制';
    setTimeout(() => { $('#copy-btn').innerHTML = '<svg><use href="#icon-copy"/></svg>复制记录'; }, 1600);
  } catch (error) { showNotice('浏览器没有允许复制，可以直接选中对话文字复制。'); }
});
$('#consume-btn').addEventListener('click', async () => {
  $('#consume-btn').disabled = true;
  const result = $('#consume-result');
  result.classList.remove('hidden');
  try {
    const response = await fetch('api/consume');
    const data = await response.json();
    if (!response.ok || data.error_code) throw new Error(data.error_reason || '查询失败');
    const rows = (data.data || []).slice(0, 6);
    result.innerHTML = rows.length
      ? `<table><thead><tr><th>应用</th><th>积分</th><th>开始时间</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${escapeHtml(row.app_name || '-')}</td><td>${escapeHtml(row.amount ?? '-')}</td><td>${escapeHtml(row.start_time || '-')}</td></tr>`).join('')}</tbody></table>`
      : '暂无消耗记录。';
  } catch (error) { result.textContent = error.message; }
  finally { updateControls(); }
});
window.addEventListener('pagehide', () => { if (session) void session.destroy(); });

async function main() {
  applyTheme(document.documentElement.dataset.theme || 'light');
  renderScenes();
  await loadConfig();
  if (state.config.configured) await connectScenario();
}
main();
