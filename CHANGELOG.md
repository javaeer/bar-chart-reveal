# 更新记录

## v2.4.1 — 控件面板「科技风」重构 + 球体立体感与构图修复

本轮聚焦**交互控件视觉升级**与**球体形状质量**，不改变柱体家族渲染与出片契约。
回归：单元测试 **47/47**、QA **35/35**、交互 **7/7**、播放全程无空白帧。

### 1. 底部控件面板重构为「科技风分组 dock」（`MetricBar.vue`）

- **布局**：从"一整排平铺按钮"改为**四组语义化胶囊段**——`视图 / 形状 / 主题 / 操作`，
  每组 = 分组标签（`group-tag`）+ 胶囊容器（`seg`）+ 段内按钮（`seg-btn`）。
  桌面端 2×2 网格，窄屏自动堆叠为单列。
- **科技风细节**：外壳四角 `clip-path` 切角 + 顶部 `dock-glow` 流光细线 +
  半透明毛玻璃（`backdrop-filter`）+ 内描边高光。
- **选中态**：青蓝渐变实心胶囊 + 外发光 + 内高光，`active` 语义清晰。
- **形状图标**：为 5 种形状各绘制一枚内联 SVG 几何图标（方柱/立方体/圆柱/圆角柱/球体），
  用 `currentColor` 随选中态变色，直观区分形状。
- **响应式三段断点**：`≤1180px` 单列堆叠 + 段内换行；`≤720px` 紧凑化；
  `≤480px` 隐藏视图小圆点、形状按钮只留图标。
- **DOM 契约保持**：根节点保留 `.ui` 类，`interact.mjs` 等既有选择器无需改动即通过。

### 2. 交互控件布局避让（`App.vue` / `DataToolbar.vue`）

- `DataToolbar` 在 `≤720px` 移至**右上角**、按钮只留图标，避免与底部 dock 抢位。
- 竖屏（`≤560px`）目标面板 / 指标卡上移（`bottom:168px` / `140px`），为更高的堆叠式 dock 让位。

### 3. 球体（`sphere`）质量修复（`BarRace3D.vue`）

- **尺寸映射改为幂次压缩（γ=0.68）**：旧版半径 ∝ ratio（线性）在悬殊数据下崩溃——
  人口视图最大 11.41 万 vs 最小 0.41 万（28×），小球退化为 2~3px 噪点、大球独占半屏。
  改为 `ratio^0.68` 后 28× 数值 → 半径差 ≈ 9.6×，大小差异清晰且小球仍有体积；
  并加 `SPHERE_PX_MIN=9px` 像素下限兜底。
- **新增「过渡层」**：同心四层叠加（外圈光晕 → 主体 → 0.78× 提亮过渡 → 0.40× 近白高光），
  抹掉原先"主体/高光"之间的硬边，径向明暗连续，球体受光感更强。
- **尺寸随相机距离补偿**：echarts-gl 的 `scatter3D.symbolSize` 是屏幕像素固定值、不随
  相机远近缩放（实测 distance 607→160 时恒为 61.8px），导致全景拉远后球与地面透视脱节。
  现按 `followDist / wideDist` 反比补偿，并乘一个全景放大档，保证收尾画面球群饱满醒目。
- **构图修复**：球体内容矮（≈球径量级），沿用柱体"地面线在 85% 屏高"的构图会把球顶到
  画面上部、下半留白。现按**可视高的固定比例**（`SPHERE_GAZE_K`）抬升注视点，球群在
  任意数据量下都稳定落在画面中下部；竖屏按 aspect 归一系数，避免球群贴底。
- **竖屏横向入画**：跨度距离改用**未 clamp 的真实 aspect** 计算，竖屏自动拉远，
  首尾球不被裁切。

### 4. 测试

- `verify.mjs`：构图断言**按形状区分阈值**——球体全景高占比放宽到 ≥18%
  （球体天然横向铺开、垂直占比低于柱体），柱体族仍为 ≥45%，避免把球体误判为回归。
