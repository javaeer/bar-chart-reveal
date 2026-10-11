# 设计决策（Design Decisions）

> 从 CHANGELOG 抽取的关键架构决策与权衡，供维护者理解「为什么这样设计」。
> 早期版本的详细记录见 [docs/changelog-archive.md](docs/changelog-archive.md)。

## 1. 模板往返（v2.10.0）

**问题**：`adapt.js` 只做 v2 模板 → 内部格式的单向适配；用户改完数据/视图后，没有通道把
「当前完整状态」变回可再次导入的模板。

**决定**
- **导出物绝不带顶层 `views` 字段**：`looksLikeV2()` 的判据是「出现顶层 `views[]` ⇒ 按旧格式处理」
  （保护 `?cfg=` 契约的有意设计）。若导出物写了 `views`，再导入会被判成旧格式，`metrics`/`entities` 被静默丢弃。
- **往返无损**：以 `entities[]` 为「行」、`metrics[]` 为「列」的**实体主键（entity pivot）**做列↔行还原，
  顺序沿用首次出现顺序；带原生 `_id` 的 v2 模板往返 **逐字节相等**（实测 28 实体 / 3 视图）。
- **撤销 = 单层快照 + 编辑后失效**：任何编辑动作清空快照、按钮置灰，避免「撤销」连带抹掉导入后的手工修改；
  快照须含 `viewKey/themeKey/shapeKey/durationLocked`（它们不在 `config` 内）。

## 2. 信息层排版单一事实源（v2.8.0）

**问题**：DOM 预览层用 CSS `--ov-*` 令牌、Canvas 录制层用 `overlay.js:overlayMetrics()` 表达同一组系数，
两处数值近似但分头维护，改一处易漏另一处（竖屏落位漂移）。

**决定**：`overlay.js:overlayMetrics()` 成为唯一几何事实源；DOM 层只消费注入的 `--ov-*` 像素值，
Canvas 层直接 `paintOverlay(ctx, model)`。从根上消除数值漂移（`qa:geometry` 断言 `--ov-* == overlayMetrics()`）。

## 3. 生长节奏（v2.8.3）

- 第 k 根柱的**生长起点** = `k × step × 0.85`（`step = revealRatio / n`，系数 <1 使相邻窗口故意重叠）
  → 同屏常驻 ≥2 根柱体、其中一根正在生长。
- k=0 起点恰为 `t=0` → 开场第一帧就有柱体在生长（消除「空白开场」）。
- 单根生长时长按秒给定（`GROW_SEC = 0.55s`），缓动为 smoothstep 主体 + 衰减回弹余项。

## 4. 连续跟随与画幅自适应（v2.9.0）

- 相机注视点改为**时间连续的出生前沿** `t/(step·STAGGER)`，彻底消除「每换一根柱整屏硬跳」
  （单次最大 |Δcx| 6.00 → 0.71，切换同刻硬跳 27 → 0）。
- 跟随期距离按画幅反推（`TARGET_BARS_X = 3.6`）做下限保证：竖屏同屏柱数 1.72 → 3.60 根，
  16:9 / 4:3 维持原值零回归。

## 5. 出片性能（v2.8.0）

- **单进程多帧**：一次 `launch`，每 ~60 帧分段重建上下文；监听 `getContextLossCount()` 即时重建。
  比逐帧新进程快约 **7×**（95.4s → 13.6s / 30 帧）。
- **GL 回读路径**：`--use-gl=swiftshader` 比 `--use-angle=swiftshader` 的 CDP 截屏快 **4.04×**
  （瓶颈在 ANGLE 截图回读，不在进程启动）。先量再优化。
- `--engine perframe` 保留为隔离兜底，单进程失败时自动回退。

## 6. WebGL 上下文容错

- `BarRace3D` 监听 `webglcontextlost` / `webglcontextrestored`；丢失时 `preventDefault()` 并暂停循环，
  恢复时重建 ECharts 实例并重放最后一帧。
- 监听必须挂在 **ECharts 内部 `<canvas>`** 上，且该 canvas 在首次 `setOption` 后才存在 → 挂载时机在渲染之后
  （`ensureContextWatchers()`），早挂在 `echarts.init()` 后会因 canvas 未创建而静默失效。
- 在线 Demo 额外在 `App.vue` 做**挂载时 WebGL 能力预检**，不支持时给出友好降级提示（黑屏无提示的体验问题）。
