---
title: "给数字人接上大模型：从念稿到实时 AI 主播"
date: 2026-08-17
tags: [数字人, AIGC, 大模型, 开源, 实战]
category: 实战
---

# 给数字人接上大模型：从念稿到实时 AI 主播

前面几篇聊了怎么让数字人「念稿」。但这套 SDK 最值钱的地方，是它能**流式接收文本**——这正好和大模型的流式输出无缝衔接，做出一个**实时响应的 AI 数字人主播**。

这篇文章我会讲清楚原理、给出可跑的代码，并指出几个容易翻车的地方。

（项目地址：https://github.com/likebeans/xingyun3D ；在线体验：https://likebeans.github.io/xingyun3D/ ；注册邀请码 **XDZARL7NEP** 送 1000 积分。）

---

## 一、为什么「流式」是接大模型的关键

大模型生成回答是**一个字一个字往外蹦的**（流式输出）。如果等它全部生成完、再一次性丢给数字人去念，那用户要干等十几秒——体验瞬间回到「念稿时代」。

正确的姿势是：**大模型每生成一小段，数字人就同步说一小段**。数字人的 `speak` 接口天生就是流式设计，专门为这个场景准备的。

---

## 二、`speak` 的流式语义

`speak(ssml, is_start, is_end)` 的三个参数：

- **第一段**：`is_start = true`
- **最后一段**：`is_end = true`
- **中间的每一段**：两个都是 `false`

也就是说，一次完整的「说话」由多段 `speak` 拼接而成，SDK 自己会在段与段之间做好语音、口型、动作的衔接。

---

## 三、先看项目里「模拟流式」的实现

在开源项目的 `main.js` 里，我先用定时器模拟了大模型的流式输出（`chunkText` 按标点切块，定时逐段喂给 `speak`）：

```js
function streamSpeak(text, onDone) {
  const chunks = chunkText(text);   // 按标点切成 8~12 字的小段
  let i = 0;
  streamTimer = setInterval(() => {
    sdk.speak(chunks[i], i === 0, i === chunks.length - 1);
    i++;
    if (i >= chunks.length) done(); // 播完回调
  }, 320);
}
```

这段「模拟」就是给真实大模型留的接口——把 `setInterval` 换成大模型的流式回调即可。

---

## 四、接真实大模型：完整代码

下面是一个可落地的示例（OpenAI 兼容接口，`/v1/chat/completions` + `stream: true`）：

```js
async function talkWithLLM(userText) {
  // 先让数字人进入互动待机，做好准备
  sdk.interactiveidle();

  const res = await fetch('https://your-llm-gateway/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer xxx' },
    body: JSON.stringify({
      model: 'your-model',
      stream: true,
      messages: [{ role: 'user', content: userText }],
    }),
  });

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let isStart = true;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE 数据按行切，解析 delta.content
    const lines = buffer.split('\n');
    buffer = lines.pop(); // 最后一个可能不完整，留到下次

    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') continue;
      let delta = '';
      try { delta = JSON.parse(payload).choices?.[0]?.delta?.content || ''; } catch {}
      if (!delta) continue;

      // 关键：把大模型的增量文本喂给数字人
      // 首段积攒一小段再开口，保证口型跟上后续输出速度
      pending += delta;
      if (pending.length >= BUFFER_SIZE) {
        sdk.speak(pending, isStart, false);
        isStart = false;
        pending = '';
      }
    }
  }

  // 收尾：把最后残余文本作为结束段发出去
  if (pending) {
    sdk.speak(pending, isStart, true);
  } else if (!isStart) {
    // 最后一段若为空，仍需补一个结束信号（视 SDK 版本而定）
  }
}
```

要点：

1. **首段缓冲**：官方建议首段积攒一小段再发，让数字人开口后，说话速度能跟上大模型的生成速度；
2. **结束信号**：`is_end = true` 只在最后一段出现，让 SDK 知道「这次说完了」；
3. **状态管理**：用 `onVoiceStateChange` 的 `start` / `end` 事件管理「数字人正在说话」的状态。

---

## 五、三个容易翻车的点

### 1. `speak` 不允许连续多次调用

官方原文：一次 `is_end = true` 之后不能立刻接下一次 `speak`，**中间要用 `interactive_idle` 做一次状态切换**。所以「用户连续问两个问题」时，每轮之间要：

```js
sdk.interactiveidle();   // 回到待机互动
await sleep(300);
sdk.speak(...);
```

### 2. 用 `voice_end` 而不是靠猜「说完了」

不要用 `setTimeout` 估时长去判断说完没有，数字人说话时长取决于文本和语速。正确的是监听：

```js
onVoiceStateChange(status) {
  if (status === 'end') {
    // 这句说完了，可以处理下一轮
  }
}
```

### 3. 流式里的「首帧延迟」是真实成本

每次从 `speak` 到数字人开口渲染出首帧，是有延迟的（我实测在 200ms~800ms 之间，和网络、资源加载有关）。这也是为什么官方强调「首段积攒缓冲」——把这段延迟「藏」在缓冲里，用户几乎无感。

---

## 六、它到底能做到什么程度

魔珐官方给的技术指标是**端到端 500ms 超低延迟**——这意味着从大模型吐字到数字人开口，几乎同步。配上口型、表情、动作的实时联动，用户面对的不再是一个「打字机」，而是一个**能看、能听、能说、能比划的「人」**。

这才是「具身 AI」和普通语音助手的本质区别：AI 不止会思考，还能**表达、交流**。

---

## 七、福利与链接

- 🎁 邀请码 **XDZARL7NEP**：注册魔珐星云送 1000 积分
- 🔗 在线体验：https://likebeans.github.io/xingyun3D/
- 📦 开源仓库：https://github.com/likebeans/xingyun3D
- 📖 官方文档：https://xingyun3d.com/developers/52-183

下一篇我会系统拆解 SDK 的技术细节：语音、口型、表情、动作到底是怎么在 500ms 内联动起来的。
