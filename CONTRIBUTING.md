# 贡献指南 (Contributing Guide)

感谢你关注 **bar-chart-reveal**！本项目欢迎 Issue 报告、功能建议与代码贡献。

> 本指南以中文为主，关键命令与规范同样适用于英文贡献者。

## 一、开发环境

前置要求：

- Node.js **>= 18**（CI 使用 Node 20）
- npm（仓库以 `package-lock.json` 为准，**不使用 pnpm**）
- 若需本地出片 / 视觉 QA：系统已安装 `chromium`（或 `chromium-browser`）、`xvfb`、`ffmpeg`（含 libx264）与中文字体（如 `fonts-noto-cjk`）

初始化：

```bash
npm ci          # 安装依赖（请勿用 npm install，保证可复现）
npm run dev     # 启动 Vite 开发服务器，浏览器预览示例动画
```

## 二、验证命令

| 命令 | 作用 | 是否需要浏览器 |
|---|---|---|
| `npm test` | 纯逻辑单元测试（配置规范化、数据健壮性，见 `scripts/qa/config.test.mjs`） | 否 |
| `npm run qa` | 视觉 / 交互 QA（`verify.mjs` + `interact.mjs`，需 chromium） | 是 |
| `npm run qa:all` | 全部 QA 脚本集合 | 是 |
| `npm run build` | 生产构建 | 否 |
| `npm run build:single` | 单文件构建（离线可双击打开，输出 `dist-single/`） | 否 |
| `npm run render` | 渲染示例 MP4（需 chromium + ffmpeg + 中文字体） | 是 |

完整的 QA 说明见 [TESTING.md](./TESTING.md)。

**提交前请至少保证 `npm test` 通过。** 涉及视觉 / 出片 / 配置的改动，额外运行 `npm run qa`。

## 三、提交信息规范

采用 [Conventional Commits](https://www.conventionalcommits.org/)：

```
<type>(<scope>): <subject>
```

常用 type：`feat` / `fix` / `docs` / `refactor` / `test` / `chore` / `perf`。
示例：`fix(core): 修复 v2 模板导入时 metrics 被静默丢弃`

## 四、PR 自查清单

- [ ] `npm test` 通过（视觉改动另需 `npm run qa` 通过）
- [ ] 相关 Issue 已关联（如 `Closes #123`）
- [ ] 用户可见变更已更新文档（README / docs/）
- [ ] 用户可见变更已在 `CHANGELOG.md` 增加条目
- [ ] 如为发版改动，`package.json` 版本号已递增

## 五、行为准则

参与本仓库即视为同意 [行为准则](./CODE_OF_CONDUCT.md)。

## 六、安全漏洞

请勿在公开 Issue 中披露安全漏洞，请按 [SECURITY.md](./SECURITY.md) 的私有通道报告。
