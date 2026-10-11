# 更新记录

> 历史版本（v2.9.0 及更早）的完整记录已归档至
> [docs/changelog-archive.md](docs/changelog-archive.md)。
> 本文件仅保留面向用户的近期条目，设计细节见 [docs/design-decisions.md](docs/design-decisions.md)。

格式参考 [Keep a Changelog](https://keepachangelog.com/)。

## [Unreleased]

## [v2.10.0] — 单模板驱动全部动态数据（JSON 模板 导出 / 导入 / 可撤销）

### Added
- **模板往返**：导出全量配置为 v2 JSON 模板、导入整体替换、拖拽导入、一键撤销（`scripts/qa/verify-template.mjs` 44 项断言守护）。
- 在线 Demo **产品化**：「复制分享链接」按钮（`?cfg=` 深链）、WebGL 能力预检与友好降级提示、隐私 / 导出格式边界说明。

### Changed
- 信息层排版以 `overlay.js:overlayMetrics()` 为单一事实源（DOM 预览与 Canvas 录制同源）。

### Fixed
- 配置单元测试补齐 `process.exitCode`，回归防护不再静默放行（红色不再被当绿色）。

## [v2.9.0] — 连续跟随与画幅自适应

### Added
- 相机注视点改为时间连续的出生前沿，消除换柱硬跳（单次最大 |Δcx| 6.00 → 0.71）。
- 跟随期距离按画幅反推，竖屏同屏柱数下限保证（1.72 → 3.60 根），横屏零回归。

## [v2.8.x] 系列

### Added
- 出片提速：单进程多帧（比逐帧新进程快约 7×），GL 回读走 `--use-gl=swiftshader`（再快约 4×）。
- 信息入画：标题 / 当前视图 / 来源位于取景框内部，导出视频直接包含（v2.7）。
- 浏览器内「导出 WebM」合成信息层（v2.7.1）。
- 暂停 / 继续（空格键）、开场首柱可见、同屏 ≥2 根柱体（v2.8.3）。
- 信息层几何收敛：DOM 与 Canvas 度量逐项对齐（v2.8.0）。

### Changed
- v2.8.3 移除「当前目标」卡片（竖屏遮挡柱体的结构性根因），信息层仅留贴边三块。

> 更早版本（v2.5 / v2.6 / v2.7 / v2.8.0–2.8.3 的完整明细）见
> [docs/changelog-archive.md](docs/changelog-archive.md)。
