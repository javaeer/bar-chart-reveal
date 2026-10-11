# 治理（GOVERNANCE）

> 即使当前为单人维护，也提前定义治理模型，为未来协作者与长期可持续性做准备。

## 角色（Roles）

| 角色 | 职责 | 当前担任者 |
|---|---|---|
| **Maintainer（维护者）** | 合并 PR、发布版本、裁定重大变更、维护 CI 与安全设置 | @javaeer |
| **Contributor（贡献者）** | 提交 Issue / PR、修复缺陷、补充示例与文档 | 任何愿意遵守本仓库规范的人 |

## 决策流程（Decision Process）

- **日常变更**（缺陷修复、文档、示例、CI 微调）：由 Maintainer 直接决定并合并。
- **重大变更**（配置格式 breaking change、CLI 参数语义变更、公共 API 调整、许可证变更）：
  必须先开 Issue 公开讨论，至少公示 **7 天**，获得 Maintainer 认可后再实施；
  并在 [CHANGELOG.md](CHANGELOG.md) 标注 `Breaking`。
- **安全相关**：走 [SECURITY.md](SECURITY.md) 私有报告通道，不公开讨论细节。

## 成为维护者（Path to Maintainer）

持续贡献（≥ 3 个被合并的非平凡 PR，或长期维护某子系统）且认同本治理约定的贡献者，
可由现任 Maintainer 邀请成为共同维护者。晋升不自动发生，需显式提名。

## 行为准则（Code of Conduct）

所有参与者须遵守 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)（Contributor Covenant v2.1）。
违规举报渠道见该文件。

## 所有权与审核（CODEOWNERS）

关键目录的审核责任见 [.github/CODEOWNERS](.github/CODEOWNERS)：
`src/core/`、`scripts/qa/`、`.github/workflows/` 等。

## 可持续性说明（Bus Factor）

当前项目为 **bus factor 1**（仅一名维护者）。这是开源项目最常见的早期风险，也是
所有「可持续」动作要先直面的真问题。缓解措施：

- 完备的文档与测试，降低接手门槛；
- 信任基建（CONTRIBUTING / SECURITY / CODE_OF_CONDUCT / 模板）已就位，便于外部贡献；
- 欢迎共同维护者；如你长期使用并有意愿，请通过 Issue 或 Discussions 联系。

## 发布（Release）

- 版本语义遵循 [SemVer](https://semver.org/lang/zh-CN/)：`v2.x` 在 **minor** 版本内不引入
  配置格式的 breaking change；`major` 才允许破坏兼容。
- 发布由 tag（`v*`）触发，见 `.github/workflows/release.yml`；不使用自动化改写 CHANGELOG 的工具
  （保留手写 [CHANGELOG.md](CHANGELOG.md) 的可读性）。
- 赞助 / 资金支持：见 `.github/FUNDING.yml`（如启用）。
