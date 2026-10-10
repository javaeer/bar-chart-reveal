# bar-chart-reveal v2.8.0 交付说明

> 本轮主题：**出片提速 7×**（单进程多帧 + CDP 截帧）+ **信息层收敛为单一几何事实源**（DOM/Canvas 不再可能漂移）。
> 对应专家报告 Batch 1 两条主线落地，全部结论以实测数据与自动化断言背书。

## 一、交付物

| 文件 | 说明 |
|---|---|
| `bar-chart-reveal-v2.8.0.zip` | 完整源码包（含 dist/ 与 dist-single/ 构建产物，55+ 文件） |
| `preview-v2.8.0/` | 本轮出片预览（16:9 / 9:16 poster 等） |

解压后 `npm install && npm run dev` 即可预览；`npm run render` 直接出片（默认已走单进程引擎）。

## 二、本轮变更

### 1. 出片提速 7×：单进程多帧渲染 + CDP clip 截帧

- **旧管线**：每帧 `puppeteer.launch()` 全新浏览器 → 截图 → `browser.close()`。
  30 帧 1920×1080 实测 **95.4 s（3.18 s/帧）**。
- **新管线**（`renderFramesSingleProcess()`，`scripts/lib/capture-core.mjs`）：
  - 一次 `launch` + 一个 `page`，循环内 `renderAt(t)` → 等两帧 rAF → CDP
    `Page.captureScreenshot({clip})` 只回传取景框区域；
  - GL 后端 `--use-gl=swiftshader`：CDP 截屏 946 ms → 193 ms（**4.04×**，
    三轮交叉验证稳定）——瓶颈在 ANGLE 截图回读，而非进程启动（仅 0.85 s/帧）；
  - `rebuildEvery=60` 分段重建 + `getContextLossCount()` 丢失自动重建；
  - `--frame-format jpg|png`：默认 jpg（q95），PNG 编码实测占旧单帧耗时 1140/1300 ms。
- **结果**：1920×1080 / 30 帧同机 A/B → **13.6 s（0.21 s/帧）= 7.0×（↓85.7%）**；
  `ffprobe` 复核 `1920×1080, 30fps, 31 帧`，poster 与旧管线一致。
- **CLI**：`--engine single|perframe`（默认 single，失败自动回退 perframe）、
  `--frame-format jpg|png`。

### 2. 信息层收敛为单一几何事实源

- **问题**：信息层排版比例在 CSS（DOM 预览层，内联 `clamp(calc(var(--vp-w)*k))`）
  与 `overlay.js`（Canvas 录制层）**各写一遍**，改一侧必漂移——即 v2.7.1
  「预览与出片落位对不上」类缺陷的温床。
- **方案**：`overlay.js:overlayMetrics()` 成为**全项目唯一**写比例系数的地方：
  - 补齐字段（新增 `subIndent`/`panelPadY`/`panelPadX`/`barGapS`/`chipPadY`/
    `chipPadKX`/`chipPadVX`）；
  - `App.vue:cssVars` 把度量注入 `--ov-*` CSS 变量（纯 px）；
    CSS 端删除全部 17 处内联 clamp，只消费变量、负责落位/换行/层级；
  - `paintOverlay()` 同步改为直接读 `m.*`。
- **收益**：改一处比例，DOM 与 Canvas 同步生效。

## 三、回归证据（全部实测）

| 套件 | 结果 |
|---|---|
| 单元测试 `npm test` | **123/123** ✅（新增 7 项 overlayMetrics 契约：字段集合/有限正数/单调不减/上下界/幂等） |
| 构图 QA `verify.mjs` | **45/45** ✅ |
| 画幅 QA `qa:aspect` | **32/32** ✅ |
| 交互回归 `interact.mjs` | 10/10 ✅ |
| 播放回归 `qa:playback` | 41 采样 0 空白帧 ✅ |
| 信息层合成 `qa:overlay` | 20/20 ✅ |
| **几何收敛 `qa:geometry`（新增）** | **28/28** ✅：16:9/9:16/1:1/4:3 四画幅，DOM 锚点（标题左上/徽标右上/目标卡左缘+宽度/来源落位）与 `overlayMetrics()` 逐项对齐（容差 2px）；`--ov-*` CSS 变量 == JS 度量 |
| **性能回归 `qa:perf`（新增）** | 4/4 ✅（全帧非空白/生成 mp4/单帧 ≤2.5s/无上下文丢失累积） |
| CLI 端到端 | 9:16 / 30 帧 × 3 视图：**0.17–0.18 s/帧**，ffprobe `1080×1920, 30fps, 31帧`，poster 信息层四区落位正确 ✅ |
| 构建 | `build` + `build:single` 通过 ✅ |

## 四、快速上手（新增能力）

```bash
npm run render                                        # 默认单进程引擎（快 ~7×）
node scripts/render.mjs --engine perframe             # 需要强隔离时切回旧路径
node scripts/render.mjs --frame-format png            # 像素级无损中间帧（慢）
npm run qa:geometry                                   # 验证 DOM/Canvas 几何同源
npm run qa:perf -- --compare                          # 单进程 vs 逐帧 A/B 加速比
```

## 五、遗留与后续（对齐专家报告的下一批）

1. **进度可见性**：CLI 出片目前按帧打印，可加总进度条与 ETA；
2. **空数据/缺数据状态**：视图全被禁用时的兜底文案与出片守卫；
3. **Docker 化**：固化 chromium + swiftshader + 字体环境，消除「本机能跑」差异；
4. **在线配置器**：按此前评估**降级为可选**，不阻塞主线。

> 版本：v2.8.0 ｜ 源码：`bar-chart-reveal/`（本项目根目录）｜ 许可证：见仓库
