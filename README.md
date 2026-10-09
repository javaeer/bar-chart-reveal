# 柱状数据揭晓 · 配置驱动可视化与出片工具（bar-chart-reveal）

> 任意数据集（`[{name, value, highlight?}]`）+ 任意主题 + 任意标题 → **浏览器动画预览** 与 **CLI 出片 MP4**。
> 不再局限于会宁县：公司部门产出、行星参数、任意「谁大谁小」的对比都能一键成片。
> 技术栈：Vue3 + Vite + ECharts-GL（3D `bar3D`）+ puppeteer-core + ffmpeg。

---

## 一、它是什么

每个条目一个 3D 柱体，按指标**由低到高逐条弹出**，镜头连续跟随当前活跃柱，最后平滑拉远、抬升，把全部柱体收入画面。WebGL 实时渲染，浏览器里直接看动画；用无头 Chromium 逐帧截图 + ffmpeg 合成，即可得到 MP4。

| 能力 | 说明 |
|---|---|
| 配置驱动 | 数据/标题/主题/形状全部来自一个 JSON 配置，零代码改内容 |
| 多视图 | 一个 config 可含多个指标视图（如面积/人口/海拔/红色指数），分别出片 |
| 多形状 | 方柱 / 立方体 / 圆柱 / 圆角柱 / 球体，视图级或全局指定，URL 可切换 |
| 浏览器预览 | `npm run dev`，支持 `?t=` 确定性单帧、URL 参数切视图/主题/配置 |
| CLI 出片 | `npm run render`，自动选编码器、自动 Xvfb、逐帧新浏览器进程 |

### 动画时间轴（`t: 0 → 1`）

| 阶段 | 区间 | 画面 |
|---|---|---|
| 逐条出现 | `0 → revealRatio(默认0.72)` | 柱体按指标升序依次弹出（带轻微回弹），镜头连续跟随当前活跃柱 |
| 拉远收束 | `revealRatio → 1` | 镜头从跟随平滑拉远抬升，收入全部柱体 |

> 浏览器动画与截帧**共用同一个 `computeFrame(t)` 纯函数**，保证出片与预览逐帧一致（`?t=` 截帧模式由 `BarRace3D.vue` 实现并置 `document.body.dataset.ready='1'`）。

---

## 二、快速开始

```bash
npm install                          # 安装依赖
npm run dev                          # 开发预览：浏览器打开 http://localhost:5173
npm run build                        # 生产构建，输出到 dist/
npm run render                      # 出片（默认 samples/huining.json 全部视图）
```

出片依赖（仅出片时需要）：系统 `chromium`（或设 `CHROMIUM_PATH`）、`ffmpeg`（含 libx264 / libopenh264 / libvpx-vp9 之一）。脚本会自动探测浏览器路径、自动选编码器、显示不可用时自动拉起 `Xvfb`。

### 浏览器内「导出 WebM」按钮

页面底部工具条含 **⏺ 导出 WebM**，点击后在浏览器内录制成 `.webm` 并自动下载：

- 采用**确定性逐帧录制**：先 `beginRecord()` 暂停实时循环并归零，再按 30fps 逐帧
  `renderAt(t)` 渲染，每帧 `track.requestFrame()` 主动推帧。
  → 导出内容 = `computeFrame(t)` 全流程，**与浏览器播放逐帧一致，且不受"何时点击"影响**
  （旧实现直接抓实时画面，动画播完再点就只录到静止结尾帧）。
- 录制时长自动对齐当前配置的 `durationMs`（无需手填），并保留结尾停留帧。
- 依赖浏览器的 `MediaRecorder` + `captureStream`（Chrome / Edge 支持良好）。
  **注意**：无头（headless）环境下 `captureStream` 常抓不到帧，请在**有界面的真实浏览器**中使用；
  若需严格确定性的成片，优先用下方 CLI 出片（`npm run render`）。