- 回归全绿：`npm test` 47/47、`node scripts/qa/verify.mjs` 35/35、
  `node scripts/qa/interact.mjs` 7/7、`node scripts/qa/verify-playback.mjs` 无空白帧。

---

## v2.4.0 — 形状类型扩展（方柱/立方体/圆柱/圆角柱/球体）+ UI 与布局美化

本轮为**功能增强 + 视觉优化**，不改变既有渲染行为（`bar` 形状仍为默认，出片结果向后兼容）。
回归：单元测试 **47/47**、QA **35/35**、交互与播放回归全通过。

### 1. 新增 5 种柱体形状（`config.js` / `BarRace3D.vue`）

新增 `shape`（视图级）/ `defaultShape`（顶层默认）配置，取值：

| 键名 | 呈现 | 渲染实现 |
|---|---|---|
| `bar` | 方柱（默认） | `bar3D`，`bevelSize≈0.28` 小倒角 |
| `cube` | 立方体 | `bar3D`，直角正方形截面 |
| `cylinder` | 圆柱 | `bar3D`，`bevelSize=1` 全圆角截面（近似圆柱） |
| `rounded` | 圆角柱 / 胶囊 | `bar3D`，中等倒角 + 正方形截面 |
| `sphere` | 球体 | `scatter3D`，用**球径**编码数值（独立 series 分支） |

- 优先级：**视图 `shape` > 顶层 `defaultShape` > `bar`**；非法值回退 `bar` 并写入告警。
- `normalizeShape()` 规范化（大小写不敏感、首尾空白裁剪）；`SHAPES` / `SHAPE_LABELS` 常量导出。
- 形状切换时 `applyFrame` 检测到 `f.shape` 变化会**强制 `notMerge` 重建场景**（柱体与散点是两套 layout，不能增量合并）。
- 球体走 `scatter3D`：读取每个数据点的 `symbolSize`（受 echarts-gl 约 200px 上限约束），
  球心贴近底面；亮像素阈值单独放宽（球体天然少于柱体）。
- URL 运行时可切换：`?shape=cylinder`；CLI 支持 `--shape <key>`（非法值直接报错退出）。

### 2. 形状演示配置

- `samples/departments.json`：q1=bar / q2=cylinder / q3=cube / q4=sphere，`defaultShape=bar`。
- `samples/huining.json` + `src/data/huining.json`：area=cylinder / pop=bar / elev=rounded / red=sphere。
- `samples/planets.json`：`defaultShape=sphere`，diameter/mass=sphere、orbit=rounded。
- `scripts/data/fetch-huining.mjs` 同步生成带 `shape`/`defaultShape` 的配置。

### 3. UI 与布局美化（设计令牌统一）

- `src/App.vue`：建立 **CSS 设计令牌系统**（`:root` 定义 `--panel-bg`/`--radius-*`/`--space-*`/`--shadow-*`/`--z-*`/`--t-*`/`--ease` 等），层级与留白统一。
- 响应式适配：`@media (max-width:1024px)` / `(max-width:720px)` / `(orientation:portrait)` 断点，竖屏与窄屏布局优化；支持 `prefers-reduced-motion`。
- `MetricBar.vue`：**形状切换按钮组**（`v-for` 枚举 5 种形状）+ 令牌化样式 + 响应式 + `:focus-visible`/`:active` 微交互。
- `DataToolbar.vue`：令牌化 + 响应式（≤720px 移至左下）。
- `DataTable.vue`：令牌化 + 粘性表头 + 输入聚焦光晕 + `:focus-visible` + 响应式。

### 4. 测试增强

- `scripts/qa/config.test.mjs`：新增 15 项形状断言（`SHAPES` 内容、`normalizeShape` 边界、缺省继承、视图覆盖顶层、非法回退 + 告警）→ **47/47**。
- `scripts/qa/verify.mjs`：新增 6 项形状渲染断言（5 种形状各渲染一帧非空白 + 连续切换无未捕获异常）→ **35/35**。

