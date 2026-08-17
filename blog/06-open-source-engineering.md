---
title: "我把数字人演示做成了开源项目：CI、Docker、Pages 一键部署"
date: 2026-08-17
tags: [数字人, 开源, DevOps, CI/CD]
category: 工程
---

# 我把数字人演示做成了开源项目：CI、Docker、Pages 一键部署

前几篇写了数字人的接入、踩坑、接大模型和落地场景。这一篇收个尾，讲讲这个开源项目背后的**工程化**——怎么让「填个 env 就能玩」这件事，从一句口号变成真正的自动化。

（项目：https://github.com/likebeans/xingyun3D ；在线体验：https://likebeans.github.io/xingyun3D/ ；注册邀请码 **XDZARL7NEP** 送 1000 积分。）

---

## 一、目标：三种方式，覆盖三类人

我做这个项目的初衷，是让不同背景的人都能以最低门槛玩起来：

| 用户 | 运行方式 | 门槛 |
| --- | --- | --- |
| 想快速体验的访客 | **在线版（GitHub Pages）** | 打开 URL，填自己的凭证即可 |
| 本机调试的开发者 | **本地 / Docker** | 一条命令 |
| 想二次开发的人 | **Codespaces** | 云端一键环境 |

三种方式的共同点：**都只需要填 App ID / App Secret**，其他都自动化了。

---

## 二、三级配置解析，自动降级

一个关键设计是**配置的三级来源**，按优先级自动选择，互不干扰：

1. **服务端环境变量**（本地 / Docker）：读 `.env` 或 `-e` 注入；
2. **构建期注入**（Pages）：通过 GitHub Actions Variables 在构建时写入；
3. **浏览器填写**（在线版）：访问者在前端弹窗里填自己的凭证，存 `localStorage`。

```js
// 前端解析顺序：构建注入 > 浏览器 localStorage > 空（引导用户填）
const cfg = window.__APP_CONFIG__ || loadFromStorage();
if (!cfg.configured) showSetupDialog(); // 引导填写
```

这套设计让同一个代码库既能当「打开即玩」的演示站，也能当「自己填 key」的开放工具。

---

## 三、三条流水线

### 1. CI（push / PR 自动跑）

零依赖项目也能做 CI，主要做两件事：

- **语法检查**：`node --check` 校验 `server.js` / `public/main.js`；
- **冒烟测试**：启动服务 → 断言无凭证时提示「未配置」→ 断言静态资源 200 → 断言配置注入正确。

不跑真实 SDK（那需要联网和凭证），但能把「改坏了」挡在 PR 阶段。

### 2. Docker 镜像（push main / 打 tag）

自动构建镜像发布到 GitHub Container Registry：

```bash
docker run -d -p 3000:3000 \
  -e XMOV_APP_ID=你的AppID \
  -e XMOV_APP_SECRET=你的AppSecret \
  ghcr.io/likebeans/xingyun3d:latest
```

> 一个真实的坑：GHCR 镜像名必须全小写，而仓库名 `xingyun3D` 含大写。第一版 workflow 用了 `${{ github.repository }}` 导致镜像名非法，后来改成硬编码小写名才通过。

### 3. GitHub Pages（push main 自动部署）

每次 push 到 main，自动构建静态站点并部署，产出在线地址 `https://likebeans.github.io/xingyun3D/`。

**开启方法**：仓库 Settings → Pages → Source 选 **GitHub Actions**（这是必须手动点一次的一次性配置）。

**凭证注入**（可选）：Settings → Secrets and variables → Actions → **Variables** 里加 `XMOV_APP_ID` / `XMOV_APP_SECRET`，重新运行部署即可做到「打开即玩」。

---

## 四、Codespaces 一键环境

对想改代码的开发者，我在仓库放了 `.devcontainer` 配置：

- 自动装好 Node 20；
- 首次启动自动把 `.env.example` 复制成 `.env`；
- 打开终端跑 `npm start` 就能玩。

GitHub 仓库页右上角 Code → Codespaces 一键进入。

---

## 五、项目结构一览

```
xingyun3D/
├── server.js          # 零依赖 Node 服务：注入配置 + 代理积分查询 + 静态文件
├── public/
│   ├── index.html     # 演示页面
│   ├── style.css      # 亮/暗双主题
│   └── main.js        # SDK 全流程 + 自动演示 + 流式播报
├── .github/workflows/ # CI + Docker + Pages 三条流水线
├── .devcontainer/     # Codespaces 环境
├── Dockerfile         # 镜像构建
├── .env.example       # 环境变量模板
└── README.md          # 详细文档
```

---

## 六、为什么开源

两点考虑：

1. **降低信任成本**：宣传一个新产品，光喊「很强」没用，把能跑的代码摆出来，别人一跑就知道真假；
2. **沉淀经验**：踩坑、签名算法、流式对接这些经验，写成代码和博客，比私下分享传播力强得多。

这个项目本身很简单，但**它证明了一件事**：从「一行代码让数字人开口」，到「CI/Docker/Pages 全自动的在线演示」，全程可以零依赖、低成本地跑通。这对还在观望数字人技术的人来说，是最有说服力的入口。

---

## 七、福利与链接

- 🎁 邀请码 **XDZARL7NEP**：注册魔珐星云送 1000 积分
- 🔗 在线体验：https://likebeans.github.io/xingyun3D/
- 📦 开源仓库：https://github.com/likebeans/xingyun3D
- 📖 官方文档：https://xingyun3d.com/developers/52-183
