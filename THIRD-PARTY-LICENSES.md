# 第三方许可清单（THIRD-PARTY LICENSES）

本项目以 **MIT** 许可证发布。以下是其直接依赖及其许可证（基于 `package.json` 的
运行时与开发依赖）。完整传递依赖清单由 CI 中的 `license-checker` 自动生成并作为
产物留存；本文件聚焦直接依赖，便于快速审阅。

> 说明：许可证信息为撰写时的快照，可能与依赖更新后的实际许可证存在偏差。
> 权威来源请运行 `npx license-checker --production --relativeLicensePath` 复核。

## 运行时依赖（dependencies）

| 包 | 版本范围 | 许可证 |
|---|---|---|
| echarts | ^5.5.1 | BSD-3-Clause |
| echarts-gl | ^2.0.9 | BSD-3-Clause |
| papaparse | ^5.4.1 | MIT |
| vue | ^3.4.27 | MIT |

## 开发依赖（devDependencies）

| 包 | 版本范围 | 许可证 |
|---|---|---|
| @vitejs/plugin-vue | ^5.0.4 | MIT |
| pngjs | ^7.0.0 | MIT |
| puppeteer-core | ^22.15.0 | Apache-2.0 |
| vite | ^5.3.1 | MIT |
| vite-plugin-singlefile | ^2.3.3 | MIT |

## 许可证兼容性结论

所有直接依赖均为 **宽松许可证（MIT / BSD-3-Clause / Apache-2.0）**，
与本项目 MIT 许可证兼容，无 GPL / AGPL / LGPL / MPL 等 Copyleft 依赖。
CI 工作流 `license.yml` 会在每次 push / PR 时以 `--failOn "GPL;AGPL;LGPL;MPL"`
进行门禁检查，一旦出现 Copyleft 依赖即失败。
