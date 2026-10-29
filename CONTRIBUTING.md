# 参与贡献

感谢你改进这个示例项目。提交前请先搜索现有 Issue；较大的功能或行为变更，建议先开功能建议说明使用场景和边界。

## 本地开发

项目推荐 Node.js 24 LTS，支持 Node.js 22 或更高版本，不依赖第三方 npm 包。仓库的 `.node-version` 指向 Node.js 24，CI 覆盖 22 和 24。

```bash
cp .env.example .env
npm start
```

`.env` 仅用于本机调试。不要提交 App ID、App Secret、Authorization、访问令牌或经过填充的配置文件；日志和截图也应先脱敏。

提交变更前运行：

```bash
npm run check
npm test
```

冒烟测试会在隔离环境中启动本地服务，只访问回环地址，不会调用星云网关。Pages 静态包可以用 `npm run build:pages` 生成到 `dist/`；未提供构建变量时，页面保持访问者自带配置模式。

## Pull Request

- 每个 PR 聚焦一个主题，并清楚说明动机、行为变化和验证方式。
- 界面改动请附截图，并说明测试过的浏览器和窗口尺寸。
- 新增 JavaScript 文件时，将其加入 `scripts/check.js` 的语法检查列表。
- 保持零 npm 运行时依赖；确需引入依赖时，请在 PR 中解释必要性和安全影响。
- 不要修改或覆盖与本次工作无关的未提交内容。

提交 PR 即表示你有权贡献其中内容；本仓库当前未在此文件中声明额外许可证条款。
