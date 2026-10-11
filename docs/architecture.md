# 架构（Architecture）

> 配置驱动的 3D 柱状赛跑（bar chart race）可视化与出片工具。本文说明核心模块的
> 职责与数据流向，便于二次开发与排查。

## 数据流总览

```
原始配置 ──┬─ 内部格式 views[]           ─┐
           └─ v2 模板 dataset/metrics/entities ─┤
                                               ▼
                                        src/core/adapt.js  (adaptV2：v2 → 内部格式)
                                               ▼
                                        src/core/config.js  (normalizeConfig：补齐/过滤/去重)
                                               │   同时提供 encodeConfig / decodeConfig（?cfg= 深链）
                                               ▼
                                        src/composables/useDataset.js  (响应式状态 + 导入/导出/撤销)
                                               ▼
                                        src/App.vue  (主布局 / 取景框 / 截帧模式识别)
                                               ▼
                                        src/components/BarRace3D.vue  (3D 柱体 + 动画/截帧核心)
                                               │
        ┌──────────────────────────────┬───────────────────────────────┐
        ▼                              ▼                                ▼
 src/core/overlay.js            src/core/video.js                  src/theme.js
 (画面内信息层：               (画幅比例表 / 导出像素推导 /           (主题对象)
  buildOverlayModel +          播放时长推导；被 config.js 重新导出)
  paintOverlay，Canvas 2D)
```

- **预览（浏览器）**：`App.vue` 挂载 `BarRace3D`，读 `?t=` / `?cfg=` 等 URL 参数；`computeFrame(t)`
  为纯函数，预览与截帧共用，保证「所见即所得」。
- **出片（CLI）**：`scripts/render.mjs` 用无头 Chromium 逐帧截屏 + ffmpeg 合成 MP4；`scripts/lib/capture-core.mjs`
  负责 Xvfb / 编码器探测 / 单进程多帧 + CDP 截帧 / 逐帧回退。

## 模块职责

| 模块 | 职责 | 是否纯逻辑 |
|---|---|---|
| `src/core/config.js` | 配置规范化（`normalizeConfig`）、base64url 编解码、默认/示例配置、重新导出 `video.js` 的符号 | 是 |
| `src/core/adapt.js` | v2 数据模板 → 内部格式适配（`adaptV2`），字段级双读 `render.X ?? raw.X` | 是 |
| `src/core/template.js` | 内部 config → v2 模板（`toV2Template`，v2.10.0 模板往返） | 是 |
| `src/core/video.js` | `ASPECTS` / `normalizeAspect` / `ratioOf` / `pixelSizeFor` / `deriveDuration` / `intervalFromDuration` | 是 |
| `src/core/overlay.js` | 画面内信息层数据模型（`buildOverlayModel`）+ Canvas 2D 绘制（`paintOverlay`） | 是 |
| `src/composables/useDataset.js` | 响应式数据集状态；视图/主题/形状/画幅/间隔/时长设置；模板导入/导出/撤销 | 是 |
| `src/App.vue` | 主布局、取景框（`.viewport`，画幅比例单一事实源）、截帧模式识别、分享/WebGL 预检 | 否（UI） |
| `src/components/BarRace3D.vue` | ECharts-GL `bar3D` 渲染、动画时间轴、确定性截帧、WebGL 上下文丢失/恢复 | 否（UI） |
| `src/components/MetricBar.vue` | 右侧控件 dock（视图/形状/比例/间隔/主题/数据/操作） | 否（UI） |
| `scripts/render.mjs` / `scripts/lib/capture-core.mjs` | 出片 CLI 与渲染管线核心 | 是（Node） |

> **单一事实源约定**
> - 画幅比例：`.viewport` 的 `--vp-w/--vp-h` 与 CLI 导出像素共用同一比例定义。
> - 信息层排版：`overlay.js:overlayMetrics()` 是 DOM 预览与 Canvas 录制共用的唯一几何事实源。
> - 配置：`useDataset` 是唯一可变状态入口；`__barRace` / `__barRaceDS` 仅调试观测口。