- 若中文标签出现"逐字换行/竖排"，是系统字体尚未加载完成导致 canvas 测量异常；
  应用已加 `document.fonts.ready` 守卫，极端情况下刷新一次即可。

---

## 三、配置 Schema（`src/core/config.js`）

```jsonc
{
  "title": "会宁县乡镇数据 · 3D 对比",
  "subtitle": "示例数据 · 用于演示工具通用性",
  "theme": "tech",                     // 主题名（见主题对象），或内联主题对象
  "defaultShape": "bar",               // 全局默认形状，视图未指定时回退到它
  "highlightLabel": "重点",            // 高亮项图例文案（可空）
  "revealRatio": 0.72,                 // 0..1，逐条出现所占时间轴比例
  "durationMs": 7200,                  // 动画总时长（毫秒）
  "views": [                           // 1..N 个可切换视图（指标）
    {
      "key": "area",                   // 视图键（URL 参数用）
      "label": "行政区域面积",          // 完整标题
      "short": "面积",                 // 简称
      "shape": "cylinder",             // 视图级形状，覆盖 defaultShape（可空）
      "unit": "km²",                   // 数值单位
      "fixed": 0,                      // 数值小数位
      "items": [
        { "name": "会师镇", "value": 88, "highlight": true },
        { "name": "郭城驿镇", "value": 288 }
      ]
    }
  ]
}
```

- 字段说明：`theme` 为主题名（如 `tech`/`aurora`/`sunset`/`mono`）或内联主题对象；`items` 中 `highlight:true` 的条目用高亮色（金色等）强调。
- 形状：`shape`（视图级）/ `defaultShape`（顶层默认）取 `bar`（方柱，默认）/ `cube`（立方体）/ `cylinder`（圆柱）/ `rounded`（圆角柱/胶囊）/ `sphere`（球体）。优先级 **视图 `shape` > 顶层 `defaultShape` > `bar`**；非法值回退 `bar` 并产生告警。
- 内置 `DEFAULT_CONFIG`（会宁县 4 视图 area/pop/elev/red，会师镇高亮）等价于原 `dataset.js`。
- `normalizeConfig(raw)`：补齐默认值、过滤非法项（`value` 非数/负、`name` 空）、保证每个 `view` 至少 1 条 `items`；**不抛异常**，返回 `{ config, warns }`。
- `encodeConfig(obj)` / `decodeConfig(str)`：base64url（UTF-8 安全，`+/`→`-_`、去 `=`），浏览器与 Node 通用，用于把配置塞进 URL 的 `cfg=` 参数。

### 形状类型（Shape）

| 形状 | 键名 | 渲染实现 | 适用场景 |
|---|---|---|---|
| 方柱 | `bar` | `bar3D`（小倒角） | 默认，最稳、最省性能 |
| 立方体 | `cube` | `bar3D`（直角，正方形截面） | 强几何感、科技风 |
| 圆柱 | `cylinder` | `bar3D`（`bevelSize=1` 全圆角截面） | 柔和的柱状观感 |
| 圆角柱 | `rounded` | `bar3D`（中等倒角 + 正方形截面） | 现代卡片风 |
| 球体 | `sphere` | `scatter3D`（半径编码数值） | 用**球径**而非柱高编码数值，视觉更活泼 |

> **球体的语义差异**：球体用「球的直径」表达数值大小（球越大 = 数值越大），球心贴近底面；其余四种用「柱高」表达。同一视图内不要混用语义，画面才易读。
> 切换形状时组件会自动 `notMerge` 重建场景；连续切换 5 种形状在 QA 中有「无未捕获异常」断言兜底。

**球体的尺寸映射（v2.4.1）**：半径按 `ratio^0.68` 压缩（而非线性），兼顾"悬殊数据下小球不退化"与
"大小差异仍清晰"；球体由**四层同心贴片**叠加（外圈光晕 / 主体 / 提亮过渡 / 近白高光）伪造径向受光，
因为 echarts-gl 的 `scatter3D` 是恒正对相机的 billboard 贴片、本身无光照（单层会像扁圆点）。
尺寸会随相机距离做透视补偿，全景收尾时球群仍饱满。

