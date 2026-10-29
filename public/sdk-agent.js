(function () {
  'use strict';

  const DEFAULT_GATEWAY =
    'https://nebula-agent.xingyun3d.com/user/v1/ttsa_v2/session';

  class AvatarSession {
    constructor(callbacks = {}) {
      this.callbacks = callbacks || {};
      this.agent = null;
    }

    async init(config = {}) {
      if (this.agent) {
        throw new Error('数字人会话已初始化');
      }
      if (typeof window.XingyunAvatarAgent !== 'function') {
        throw new Error('XingyunAvatarAgent SDK 未加载');
      }
      if (!config.appId || !config.appSecret) {
        throw new Error('缺少 appId 或 appSecret');
      }

      let instance;
      const forward = (name, ...args) => {
        if (instance !== this.agent) return;
        const callback = this.callbacks[name];
        if (typeof callback === 'function') callback(...args);
      };

      instance = new window.XingyunAvatarAgent({
        containerId: config.containerId || '#sdk',
        appId: config.appId,
        appSecret: config.appSecret,
        gatewayServer: config.gatewayServer || DEFAULT_GATEWAY,
        headers: {
          ...(config.authorization ? { Authorization: config.authorization } : {}),
          ...config.headers,
        },
        hardwareAcceleration: config.hardwareAcceleration || 'prefer-hardware',
        enableLogger: config.enableLogger ?? false,
        features: {
          auto_send_asr_to_llm: config.autoSendASR ?? true,
        },
        reconnect: {
          enabled: false,
        },
        agentCallbacks: {
          onAgentStateChange: (state) =>
            forward('onAgentStateChange', state),
          onASRStateChange: (state) => forward('onASRStateChange', state),
          onASRResult: (result) => forward('onASRResult', result),
          onLLMResponse: (response) => forward('onLLMResponse', response),
          onSpeakStateChange: (event) =>
            forward('onSpeakStateChange', event),
          onConversationChange: (event) =>
            forward('onConversationChange', event),
          onNetworkInfo: (info) => forward('onNetworkInfo', info),
          onError: (error) => forward('onError', error),
        },
        onWidgetEvent: (data) => forward('onWidgetEvent', data),
        onVoiceStateChange: (status, duration, id) =>
          forward('onVoiceStateChange', status, duration, id),
        onMessage: (message) => forward('onMessage', message),
      });

      this.agent = instance;
      await instance.init({
        onDownloadProgress: (progress) => forward('onProgress', progress),
      });
    }

    async ask(text) {
      await this.requireAgent().ask(text);
    }

    speak(text) {
      return this.requireAgent().speak(text, true, true);
    }

    async startASR() {
      await this.requireAgent().startASR();
    }

    async stopASR() {
      await this.requireAgent().stopASR();
    }

    interrupt() {
      return this.requireAgent().interrupt();
    }

    setVolume(volume) {
      this.requireAgent().setVolume(volume);
    }

    async destroy() {
      const instance = this.agent;
      if (!instance) return;

      this.agent = null;
      await instance.destroy();
    }

    requireAgent() {
      if (!this.agent) {
        throw new Error('数字人会话尚未初始化');
      }
      return this.agent;
    }
  }

  window.AvatarSession = AvatarSession;
})();
