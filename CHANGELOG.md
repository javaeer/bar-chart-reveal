# 更新记录

## v2.1.0 — 修复镜头跟随 / 主体可见 / 导出与离线播放

本轮针对用户反馈的三个问题做了根因修复，并补齐可复现的验证手段。

### 1. 镜头未跟随 + 看不到主体（`BarRace3D.vue`）

**根因**：相机注视点高度 `cy` 按"柱高比例"拍脑袋取值，导致**地面线（z=0）整体掉到画面下沿之外**
——每根柱子的底边都在视口下方，视觉上像"悬空方块 / 被裁掉下半截"。而 echarts-gl 的
`viewControl` 投影并非标准透视（其 `center` 为轨道目标点），解析反解偏差达 300px 量级，不可用。

**修复**：
- 改用**离线实测标定 + 线性插值**反解相机注视点高度。实测发现固定距离下
  `地面线屏幕高度 ≈ A(alpha) + B(alpha)·cy` 严格线性；标定 4 个俯仰角的 A/B 系数，
  代码按俯仰角插值反解，使地面线稳定落在画面下方固定比例处（底部留白约 10%）。
  标定数据与方法见 `scripts/calib-camera.md`（可复现）。
- 提高俯仰角（跟随期 33°、全景期 30°），确保能看到柱体立面与地面。
- 跟随期水平中心跟随活跃柱世界坐标，并支持 t≤reveal 与全景期的连续过渡。

**验证**：帧扫描量化——内容质心水平跨度 347px（跟随证据）；亮柱像素随 t 单调增长
（105k→171k→210k→…），证明柱子确为依次弹出。

### 2. 离线无法播放（`vite.config.js` / `package.json`）

**根因**：`file://` 双击打开时，Vite 默认 ESM 产物（`<script type="module">`）被浏览器
CORS 策略拦截 → 白屏。

**修复**：引入 `vite-plugin-singlefile`，新增 `npm run build:single`，把所有 JS/CSS 内联为
单文件 `dist-single/index.html`。

**验证**：以 `file://` 直接打开，canvas 1600×900 正常渲染、UI 与视图按钮齐全、
**0 控制台错误、0 失败请求**。

### 3. 导出 WebM（`MetricBar.vue` / `BarRace3D.vue` / `main.js`）

> **说明**：该功能曾连续两版不可用。第一版"只录静止结尾帧"；第二版修好时序后
> 又因两个新 bug 导致"点导出直接失败"与"导出空白视频"。三处根因分列如下，
> **均为实测定位**，不是推测。

**根因 ①（致命，导致导出完全不工作）**：`getCanvas()` 误用 `chart.getDom()`。
`getDom()` 返回的是 echarts 的**容器 div**（无 `captureStream` 方法），而导出需要真正的
`<canvas>`。结果：判定 `!cv.captureStream` 为真 → 直接报"不支持导出"并 return，
**根本不会开始录制**。

实测证据：
```
getCanvas_tagName: "DIV"                 ← 应为 CANVAS
getCanvas_hasCaptureStream: "undefined"
branch_wouldFail: true
```
修复：`getCanvas()` 改为 `chart.getDom().querySelector('canvas')`。

**根因 ②（导致导出空白视频）**：渲染与抓帧的时序错位。
`renderAt(t)` 只是 `setOption`，**echarts-gl 的 WebGL 实际绘制发生在下一个 rAF**；
渲染后立刻 `track.requestFrame()` 会抓到尚未绘制的 buffer。

实测证据（同一帧 t=0.5，不同抓取时机）：
| 抓取时机 | 亮像素 | 最大亮度 |
| --- | --- | --- |
| 页面截图（真实画面） | 191426 | 245 |
| `renderAt` 后**立即**抓 | **0** | **54** |
| 等 **1 个 rAF** 后抓 | 220789 | 245 |

修复：`renderAt(t)` → `requestAnimationFrame(...)` → 再 `requestFrame()`。

> 注：`preserveDrawingBuffer` 实测为 `true`，**不是**该问题的原因——真正原因是异步绘制时序。

**根因 ③（第一版，只录静止结尾帧）**：旧实现直接 `canvas.captureStream()` 抓实时画面。
用户点导出时动画通常已播完（停在最后一帧），于是录到 7.5 秒全是同一张静止画面
（表现为"十几帧、帧帧雷同"）。修复：改为确定性逐帧录制（见下）。

**标签竖排**：录制瞬间系统字体未加载完成，canvas `measureText` 退化，ECharts 标签换行
算法把每个中文字当成超宽字符 → 逐字换行。`main.js` 增加 `document.fonts.ready` 守卫。

**最终实现**：`beginRecord()` 暂停实时循环并归零 → 按 30fps 逐帧
`renderAt(t)` → 等 1 个 rAF → `track.requestFrame()` 推帧 → `endRecord()` 恢复。
另加逐层体检（组件/canvas/captureStream/MediaRecorder/产物大小），失败时给出**具体**原因
而非笼统的"不支持"。

**验证**：端到端实测导出成功——1280×720、**270 帧、4.5MB**，逐帧亮像素
25k→301k→58k（柱子依次弹出 → 长高 → 全景拉远），最大亮度 244–255。
对比修复前：每帧亮像素 **0**、产物 58KB。



**根因**：
- 旧导出直接 `canvas.captureStream()` 抓**实时画面**——用户点导出时动画通常已播完
  （停在最后一帧），于是录到 7.5 秒全是同一张静止画面（表现为"只有十几帧、全一样"）。
- 中文标签竖排：录制瞬间系统字体尚未加载完成，canvas `measureText` 退化，
  ECharts 标签换行算法把每个中文字当成超宽字符 → 逐字换行。

**修复**：
- 导出改为**确定性逐帧录制**：`BarRace3D` 新增 `beginRecord() / renderAt(t) / endRecord()`；
  导出时先暂停实时循环并归零，再按 30fps 逐帧 `renderAt(t)` 渲染并 `track.requestFrame()`
  主动推帧。导出内容 = `computeFrame(t)` 全流程，与浏览器播放逐帧一致，且不受"何时点击"影响。
- 录制时长自动对齐配置的 `durationMs`，并保留结尾停留帧。
- `main.js` 增加 `document.fonts.ready` 守卫（最多等 1.5s）再挂载，避免字体未就绪导致标签竖排。

**验证**：逐帧驱动链路实测——30 帧采样得到 28 个不同的内容档位（旧版为 1），
且呈现"空场景 → 柱子依次弹出 → 全景拉远"的正确演进。

### 4. 出片管线（CLI）

`npm run render`（配置驱动、自动 Xvfb、每帧独立 chromium 进程、ffmpeg 合成）为本轮修复后
的**确定性出片路径**，已用于生成 `out/huining_*.mp4`（1920×1080）。