### 控件面板（科技风 dock）

底部控件为**分组胶囊 dock**：`视图 / 形状 / 主题 / 操作` 四组，桌面 2×2、窄屏单列堆叠；
形状按钮带内联 SVG 几何图标，选中态为青蓝渐变实心胶囊 + 外发光。
根节点保留 `.ui` 类作为 DOM 契约（既有脚本/自定义样式可继续选择）。

### 如何新增数据集

1. 复制 `samples/huining.json`，改 `title`/`subtitle`/`views`（视图即指标，`items` 即条目），可按需加 `shape`/`defaultShape`。
2. 数据务必标注性质：真实数据请注明来源；示例/合成数据请写明「示例数据 · 用于演示工具通用性」，避免编造易被证伪的事实。
3. 浏览器里可直接用 URL 预览，无需构建：
   ```
   /?t=0.5&view=area&theme=tech&shape=cylinder&cfg=<base64url(configJSON)>
   ```
   （`cfg` 由 `encodeConfig` 生成；`shape=` 可在运行时覆盖形状，便于快速比稿。）

---

## 四、CLI 用法（`scripts/render.mjs`）

```
node scripts/render.mjs --config samples/huining.json [--view area] [--theme tech] \
  [--frames 180] [--fps 30] [--out out/huining_area.mp4] [--poster out/huining_area.png] [--all-views]
```

| 参数 | 默认 | 说明 |
|---|---|---|
| `--config` | `samples/huining.json` | 配置 JSON 路径 |
| `--view` | 全部视图 | 仅渲染指定 `view` 键；省略则渲染全部（`--all-views` 等价） |
| `--theme` | 配置内 `theme` | 覆盖主题名 |
| `--shape` | 配置内 `shape` | 覆盖形状（`bar`/`cube`/`cylinder`/`rounded`/`sphere`） |
| `--frames` | `180` | 截帧数（≥2） |
| `--fps` | `30` | 输出帧率 |
| `--out` | `out/<configName>_<view>.<编码器扩展名>` | 输出视频路径（多视图时自动插入 `_<view>`） |
| `--poster` | `out/<configName>_<view>.png` | 海报图（首帧）路径 |
| `--all-views` | — | 渲染该 config 的全部视图 |

页面 URL 契约：`/?t=<0..1>&view=<viewKey>&theme=<themeName>&cfg=<base64url(configJSON)>`（capture 模式隐藏 UI）。

示例：
```bash
# 会宁县全部 4 个视图各出一片
npm run render

# 仅渲染部门示例的 Q4，自定义帧率与输出
node scripts/render.mjs --config samples/departments.json --view q4 --fps 24 --out out/dept_q4.mp4

# 行星直径 + 质量两个视图
node scripts/render.mjs --config samples/planets.json --all-views --frames 240
```

> 旧入口 `scripts/capture.mjs` 保留为薄封装：`node scripts/capture.mjs [frames]` ≡ `render.mjs --config samples/huining.json --all-views [--frames N]`。

---

## 四·五、质量保障（QA）

内置六套验证脚本（均可直接运行，无需手动先起 dev server）：

