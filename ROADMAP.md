# 路线图（ROADMAP）

> 规划中的能力方向。具体落地以 Issue / Milestone 为准；欢迎认领 `good first issue` / `help wanted`。

## 近期（Next）

- [ ] **i18n**：App UI 当前以中文为主，国际访客有门槛。先抽取文案为语言包，默认中文、可切英文。
- [ ] **模板画廊**：在仓库或在线 Demo 聚合 `samples/` 与社区模板，一键载入。
- [ ] **OpenSSF Scorecard 徽章**：接入 `scorecard.yml` 后，注册 bestpractices.dev 并嵌入 README。
- [ ] **包体积预算**：`build:single` 产物约 1.8MB，设 CI 体积阈值防止回归。

## 中期（Later）

- [ ] **可访问性兜底**：为读屏用户提供画面内数据层的静态数据表（等同 `DataTable` 摘要）。
- [ ] **签名发布 / npm provenance / SLSL**：提升发布供应链可信度。
- [ ] **性能基准门禁**：将 `scripts/qa/perf.mjs` 接入 CI，记录每次 PR 的性能数据防回归。
- [ ] **更多形状 / 主题**：补充形状类型与主题，丰富视觉表达。

## 探索（Maybe）

- [ ] **协作式模板编辑**：多人共同编辑一份配置（需后端或 CRDT，超出「纯前端 Demo」定位，谨慎评估）。
- [ ] **导出格式扩展**：GIF / 序列帧 / 透明背景，满足更多发布场景。

## 已交付（Done in this governance pass）

- 信任基建：LICENSE / CONTRIBUTING / SECURITY / CODE_OF_CONDUCT / Issue·PR 模板 / CODEOWNERS / dependabot
- 在线 Demo 部署（GitHub Pages）、Actions 引用钉版、安全扫描（audit / codeql / scorecard）、第三方许可清单
- Demo 产品化（分享链接 / WebGL 预检 / 隐私说明）、文档治理（README.en / docs/ / CHANGELOG 瘦身）
- Release 自动化（仅 tag 触发）

> 标注 `good first issue` / `help wanted` 的条目见仓库 Issues；新功能建议请先开 Issue 讨论。