### 5. 文档

- `README.md`：配置 Schema 增补 `shape`/`defaultShape`；新增「形状类型」表与球体语义说明；CLI 参数表增补 `--shape`；URL 契约增补 `shape=`。

---

## v2.3.2 — 工程质量修复（QA 脚本可移植性 / 依赖完整性 / CI）

本轮为工程化修复，不改变渲染行为与出片结果（单元测试 32/32、QA 29/29、交互 7/7、
播放无空白帧全部回归通过）。

### 1. 修复 `pngjs` 未声明依赖（两个 QA 脚本必然崩溃）

`scripts/qa/verify-playback.mjs` 与 `scripts/qa/diag-calib2.mjs` 均 `import { PNG } from 'pngjs'`，
但 `package.json` 未声明该依赖 → 任何环境运行都会抛 `ERR_MODULE_NOT_FOUND`。
**修复**：`devDependencies` 增加 `"pngjs": "^7.0.0"`。

### 2. 修复 `verify.mjs` 硬编码的绝对路径

产物目录此前被硬编码为某台机器的绝对路径（`/root/.codebuddy/artifact/<uuid>/qa`），
换机/换用户必然写错位置或失败。
**修复**：改为 `os.tmpdir()/bar-chart-reveal-qa`，并支持 `QA_ART` 环境变量覆盖。

### 3. 修复 QA 脚本硬编码 `localhost:5173`（需手动起 dev server）

`verify-playback.mjs` / `diag-calib2.mjs` 直接访问 `http://localhost:5173`，要求用户先手动
`npm run dev`，且端口/主机不确定。
**修复**：改为自动构建 `dist`（若缺失）→ 用 `capture-core` 的 `startServer` 自启静态服务
→ 用返回的 `srv.base` 访问，跑完自动关闭。两脚本现已完全自包含。

### 4. 仓库卫生

- `.gitignore` 增加 `dist-single/`、`out/`；从版本库移除已提交的构建产物
  `dist-single/index.html`（1.7MB）与 `dist-single/favicon.svg`。
- 移除冗余的 `pnpm-lock.yaml`，统一使用 `package-lock.json`（脚本/CI 均基于 npm）。

### 5. 新增 GitHub Actions CI（`.github/workflows/ci.yml`）

- `unit` 作业：`npm ci` → `npm test` → `npm run build` → `npm run build:single`，上传 `dist` 产物。
- `qa` 作业：安装 chromium / xvfb / `fonts-noto-cjk` → 运行 `interact.mjs` 与 `verify.mjs`。

### 6. 其他

- `package.json` 增加 `engines.node >= 18`，及 `qa:playback` / `qa:all` 脚本。
- README「质量保障」章节更新为六套脚本的正确用法与自包含说明。

---

## v2.3.1 — 28 项数据集标签覆盖修复（人口/红色视图只有 4 个标签）

针对用户录屏反馈修复：**海拔（7 项）、面积（14 项）视图标签齐全，但人口、红色
（均 28 项）两个视图全景期只有前 4 名有标签**（24/28 秃柱）；跟随期目标柱不在
前 4 名时，同框 ~5 根柱子只有目标自己有名字。

### 根因（`BarRace3D.vue` 标签选取公式）

```js
const labelTopN = n <= 18 ? 10 : Math.max(4, Math.round(16 / Math.sqrt(n)));
// n=28 → max(4, round(3.02)) = 4
```

`showLabel` 条件为 `n ≤ 16 全显 || rank ≤ labelTopN || 高亮 || 活跃`：
n=28 时只有名次前 4（+高亮/活跃）带标签。该公式本意是防几十项标签糊成一片，
但在 1920 宽长焦全景下严重保守——实测全景柱距 ≈51px、标签宽 ≈90~118px，
"隔一根显示一个"（间距 ≈102px）即可互不重叠，4 个的密度远低于可用空间。

### 修复（三层标签策略）