```bash
# —— npm 快捷入口（推荐）——
npm test                # 纯逻辑单元测试（无需浏览器）
npm run qa              # verify.mjs + interact.mjs（需 chromium + Xvfb）
npm run qa:playback     # 真实播放模式全程采样（自动构建 + 自启静态服务）
npm run qa:all          # 一键跑全部 QA

# —— 直接调用 ——
node scripts/qa/config.test.mjs     # 纯逻辑单元测试：配置规范化 / 数据健壮性（无需浏览器）
node scripts/qa/verify.mjs          # 构图硬指标（全景+跟随期）/ 形状渲染 / 逐条出现 / 镜头跟随 / 确定性 / 标签覆盖与换行 / WebGL 上下文丢失
node scripts/qa/interact.mjs        # 交互回归：视图·主题切换 / 重播 / 数据表 / CSV / 控制台异常
node scripts/qa/verify-playback.mjs # 真实播放模式全程采样：断言无空白帧（自动构建 dist + 自启静态服务）
node scripts/qa/diag-frames.mjs     # 相机构图预览：多 t 值截帧（调参迭代用）
node scripts/qa/diag-calib2.mjs     # 相机注视点标定：扫描 cy 实测地面线位置（调参迭代用）
```

> 截图/中间产物默认写入系统临时目录（`os.tmpdir()`），可用环境变量 `QA_ART=/your/dir` 覆盖。
> 浏览器可通过 `CHROMIUM_PATH` / `CHROME_PATH` 指定；无显示器环境脚本会自动拉起 Xvfb。

`verify.mjs` 会输出每项指标实测值（例：全景柱体外接框 **宽 98.3% / 高 47%–49%**，远超 ≥62%/≥45% 的硬指标；
跟随期柱底 85.7% 完整入画、同框内容 84.8%；逐条出现亮像素质心 1.8k→700k 单调增长；镜头跟随内容质心
活动范围 ~177px；同 `t` 两次渲染差异 0.000%）。

**最近一次实测（1920×1080）**

| 项目 | 结果 |
|---|---|
| 构图（4 视图全景） | 宽 98.3% / 高 46%–53%（柱体族硬指标 ≥62%/≥45%；球体视图高占比放宽至 ≥18%）✅ |
| 形状渲染（v2.4.0 新增） | bar/cube/cylinder/rounded 亮像素均 >55 万、sphere 10.6 万，连续切换 5 种形状零异常 ✅ |
| 跟随期构图（v2.3.0 新增） | 柱底 83.7%（≤98% 硬指标）/ 同框内容 84.1% ✅ |
| 由低到高逐条出现 | 亮像素 1,841 → 572,930，单调增 ✅ |
| 镜头跟随 | 内容质心活动范围 Δcx = 202px ✅ |
| 结尾全景 | 跟随末帧 84.1% 宽 → 全景 78.8%，全柱入画 ✅ |
| 确定性（同 t 两次） | 像素差异 0.002% ✅ |
| 标签覆盖（v2.3.1 新增） | 海拔 7/7、面积 14/14 全贴；人口/红色（n=28）全景 15 个、跟随期 14 个（修复前仅 4 个）✅ |
| 中文标签（label_overflow） | 整串测宽/单字宽 = 6.00（无逐字竖排）✅ |
| WebGL 上下文丢失 | 事件捕获 + 暂停循环 + 无未捕获异常 ✅ |
| 配置单元测试 | 47/47 通过 ✅（v2.4.0 增补 15 项形状断言） |
| QA 汇总 | 35/35 通过 ✅（v2.4.1 构图断言按形状区分阈值） |
| 交互回归 | 7/7 通过（视图/主题/重播/数据表/CSV/控制台零异常）✅ |

> **WebGL 上下文容错说明**：`BarRace3D` 监听 `webglcontextlost`/`webglcontextrestored`。
> 丢失时 `preventDefault()` 并暂停渲染循环；恢复时重建 ECharts 实例并重放最后一帧。
> 注：`webglcontextlost` 监听必须挂在 **ECharts 内部的 `<canvas>`** 上，且该 canvas 在
> 首次 `setOption` 后才存在——因此挂载时机在渲染之后（`ensureContextWatchers()`），
> 这是本轮修的一个隐蔽坑：早挂在 `echarts.init()` 后会因 canvas 未创建而静默失效。

---

## 五、目录结构

