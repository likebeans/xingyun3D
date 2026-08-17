---
title: "5 分钟，让网页里站着一个会说话的 3D 数字人"
date: 2026-08-17
tags: [数字人, AIGC, 前端, 开源]
category: 教程
---

# 5 分钟，让网页里站着一个会说话的 3D 数字人

先放结论：这个效果不是我录的视频，是**浏览器里实时渲染的 3D 数字人**——你给一段文字，它实时合成语音、同步口型、配上表情和动作。

![数字人表演控制台（亮色主题）](images/blog-01-idle.png)

你可以直接打开在线版体验（填个 App ID/Secret 就能玩）：

> 🔗 https://likebeans.github.io/xingyun3D/

如果你有魔珐星云的账号，用邀请码 **XDZARL7NEP** 注册还能送 1000 积分，够你跑很久的演示。

下面我带你从零把这个东西接进你自己的网页。

---

## 一、它到底做了什么

这不是「一段提前录好的视频」，而是一个**实时驱动的 3D 数字人**：

1. 你调用一个 `speak(text)`；
2. 云端把文本合成为语音、表情、口型、动作的**参数流**下发给浏览器；
3. 浏览器端渲染（AI 端渲）出画面，和语音对齐。

所以它能做到「**所见即所听，毫秒级响应**」。这也是后面接大模型做实时 AI 主播的基础（后面有专门一篇讲）。

---

## 二、环境要求

先交代前置条件，免得你踩坑：

- **浏览器**：建议最新版 Chrome / Edge / Safari（SDK 依赖 WebGL2 硬件加速渲染）；
- **访问方式**：SDK **仅支持 `localhost` 或 `https`**，直接用「IP + 端口」或裸 `http` 域名会报错（这是我在踩坑篇里记录过的坑）；
- **账号凭证**：登录 https://xingyun3d.com 在「应用中心」创建一个驱动应用，选择角色、音色、表演风格，即可拿到 App ID / App Secret；
- **运行环境**（跑我的开源项目时）：Node ≥ 18.17 即可，零依赖。

## 三、最小可运行代码

整个接入只需要三步：引脚本、建实例、说话。

### 1. 引入 SDK

```html
<div style="width: 540px; height: 960px">
  <div id="sdk"></div>
</div>
<script src="https://media.xingyun3d.com/xingyun3d/general/litesdk/xmovAvatar@latest.js"></script>
```

### 2. 创建实例

```js
const sdk = new XmovAvatar({
  containerId: '#sdk',           // 数字人渲染容器
  appId: '你的 App ID',           // 在应用中心创建驱动应用后获取
  appSecret: '你的 App Secret',
  gatewayServer: 'https://nebula-agent.xingyun3d.com/user/v1/ttsa/session',
  hardwareAcceleration: 'prefer-hardware', // 开启硬件加速
  onMessage(message) { /* 处理错误/消息 */ },
  onVoiceStateChange(status) { /* status: start / end */ },
});

// 初始化并监听资源下载进度
sdk.init({
  initModel: 'normal',
  onDownloadProgress: (progress) => console.log(progress + '%'), // 必填
});
```

### 3. 让它说话

```js
sdk.speak('欢迎使用魔珐星云', true, true);
```

就这样，一个会说话的 3D 数字人就站到你的网页里了。

---

## 三、我把它封装成了一个「表演控制台」

为了让演示更像样（也更适合给产品做宣传），我写了个开源项目：

> 📦 https://github.com/likebeans/xingyun3D

它把 SDK 的能力包装成了一个**零依赖、一个页面跑通的演示台**：

- **即兴说话**：输入框打什么它说什么，⌘/Ctrl + Enter 发送
- **开场秀 / 跳舞 / 打招呼**：SSML + KA 动作指令，情绪动作台词一起演
- **流式播报**：模拟大模型逐段输出，字幕、口型实时同步
- **自动演示**：一键跑完「打招呼 → 自我介绍 → 流式播报 → 跳舞 → 谢幕」完整节目
- **状态遥控**：待机 / 待机互动 / 在线 / 离线 / 隐身，外加音量调节
- **实时事件流**：语音、网络延迟、状态、积分消耗全都可视化
- **亮 / 暗双主题**：默认亮色，喜欢深色一键切

说话时字幕、舞台光效实时联动，效果长这样：

![说话中：字幕实时显示](images/blog-02-speaking.png)

本地跑起来只需要：

```bash
# 1. 填环境变量
cp .env.example .env   # 编辑 .env 填入 XMOV_APP_ID / XMOV_APP_SECRET
# 2. 启动（零依赖，Node ≥ 18.17）
npm start
# 3. 打开 http://localhost:3000
```

或者直接 Docker：

```bash
docker run -d -p 3000:3000 \
  -e XMOV_APP_ID=你的AppID \
  -e XMOV_APP_SECRET=你的AppSecret \
  ghcr.io/likebeans/xingyun3d:latest
```

---

## 四、为什么我觉得这玩意儿值得关注

（插一句：如果你更喜欢深色界面，项目里一键就能切，效果如下——）

![暗色主题](images/blog-03-dark.png)

魔珐（xmov）这家公司你可能没听过，但它背后的东西不简单：官方定位是「**全球领先的 3D 具身交互智能体 AI 科技公司**」，核心是自研的 **LAM 文生 3D 多模态大模型**，打造的「魔珐星云」是一个面向全终端的具身智能基础设施。

几个关键词值得记一下：

- **参数流 + AI 端渲**：不下发视频，下发「参数」（语音、表情、动作、口型数据），端侧渲染，所以能做得轻、快；
- **端到端 500ms 超低延迟**：交互够实时，接大模型才不会「卡壳感」；
- **千万级并发**：这是给规模化场景准备的，不是玩具；
- **百元芯片轻量化部署**：不挑高端 GPU；
- **一套 SDK 适配全终端**：屏幕、人形机器人、AR/VR 眼镜通吃——同一个 `speak()`，从网页到机器人。

这些我在后续的文章里会逐个拆解、验证，不是只念官网文案。

---

## 五、福利

- 🎁 邀请码 **XDZARL7NEP**：注册魔珐星云送 1000 积分
- 🔗 在线体验：https://likebeans.github.io/xingyun3D/
- 📦 开源仓库：https://github.com/likebeans/xingyun3D
- 📖 官方文档：https://xingyun3d.com/developers/52-183

下一篇我会深入拆 SDK 的技术细节：语音、口型、表情、动作到底是怎么在 500ms 内联动的。