1. **n ≤ LABEL_MAX_ALL(16)**：全部贴标签（海拔/面积行为不变）。
2. **n 更大时自适应步距 stride 稀疏铺满**：`stride = ceil(实测标签宽 / 全景柱距像素)`
   （上限 6），从队首起每 stride 根显示一个；队尾（第 1 名，观众最关心）按半步距
   补位必显；高亮主角柱（hl）与当前活跃柱保底必显。1920 宽 / 28 项 / 最长名
   "新添堡回族乡"(7 字)：pitch≈51px、标签宽≈90px → stride=2 → **15 个标签、
   间距 102px，无重叠**（修复前 4 个）。
3. **跟随期窗口**：t ≤ reveal 时活跃柱 ±FOLLOW_LABEL_WIN(4) 全部显示——
   同框仅 ~5 根、柱距 ~356px，"正在逐个讲解"阶段每根可见柱子都有名字
   （修复前非前 4 名目标只有自己 1 个标签）。

### 回归与防护

- `verify.mjs` 新增 **6 项标签覆盖硬指标**（23 → 29 项）：n≤16 视图全景标签数
  =n（elev 7/7、area 14/14）；n=28 视图（pop、red）全景 ≥10 个（实测 15/28）、
  跟随期窗口全显 ≥9 个（实测 14）。
- 其余全部回归通过：`npm test` 32/32 · `interact.mjs` 7/7 ·
  `verify-playback.mjs` 播放无空白帧 · 出片管线端到端（pop 视图 90 帧 MP4，
  全景帧 15 标签均匀无重叠）。

## v2.3.0 — 播放空白 / 跟随期构图 / 标签覆盖 三大缺陷修复

针对用户实测反馈的两个缺陷做根因修复：
① 页面观看时跟随期**画布完全空白**，直到动画结束才"一次性"出现所有柱子；
② 录制出的视频里跟随期**柱体巨大、倾斜、贴脸裁切**，且部分柱子顶部名称缺失。

### 1. 播放期画布空白（`BarRace3D.vue` — 根因修复）

**根因**（用无头浏览器实测复现）：`loop()` 每帧 `chart.setOption(opt, { notMerge: true })`。
`notMerge` 会把上一次的 echarts-gl 场景（grid3D + bar3D 网格 + 全部 GL 资源）**整体销毁重建**，
实测单次重建 9~90ms（低端 GPU / 软件渲染更甚）。帧间隔 16ms 内下一次 setOption 又把场景清掉，
GL 层永远处于"已清空、未画完"状态 → 播放全程空白；动画结束循环停止后，最后一次重建
才得以完成 → 用户只看到结尾全景（"最后才显示所有的柱子"）。

**修复**：
- 仅实例首次（或上下文恢复重建后）做全量 `notMerge` 构建；此后逐帧 **merge 增量更新**
  （series data + viewControl），GL 网格原地更新，不再整场景重建。
- merge 更新不会自动清除上一帧的逐项 label —— `mkBar` 改为**每帧显式声明**
  `label: { show, formatter }`，杜绝"上一帧有标签、这一帧不该有"的残留。
- 播放循环增加 **30fps 渲染节流**：时间轴仍按真实时间推进（总时长不变），仅 GL 更新
  降频，慢设备不再积压卡死。

**验证**：`scripts/qa/verify-playback.mjs`（真实播放模式全程多点采样，断言无空白帧、
无页面异常）；`verify.mjs` 的确定性/标签/WebGL 用例同步回归。

### 2. 跟随期构图：柱体巨大倾斜、裁顶裁底（`BarRace3D.vue` — 参数级重标定）

**根因**（两处叠加）：
- **echarts-gl 的 `viewControl.fov` 根本不生效**：其源码无任何读取 fov 的路径，
  clay 透视相机恒为默认 50° 广角。广角 + "5 根柱同框"的近距构图 → 画面边缘柱体
  透视倾斜达 ~40°、柱体占满全屏双向裁切、地面线不可见。