```
huining-3d-vue/            （npm 包名已改为 bar-chart-reveal）
├── index.html             # 通用标题入口
├── package.json           # name=bar-chart-reveal，scripts 含 render
├── vite.config.js
├── samples/               # 示例配置（≥3，含非会宁通用示例）
│   ├── huining.json       # 会宁县多视图（area/pop/elev/red）
│   ├── departments.json   # 某科技公司部门季度产出（合成示例）
│   └── planets.json       # 太阳系行星基础参数（近似值示例）
├── scripts/
│   ├── render.mjs         # 出片 CLI（配置驱动）
│   ├── capture.mjs        # 旧入口薄封装 → render.mjs --all-views
│   ├── lib/capture-core.mjs  # 出片管线核心（Xvfb/编码器/截帧/合成）
│   └── qa/                # 质量保障：verify.mjs（视觉/行为）+ interact.mjs（交互回归）
├── src/
│   ├── core/config.js     # 配置规范化 + base64url 编解码 + DEFAULT/SAMPLE
│   ├── theme.js           # 主题对象（专家A）
│   ├── App.vue            # 主布局 / 截帧模式识别（Lead）
│   ├── components/BarRace3D.vue  # 3D 柱体 + 动画/截帧核心（专家A）
│   └── ...                # 数据工具条/表/CSV 等（Lead 改造为配置驱动）
└── README.md
```

---

## 六、踩坑记录（出片管线四条铁律）

1. **每帧必须用全新浏览器进程**：持久复用浏览器连开数十页会让 swiftshader 的 WebGL 上下文耗尽，会话崩溃。→ `capture-core` 每帧 `puppeteer.launch` 全新进程。
2. **不要用 chromium CLI 的 `--screenshot` / `--virtual-time-budget`**：该模式下 GPU 进程不启动、WebGL 不可用，截出 *"Sorry, your browser doesn't support WebGL."* 空白页；且空白 PNG 体积也会超过阈值被误判有效帧。→ 改用 puppeteer 并等待 `document.body.dataset.ready === '1'` 再截。
3. **页面务必用 `127.0.0.1` 访问**：chromium 会把 `localhost` 优先解析成 IPv6 `::1`，而服务若只监听 IPv4 就连不上，同样截出空白页。→ 静态服务显式监听 `0.0.0.0`，页面用 `127.0.0.1`。
4. **无显示器环境自动拉起 Xvfb**：否则 ANGLE/WebGL 退化为极慢软件路径甚至超时；且不能只看 `DISPLAY` 是否存在（很多环境预设了实际不可用的 `:0`）。→ 用 `xdpyinfo` 实际探测，不可用再自建 Xvfb。

> 额外工程教训（可视化层）：
> - echarts-gl 的 `bar3D` **不支持函数式 label 配置**（`offset`/`distance`/`formatter` 传函数会被静默忽略甚至导致标签消失）——标签样式必须传常量；本项目改为**逐数据项常量 `label`**（`formatter` 传字符串、逐项开关 `show`）。
> - **构图是第一优先级**：相机 `distance` 与 `boxWidth` 必须按柱体数量自适应（本项目按柱体外接框反推距离，使全景占宽 ≥62%）。曾因相机拉太远（distance≈138、boxWidth=52）导致柱子缩成小点、画面 90% 空白——这是最典型的"看上去很科技、其实没内容"翻车。
> - **极值悬殊数据**：线性高度会让小值柱体被压成"纸片"（如行星质量 木星 317.8 vs 水星 0.055）。`computeFrame` 对高度系数设下限 `hFrac = H_FLOOR + (1-H_FLOOR)*ratio`（`H_FLOOR=0.08`），保证每根柱体可见；颜色与标签仍用真实值。
> - **主题必须贯穿**：App 侧 HUD（网格/地平线/面板/进度条）的颜色要经 CSS 变量（`--cy`/`--cy-dim`）取自主题，避免"切换主题但 HUD 还是青色"的割裂。
