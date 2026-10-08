# 相机标定说明（ground-line calibration）

`src/components/BarRace3D.vue` 中相机注视点高度 `cy` 不采用解析反解，而是使用
**离线实测标定表 + 线性插值**。原因与做法记录如下，便于复现与后续调整。

## 为什么不用解析式

`viewControl.center` 是 **轨道目标点**（look-at），相机位置由
`alpha / beta / distance` 决定。标准透视投影下，地面点 `(cx, 0, 0)` 的屏幕纵坐标
应以 `cy` 的线性分式表示；但 echarts-gl 的实际投影与标准式偏差达 **300px 量级**
（其垂直映射还受 `boxHeight`/`grid3D` 影响），解析式不可用。

## 实测发现

固定 `distance` 与数据规模时，实测得到：**地面线屏幕高度对 `cy` 严格线性**：

```
groundY(cy) ≈ A(alpha) + B(alpha) · cy      (R² ≈ 1)
```

标定条件：`H = 900`（1600×900 视口），`dist ≈ 24.13`，28 项会宁县数据，`t = 0.55`。

| alpha (°) | A (px, 截距) | B (px / 单位 cy) |
| --------- | ------------ | ---------------- |
| 30        | 793.4        | 22.0             |
| 34        | 773.5        | 21.7             |
| 38        | 760.8        | 18.4             |
| 42        | 745.0        | 15.8             |

## 反解公式

给定目标地面线位置 `GROUND_FRAC`（占画面高比例）：

```
目标像素 = GROUND_FRAC · H
cy = (GROUND_FRAC · H − A(alpha)) / B(alpha)
```

代码中对 `alpha` 在标定点之间做线性插值；结果 `clamp` 到 `[0.2, 12]` 防止越界。

## 复现步骤

1. `npm run build`
2. 用 puppeteer 打开 `?t=0.55&cfg=<base64url(samples/huining.json)>&debug=1&cam=<alpha>,<cy>,<dist>`
   （`cam` 是 `computeFrame` 内置的调试覆盖钩子，仅当 URL 含 `cam=` 时生效）
3. 逐帧截图后统计"亮柱像素"的上下边界（见 `scripts/qa/verify.mjs` 的同类做法）。
4. 对每个 `alpha` 扫若干 `cy`，线性拟合出 A、B，更新本表。

## 相关常量（同文件）

| 常量          | 含义                                    |
| ------------- | --------------------------------------- |
| `ALPHA_FOLLOW`| 跟随期俯仰角（越大越"俯视"，能看到地面）|
| `ALPHA_WIDE`  | 全景期俯仰角                            |
| `GROUND_FRAC` | 地面线目标屏幕占比（0.885 → 底部留白~10%）|
| `CORE_FILL`   | 最高柱占可视高比例（0.78 → 顶部留 headroom）|
| `BAR_FRAME_W` | 单柱宽占跟随期可视宽比例（柱子粗细）    |
| `FOLLOW_NEAR` | 跟随期可视宽内的柱位数（越小越贴脸）    |