- 注视点高度 cy 由一张绑定 FOV=50/dist≈24 的**像素标定表**反解，参数一变整表失效。

**修复**：
- 新增 `ensureGLFov()`：每次 setOption 后把长焦 FOV=16 直写 GL 相机
  （`grid3D.coordinateSystem.viewGL.camera`）。实测 merge 更新不会重置该值。
  长焦把画面边缘透视从 ~40° 压到 ~14°，柱体近乎平行排列。
- **跟随期注视点贴地**（`CY_GROUND=-1.2`，`diag-calib2.mjs` 逐档实测标定）：
  地面线稳定落在画面 ~85% 高度，柱体自地面向上生长、完整入画。
- **跟随期相机距离固定**（`FOLLOW_DIST=87` 场景单位）：旧行为按视口 aspect 反推距离，
  导致"地面线位置"随视口漂移 13% 屏高；固定后垂直构图对所有 aspect 一致，
  水平同框柱数随 aspect 自适应（16:9 ≈ 5.4 根、≈2:1 ≈ 6 根）。
- **水平轨道边界**：注视点限制在数据范围内（±(半宽 − 0.65×半窗)），修复跟随到
  队首/队尾时画面一半落在无柱区（队尾右侧空半屏）的问题。
- 全景期注视点改为世界比例（`worldH × 0.62`），14 柱 + 全部标签完整入画。

**验证**：`verify.mjs` 新增跟随期构图回归硬指标（柱底 ≤98% 屏高、同框内容外接框
45%~98%，统计排除 HUD 装饰线干扰）；`diag-calib2.mjs` / `diag-frames.mjs` 为
相机标定与构图预览工具（可复现）。

### 3. 跟随期部分柱子顶部名称缺失（`BarRace3D.vue`）

**问题**：`LABEL_MAX_ALL=12` —— 14 个乡镇的数据集只有名次前 8（+高亮/活跃）的柱子
带标签，用户实测"部分柱子的顶部名称未显示"。

**修复**：`LABEL_MAX_ALL` 提至 **16**（覆盖常规乡镇/区县级数据集"每根柱子都有名字"
的预期）；n>16 时仍按"名次靠前 + 高亮 + 活跃"降密度，避免几十项糊成一片；
超宽名称仍按码点截断（v2.2.0 的 label_overflow 防护不变）。

**验证**：`verify.mjs` 全景帧标签断言 + 截帧目检（14/14 标签完整、相邻标签因柱高
阶梯自然错位不重叠）。

### 升级与回归

- 全套回归：`npm test`（32/32）· `npm run qa`（23/23 + 7/7）·
  `node scripts/qa/verify-playback.mjs`（播放无空白）。
- 出片管线端到端：`node scripts/render.mjs --view area --frames 90 --fps 30`
  生成 1920×1080 MP4，跟随期/全景期构图均正常。

## v2.2.0 — WebGL 上下文容错 / 中文标签加固 / 配置健壮性 / CLI 体验

本轮针对"无头逐帧截图 + 长时间预览"场景下的四个稳定性与体验问题做了修复，
并为每项补上可复现的自动化验证。

### 1. WebGL 上下文丢失导致渲染不可逆崩溃（`BarRace3D.vue`）

**问题**：无头 Chromium 逐帧截图或长时间预览时 GPU 资源可能耗尽，触发
`WebGL context lost`。原代码未监听该事件——浏览器默认行为会**永久销毁**上下文，
渲染不可逆崩溃（画面从此空白）。

**修复**：
- 在图表容器内真正的 `<canvas>` 上监听 `webglcontextlost` / `webglcontextrestored`
  （ECharts 容器 `div` 上不会冒泡该事件）。
- 丢失时：`event.preventDefault()`（**关键**——不调用则浏览器不会派发 restore 事件）、
  置 `isContextLost`、`cancelAnimationFrame` 暂停循环、记录待恢复帧进度。
- 恢复时：`initChart()` 重建 ECharts 实例与 GL 资源，重放丢失前最后一帧；
  截帧模式下重新置 `document.body.dataset.ready='1'`，避免出片管线误判失败帧。
- 抽出 `initChart()` 供 `onMounted` 与恢复流程共用；每次重建后重新挂载监听。
- 新增丢失/恢复计数（`getContextLossCount` / `getContextRestoreCount`）便于观测。

**验证**：`verify.mjs` 用 `WEBGL_lose_context` 扩展强制丢失，断言事件被捕获、
计数递增、页面无未捕获异常、canvas 未被销毁。
（注：swiftshader/headless 下 `restoreContext()` 可能被浏览器拒绝——属环境限制，
应用侧保证"捕获 + preventDefault + 暂停循环"。）

### 2. 中文标签"逐字换行/竖排"（`index.html` / `BarRace3D.vue` / `config.js`）

**问题**：无头环境或字体未完全加载时，canvas `measureText` 测量异常，把每个汉字
当成超宽字符 → 标签逐字换行（视觉上竖排）。原 `document.fonts.ready` 守卫在极端情况下仍可能失效。

**修复（三重保险）**：
1. `index.html` 用 `@font-face` 显式声明 `Noto Sans CJK SC`（系统自带），
   多 `local()` 回退 + `font-display: swap` + `<link rel="preload">`。
2. `config.js` 的 `normalizeConfig` 为 `items.name` 增加**强制截断**：超过 12 个码点
   即截为「前 12 字 + …」（按码点截断，不劈 emoji / 代理对），并输出告警。
3. `BarRace3D.vue` 新增 `measureTextWidth()`，**每次测量前显式设置 ctx.font**
   （`bold 16px "Noto Sans CJK SC",...`），杜绝字号/字体串污染；标签渲染字体与测量字体
   统一由常量 `LABEL_FONT_FAMILY` / `LABEL_MEASURE_FONT` 管理，确保"测量=渲染"。
   另按标签可用宽度二次收缩超长名称，从源头防重叠。

**验证**：`verify.mjs` 新增 `label_overflow` 检测——页面内用同一字体测量
「6 汉字」整串宽 / 单字宽，正常应 ≈6.00（逐字换行退化时会 ≈1）。

### 3. 配置验证与数据健壮性（`config.js`）

**问题**：`normalizeConfig` 对 `items` 的验证不够严格，非数字/负数/缺 `name` 的条目
可能进入渲染，导致 ECharts 异常。

**修复**：严格校验每条 `items`——非对象跳过、`name` 缺失/空白跳过、
`value` 非有限数**归零**（保留条目便于定位脏数据）、负数**取绝对值**、
名称去重、超长截断、`highlight` 布尔化；每类问题均写入 `warns`。**仍绝不抛异常**。

**验证**：新增零依赖单元测试 `scripts/qa/config.test.mjs`（32 项断言），
覆盖 `null` / 数组 / 原始值 / 空名 / `NaN` / `Infinity` / 负数 / 重名 / 超长名 /
emoji 截断 / 顶层兜底等畸形输入。

### 4. CLI 出片错误处理与体验（`capture-core.mjs` / `render.mjs`）

**修复**：
- `resolveChromium()` 未找到浏览器时，错误信息明确给出 `CHROMIUM_PATH` /
  `CHROME_PATH` 用法与各平台安装命令。
- `pickEncoder()` 未找到 `ffmpeg` 时给出"请安装 ffmpeg 并确保其在 PATH 中"+ 安装指引；
  已装但无可用编码器时也给出针对性排查建议。
- `render.mjs` 在 `main()` 开头校验 `--frames`（正整数 ≥2）与 `--fps`（1–60），
  非法时列出具体问题并 `exit(2)`，避免跑很久才失败。

**验证**：命令行实测非法参数（`--fps 99` / `--frames abc` / `--frames 1`）均给出
明确提示；隔离环境下验证两条依赖缺失错误文案完整。

---

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
