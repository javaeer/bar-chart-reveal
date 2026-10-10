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
| **双格式数据** | 既吃**内部格式**（`views[].items[]`），也吃**规范数据模板 v2**（`dataset/metrics[]/entities[]`），自动识别、无需转写 |
| 多视图 | 一个 config 可含多个指标视图（如人口/面积/红色遗址数），分别出片 |
| 多形状 | 方柱 / 立方体 / 圆柱 / 圆角柱 / 球体，视图级或全局指定，URL 可切换；**圆柱为 surface 参数化真圆柱（直壁+平顶，v2.8.1）** |
| **多画幅** | `16:9` / `9:16` / `1:1` / `4:3`，**预览取景框与导出像素同源**（所见即所得，v2.8.1 修复画布尺寸跟随） |
| **播放节奏** | 每根柱子弹出间隔（默认 2s）可调，总时长自动推导；也支持直接锁定总时长 |
| **信息可编辑** | 标题 / 副标题 / 来源 / 备注在页面上直接改，即时同步到画面与出片 |
| **信息入画（v2.7）** | 标题 / 当前视图 / 来源备注位于**取景框内部**，随画面缩放；**浏览器内导出 WebM 亦合成信息层**（v2.7.1 修复：此前 `captureStream` 只录 WebGL 画布，导出缺信息层）。**v2.8.3 移除「当前目标」卡**：该卡竖屏下宽达取景框 62.7%、纵跨 57%~81%，是"遮挡柱体严重"的结构性根因，移除后信息层只剩贴边三块，画面中央完全让给柱阵 |
| **暂停 / 继续（v2.8.3）** | 底部操作分组内、**「重播」之前**；文案与图标随状态切换（⏸暂停 / ▶继续）；支持**空格键**快捷键；仅作用于预览播放，不进出片链路 |
| **开场可见性（v2.8.3）** | 首根柱**从 t=0 即开始生长**（消除开场空窗），并保证同屏常驻 ≥2 根柱体、其中一根在生长（生长窗口故意重叠 + 注视点偏向生长方向） |
| **连续跟随（v2.9.0）** | 相机注视点改为**时间连续的出生前沿**（`t/(step·STAGGER)`，线性于 t），彻底消除「每换一根柱整屏硬跳」（单次最大 |Δcx| **6.00 → 0.71**，切换同刻硬跳 **27 → 0**） |
| **画幅自适应（v2.9.0）** | 跟随期距离按画幅反推（`TARGET_BARS_X = 3.6`）做**下限保证**：竖屏同屏柱数 **1.72 → 3.60** 根（换柱位移占屏比 **58.2% → 27.8%**）；16:9 / 4:3 维持原值零回归 |
| **单模板往返（v2.10.0）** | **一个 JSON 模板驱动全部动态数据**：点「⤓配置」导出全量配置（视图分类 + 柱体数据 + 元信息 + 主题/形状/画幅/间隔/时长），再导入即整体替换；支持**拖拽导入**与**一键撤销**。往返**逐字节无损**（实测 28 实体 / 3 视图） |
| 浏览器预览 | `npm run dev`，支持 `?t=` 确定性单帧、URL 参数切视图/主题/形状/画幅/节奏/主角/配置 |
| **CLI 出片** | `npm run render`，自动选编码器、自动 Xvfb、**单进程多帧渲染（v2.8.0，比逐帧新进程快 7×）**、按画幅推导分辨率；`--engine perframe` 可切回旧路径，失败自动回退 |
| **排版单一事实源（v2.8.0）** | 信息层的全部分寸由 `overlay.js:overlayMetrics()` 唯一定义，DOM 预览与 Canvas 录制**同源消费**，预览即出片 |

### 动画时间轴（`t: 0 → 1`）

| 阶段 | 区间 | 画面 |
|---|---|---|
| 逐条出现 | `0 → revealRatio(默认0.72)` | 柱体按指标升序依次弹出（带轻微回弹），镜头连续跟随当前活跃柱 |
| 拉远收束 | `revealRatio → 1` | 镜头从跟随平滑拉远抬升，收入全部柱体 |

> **生长节奏（v2.8.3 定案）**：第 k 根柱的**生长起点** = `k × step × 0.85`
> （`step = revealRatio / n`）—— 起点系数 0.85 < 1 使相邻生长窗口**故意重叠**，
> 于是**同屏常驻 ≥2 根柱体，其中一根正在生长**；且 k=0 的起点恰为 `t=0`，
> 开场第一帧就有柱体在生长（不再有"空白开场"）。
> 单根生长时长按**秒**给定（`GROW_SEC = 0.55s`，clamp 在 `step×0.9 ~ step×2.2`），
> 缓动为「smoothstep 主体 + 衰减回弹余项」`f(u)=(3u²−2u³)+0.16·u⁶·(1−u)³`
> ——起点斜率 0（真·从 0 生长）、峰值约 +6% 过冲、端点 `f(0)=0`/`f(1)=1`。
> 已开始的柱在起点帧即有极小**种子高度**（0.6% 满高，约 4px），避免首帧全空。

> 浏览器动画与截帧**共用同一个 `computeFrame(t)` 纯函数**，保证出片与预览逐帧一致（`?t=` 截帧模式由 `BarRace3D.vue` 实现并置 `document.body.dataset.ready='1'`）。

---

## 二、快速开始

```bash
npm install                          # 安装依赖
npm run dev                          # 开发预览：浏览器打开 http://localhost:5173
npm run build                        # 生产构建，输出到 dist/
npm run render                      # 出片（默认内置 v2 模板 src/data/huining-v2.js 的全部视图）
```

出片依赖（仅出片时需要）：系统 `chromium`（或设 `CHROMIUM_PATH`）、`ffmpeg`（含 libx264 / libopenh264 / libvpx-vp9 之一）。脚本会自动探测浏览器路径、自动选编码器、显示不可用时自动拉起 `Xvfb`。

### 右侧控件 dock（v2.7 起停靠右侧；v2.7.1 数据操作并入）

控件 dock 采用**右侧竖排面板**（固定 236px 宽，组内自动换行、超高可滚动），
是全站**唯一**的控制栏（v2.7.1 起原右上角数据工具条并入为「数据」分组），
左侧完整留给画面主体。包含七组控件：

| 分组 | 内容 |
|---|---|
| 视图 | 该配置的全部指标视图 |
| 形状 | 方柱 / 立方体 / 圆柱 / 圆角柱 / 球体（带几何图标） |
| **比例** | `16:9` / `9:16` / `1:1` / `4:3`（带等比小窗图标） |
| **间隔** | `1s / 1.5s / 2s / 3s / 5s` + 时长读数（自动 / 手动） |
| 主题 | 全部内置主题 |
| **数据（v2.7.1 并入，v2.10.0 扩充）** | CSV 模板 / 导入（CSV **或** JSON，也可**拖文件到本栏**）/ 导出 CSV / **⤓配置（导出全量 JSON 模板）** / **↩撤销（撤销最近一次模板导入）** / 数据表 / 信息 + 操作反馈 |
| 操作 | 重播 / 导出 WebM |

> **自适应降级**：窄屏（≤860px）或竖屏窗口下，dock 自动退回底部横向流式布局，
> 取景框同步避让（右侧布局时画面按可用区居中、与右栏零重叠——由 JS 实测面板宽度计算）。

### 画面内信息层（v2.7，导出视频的一部分）

以下信息位于**取景框内部**（`.vp-overlay`），尺寸随画幅等比缩放，**导出视频直接包含**：

| 元素 | 位置 | 说明 |
|---|---|---|
| 标题 / 副标题 | 画面左上 | 限宽自动折行，极窄画幅下占 ≤74% 宽、副标题限 2 行（v2.8.3） |
| 当前视图徽标 | 画面右上 | 如「当前视图 · 人口 · 人」 |
| 来源 / 备注 | 画面左下（竖屏画幅自动移右下，限 3 行） | 对应 v2 模板 `dataset.source` / `dataset.notes[]` |

> **v2.8.3：原「当前目标卡片」已移除**（用户指令）。该卡竖屏下宽达取景框 62.7%、
> 纵跨 57%~81% 且横跨中线，使"左中/左下/右下"三块同时被占、柱阵无处可躲
> （实测 9:16 重叠率 **70.8%**，来源 81.1%）。移除后三块信息全部**贴边**，
> 画面中央与两侧主体完全让给柱阵 —— 这是比"挪构图去躲面板"更彻底的解法。

> 屏幕级 UI（控件 dock（含数据分组）/ 数据表 / 信息面板 / 操作提示）在出片模式
> 自动隐藏，**不会**进入导出画面；上述信息层则**保留**并在 CLI 出片中逐帧一致。

> 切到 `9:16` 时取景框会立刻变为竖向（如 405×720），画面构图自动重排——因为 3D 渲染
> 读的纵横比来自取景框本身，**不需要任何额外适配逻辑**。

### 浏览器内「导出 WebM」按钮

右侧 dock 的操作分组含 **⏺ 导出 WebM**，点击后在浏览器内录制成 `.webm` 并自动下载：

- **信息层合成（v2.7.1 修复）**：`canvas.captureStream()` 只能捕获 WebGL 画布本身，
  取景框内的信息层（标题/徽标/来源）是 DOM，**不在被录制的画布里**
  （v2.7.0 的导出因此缺信息层）。现改为每帧把「WebGL 画布 + Canvas 2D 绘制的信息层」
  合成到离屏画布再取流 —— 导出视频从此**带完整信息层**，且数据与页面 DOM 版同源
  （`src/core/overlay.js` 的 `buildOverlayModel/paintOverlay`）。
- **操作分组（v2.8.3）**：自左至右为 **⏸暂停/▶继续 → ↻重播 → ⏺导出**。
  暂停为纯预览交互（出片模式下按钮不可见、空格快捷键被拦截），
  且 `beginRecord()` 会先解除用户暂停，保证导出后画面正常续播。
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
  "source": "会宁县人民政府官网",       // 数据来源（与 subtitle 分开，信息面板可独立编辑）
  "notes": ["人口以2018年末户籍人口为主"], // 备注（字符串数组，逐条展示）
  "theme": "tech",                     // 主题名（见主题对象），或内联主题对象
  "defaultShape": "bar",               // 全局默认形状，视图未指定时回退到它
  "highlightLabel": "重点",            // 高亮项图例文案（可空）
  "aspect": "16:9",                    // 画幅比例：16:9 / 9:16 / 1:1 / 4:3
  "barIntervalMs": 2000,               // 每根柱子弹出间隔（ms）；总时长由它推导
  "revealRatio": 0.72,                 // 0..1，逐条出现所占时间轴比例
  "durationMs": 7200,                  // 动画总时长（毫秒）——显式给出时优先于间隔推导
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
- **画幅比例 `aspect`**：`16:9`（默认）/ `9:16` / `1:1` / `4:3`。也接受像素写法（`1920x1080`、`2160×3840`）自动映射到最接近的标准比例。★ 该字段是**预览与导出的单一事实源**：浏览器里的取景框 `.viewport` 按它取"最大内接矩形"，3D 画布只铺满取景框，因此 3D 渲染读到的纵横比恒等于所选比例；出片 CLI 用同一比例推导导出像素（长边固定 1920）→ **预览所见 = 导出所得**。

  | aspect | 导出像素（长边 1920） | 典型用途 |
  |---|---|---|
  | `16:9` | 1920×1080 | 横屏视频 / B 站 / YouTube |
  | `9:16` | 1080×1920 | 竖屏短视频 / 抖音 / 视频号 |
  | `1:1` | 1920×1920 | 方形封面 / 朋友圈 |
  | `4:3` | 1920×1440 | 传统 / 幻灯片 |

- **播放节奏 `barIntervalMs`（默认 2000 = 2s）**：**每根柱子弹出间隔**。总时长按
  `durationMs = 柱体数量 × barIntervalMs / revealRatio` **自动推导**（取下限 `200`、上限 `20000`）。
  柱体数量取"所有视图中最大项数"，保证任何一屏都播得完。**显式给出的 `durationMs` 优先级更高**
  （老配置行为完全不变）。UI 上改动任一者会反向换算另一者，dock 里以"自动 / 手动"标注当前状态。
- 内置 `DEFAULT_CONFIG` 由 v2 模板 `src/data/huining-v2.js` 自动适配而来（会宁县 3 个默认视图 population/area/redSiteCount，会师镇高亮）；另有旧格式样本 `samples/huining.json`（4 视图 area/pop/elev/red）。
- `normalizeConfig(raw)`：补齐默认值、过滤非法项（`value` 非数/负、`name` 空）、保证每个 `view` 至少 1 条 `items`；**不抛异常**，返回 `{ config, warns }`。
- `encodeConfig(obj)` / `decodeConfig(str)`：base64url（UTF-8 安全，`+/`→`-_`、去 `=`），浏览器与 Node 通用，用于把配置塞进 URL 的 `cfg=` 参数。
- `src/core/video.js`（纯逻辑）：导出 `ASPECTS` / `ASPECT_KEYS` / `normalizeAspect` / `ratioOf` / `pixelSizeFor` / `deriveDuration` / `intervalFromDuration`，并被 `config.js` 重新导出——消费方只 import `config.js` 一处即可。

### 数据模板（v2 schema）— 一份模板涵盖全部维度

上面是**内部格式**（以 `views` 为根）。真实数据资产通常另有一份**含全部维度的规范模板**：
以 `metrics[]` 描述"可比维度"（每个指标 = 一个视图），以 `entities[]` 描述"对象维度"
（每个实体带一份指标值字典）。此类模板可**直接作为配置使用**——工具会自动识别并适配，
无需手工转写成内部格式（`src/core/adapt.js`）。

```jsonc
{
  "schemaVersion": "1.0",
  "dataset": {
    "id": "huining",
    "name": "会宁县乡镇基础数据对比",     // → 标题
    "source": "会宁县统计年鉴",           // ┐
    "notes": ["乡镇行政区划口径", "面积含辖域"], // ┘ → 副标题（source + notes 以 " · " 连接）
    "highlightEntityId": "huishi"        // 可选：把该实体标为高亮主角（也可按显示名匹配）
  },
  "entity": { "idField": "id", "nameField": "name", "groupField": "group" },
  "metrics": [                            // 每个 metric → 一个视图
    { "key": "population", "label": "常住人口", "unit": "人", "decimals": 0, "missingPolicy": "skip" },
    { "key": "area",       "label": "行政区域面积", "unit": "km²", "decimals": 1, "missingPolicy": "skip" },
    { "key": "elevation",  "label": "平均海拔", "unit": "m", "enabled": false, "missingPolicy": "disable" },
    { "key": "redSiteCount", "label": "红色遗址数", "unit": "个", "missingPolicy": "zero" }
  ],
  "entities": [                           // 每个 entity → 一个条目（name + 各指标值）
    { "id": "huishi", "name": "会师镇", "group": "镇", "metrics": { "population": 114130, "area": 88.2, "redSiteCount": 6 } },
    { "id": "guochengyi", "name": "郭城驿镇", "group": "镇", "metrics": { "population": 28040, "area": 288.3, "redSiteCount": 1 } }
  ]
}
```

**字段映射**

| 模板字段 | 内部字段 | 说明 |
|---|---|---|
| `dataset.name` | `title` | 数据集名称 |
| `dataset.source` + `dataset.notes[]` | `subtitle` | 以 ` · ` 连接（空项忽略） |
| `dataset.highlightEntityId` | item `highlight` | 命中实体 `highlight:true`；可用 id 或显示名 |
| `entity.idField` / `nameField` | item `_id` / `name` | 字段名可自定义，缺省 `id` / `name` |
| `metrics[].key` / `label` / `short` / `unit` | view `key` / `label` / `short` / `unit` | 一一对应 |
| `metrics[].decimals` | view `fixed` | 夹紧至 `[0,6]`，非法回退 `0` |
| `metrics[].shape` | view `shape` | 可选，覆盖顶层 `defaultShape` |
| `entities[].metrics[key]` | item `value` | 缺失按 `missingPolicy` 处理 |
| 顶层 `theme` / `defaultShape` / `revealRatio` / `durationMs` | 同名 | 透传 |
| 顶层 `schemaVersion` | — | 仅用于判别，不参与渲染 |

**`metrics[].enabled` 与 `metrics[].missingPolicy`**

| 字段 | 取值 | 语义 |
|---|---|---|
| `enabled` | `true`（默认）/ `false` | `false` = 该指标数据不可用 → **默认整视图跳过**；用 `--include-disabled`（CLI）或 `includeDisabled`（API）强制纳入 |
| `missingPolicy` | `skip`（默认） | 实体缺该指标值 → **不产出该条目**（视图条数变少） |
| | `zero` | 实体缺该指标值 → **补 0** 并保留条目 |
| | `disable` | 只要有实体缺该指标值 → **整视图跳过**（全员有值则正常保留） |
| `defaultVisible` | `false` | 仍生成视图，但**排序到视图列表末尾**（视觉上次要指标靠后） |

**判别规则（双格式自动兼容）**：出现顶层 `views[]` → 一律按**内部格式**处理；否则命中
`metrics[]` / `entities[]` / `schemaVersion` 任一 → 判为 **v2 模板**并自动适配。二者互不干扰，
旧数据文件与 `?cfg=` 契约完全不受影响。适配后的结果会**再次经过 `normalizeConfig`**
（校验 / 截断 / 去重 / 至少一条），因此两套格式共享同一套兜底逻辑。

> 内置默认数据集已切换为 v2 模板：`src/data/huining-v2.js`（会宁县 28 乡镇、5 个指标维度，
> 其中 `elevation`/`elevationRange` 标记 `enabled:false` 默认不生成视图 → 默认出 3 个视图：
> 人口 / 面积 / 红色遗址数，会师镇高亮）。旧格式示例 `samples/huining.json` 保留作兼容样本，
> 另有 `samples/huining-v2.json` 作为 v2 模板的独立可复用样例。

### 模板往返（v2.10.0）—— 一份模板驱动全部动态数据

上面讲的是「v2 模板 → 工具」的**单向**读取。v2.10.0 补齐了回来那一半，形成闭环：

```
v2 模板 ──adaptV2 / normalizeConfig──▶ 内部 config ──toV2Template──▶ v2 模板
                                            ▲                        │
                                            └────── 再导入（整体替换）──┘
```

**操作**（右侧「数据」分组）

| 按钮 | 行为 |
|---|---|
| **⤓配置** | 把**当前全量配置**导出为 v2 JSON 模板并下载（文件名取自标题，如 `会宁县乡镇基础数据对比.v2.json`） |
| **⬆导入** | 选 CSV **或** JSON。按**内容嗅探**分派：首字符是 `{`/`[` ⇒ 走 JSON 全量替换；否则走 CSV（只替换当前视图的数据行） |
| **拖拽** | 把文件直接拖到「数据」分组上即完成导入（容器会亮起青色虚线框作为"可放下"反馈）。**只挂在数据分组上，不劫持 3D 视图区**，拖拽旋转/缩放不受影响 |
| **↩撤销** | 撤销**最近一次模板导入**，整体还原（含视图/主题/形状/画幅等 config 之外的 UI 状态） |

**导出物结构**：在原有 `schemaVersion / dataset / entity / metrics / entities` 之上新增 `render` 段，
把"与数据无关的展示与规格配置"集中一处：

```jsonc
{
  "schemaVersion": "1.0",
  "dataset": { "name": "…", "source": "…", "notes": ["…"], "highlightEntityId": "huishi" },
  "entity":  { "idField": "id", "nameField": "name" },
  "metrics": [ { "key": "population", "label": "人口", "unit": "人" } ],
  "entities": [ { "id": "huishi", "name": "会师镇", "metrics": { "population": 114130 } } ],
  "render": {
    "theme": "tech", "highlightLabel": "重点", "revealRatio": 0.72,
    "barIntervalMs": 2000, "aspect": "16:9", "defaultShape": "bar"
    // durationMs / durationExplicit 仅在**用户显式锁定总时长**时才出现
  }
}
```

> **向后兼容**：`render` 段的读取是**字段级双读**（`render.X ?? raw.X`），render 优先、顶层回退。
> 因此早先把 `theme` / `revealRatio` / `aspect` 写在顶层的模板**不改也能继续用**；导出统一走 `render`。

**「不支持字段」清单** — 以下 v2 字段内部格式并不持有，因此**往返后会丢失**（这是已知且被接受的行为，不会报错）：

| 字段 | 为何无法回写 |
|---|---|
| `entity.groupField` / `entity.groupValues` | 当前 3D 赛跑无分组语义，内部不存 |
| `metrics[].valueType` / `scale` / `sortDefault` / `caliber` / `year` / `group` / `description` | 纯元信息，不参与渲染 |
| `dataset.id` / `dataset.entityLabel` / `dataset.updatedAt` | 内部格式未持有 |
| `entities[].extra`（如 `redSites` 明细） | 内部格式未持有 |

**无损性边界**（`scripts/qa/verify-template.mjs` + `config.test.mjs` A/B/C 组守护）

| 来源 | 往返表现 |
|---|---|
| **v2 模板**（items 带原生 `_id`） | **逐字节无损**（实测 28 实体 / 3 视图，`JSON.stringify` 完全相等） |
| **旧格式**（items 无 `_id`） | 会新增 `items[]._id`（由 `slugify(name)` 生成）—— 这是**格式升格**的必然：v2 的 `entities[]` 必须有 id，导出时必须造一个。渲染/数值/顺序全不变，且**第二次起完全幂等** |
| **无有效视图的模板** | 导入**被拒绝**并提示，**保留当前数据**（不会一次误操作清空工作区） |

**撤销语义**：单层快照 + **编辑后失效**。任何编辑动作（改标题/来源/备注、改间隔/时长/画幅、切视图/主题/形状、改高亮、应用数据表、导入 CSV）都会清掉撤销点，按钮随即置灰。
这样"撤销"的语义永远只有一种——**撤销这一次导入**，绝不会连带抹掉导入后的手工修改。

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

控件为**分组胶囊 dock**（v2.7 起停靠屏幕右侧、竖排放置）：`视图 / 形状 / 比例 / 间隔 / 主题 / 数据 / 操作`
七组（v2.7.1 起原右上数据工具条并入为「数据」组）；形状按钮带内联 SVG 几何图标，
选中态为青蓝渐变实心胶囊 + 外发光。
根节点保留 `.ui` 类作为 DOM 契约（既有脚本/自定义样式可继续选择）。

### 如何新增数据集

1. **推荐用 v2 模板**：复制 `samples/huining-v2.json`，改 `dataset`（标题/来源/主角）、
   `metrics[]`（维度即视图）、`entities[]`（对象即条目）即可，无需关心内部 `views` 结构。
2. **或沿用内部格式**：复制 `samples/huining.json`，改 `title`/`subtitle`/`views`
   （视图即指标，`items` 即条目），可按需加 `shape`/`defaultShape`。
3. 数据务必标注性质：真实数据请注明来源；示例/合成数据请写明「示例数据 · 用于演示工具通用性」，避免编造易被证伪的事实。
4. 浏览器里可直接用 URL 预览，无需构建：
   ```
   /?t=0.5&view=area&theme=tech&shape=cylinder&highlight=huishi&cfg=<base64url(configJSON)>
   ```
   （`cfg` 由 `encodeConfig` 生成；`shape=` 可在运行时覆盖形状，便于快速比稿。）

---

## 四、CLI 用法（`scripts/render.mjs`）

```
node scripts/render.mjs --config samples/huining.json [--view area] [--theme tech] \
  [--shape cylinder] [--aspect 16:9] [--interval 2000] \
  [--frames 180] [--fps 30] [--engine single] [--frame-format jpg] \
  [--out out/huining_area.mp4] [--poster out/huining_area.png] [--all-views]
```

| 参数 | 默认 | 说明 |
|---|---|---|
| `--config` | `src/data/huining-v2.js` 内置模板 | 配置路径：**内部格式** `.json` 或 **v2 模板** `.json` 均可（自动识别） |
| `--view` | 全部视图 | 仅渲染指定 `view` 键；省略则渲染全部（`--all-views` 等价） |
| `--theme` | 配置内 `theme` | 覆盖主题名 |
| `--shape` | 配置内 `shape` | 覆盖形状（`bar`/`cube`/`cylinder`/`rounded`/`sphere`） |
| `--aspect` | 配置内 `aspect`（默认 `16:9`） | **画幅比例**：`16:9` / `9:16` / `1:1` / `4:3`；决定导出像素（长边固定 1920） |
| `--interval` | 配置内 `barIntervalMs`（默认 `2000`） | **每根柱子弹出间隔**（ms，`200`–`20000`）；会**重算总时长**（`n × interval / revealRatio`） |
| `--include-disabled` | 关 | v2 模板中 `enabled:false` / `missingPolicy:disable` 的指标默认被跳过，加此参数强制纳入 |
| `--frames` | `180` | 截帧数（≥2） |
| `--fps` | `30` | 输出帧率 |
| `--engine` | `single` | **出片引擎**（v2.8.0）：`single`=单进程多帧（一次 `launch`，循环截帧，**快约 7×**）/ `perframe`=逐帧新进程（旧路径，隔离性最好）。`single` 失败时自动回退 `perframe` |
| `--frame-format` | `jpg` | 中间帧格式（v2.8.0）：`jpg`（q95，编码快 2–4×，默认）/ `png`（像素级无损，慢）。最终 mp4 不受影响 |
| `--out` | `out/<configName>_<view>.<编码器扩展名>` | 输出视频路径（多视图时自动插入 `_<view>`） |
| `--poster` | `out/<configName>_<view>.png` | 海报图（首帧）路径 |
| `--all-views` | — | 渲染该 config 的全部视图 |

页面 URL 契约：`/?t=<0..1>&view=<viewKey>&theme=<themeName>&shape=<shape>&aspect=<比例>&interval=<ms>&highlight=<id|名称>&cfg=<base64url(configJSON)>`（capture 模式隐藏 UI）。
其中 `highlight=` 用于运行时指定高亮主角（可写实体 id 如 `huishi` 或显示名如 `会师镇`，传空即清除）；
`aspect=` / `interval=` 由出片脚本自动带上，使浏览器取景框与导出像素严格一致。

示例：
```bash
# 会宁县默认数据集（v2 模板）的全部视图各出一片
npm run render

# 用 v2 模板出片，并强制纳入被禁用的指标维度
node scripts/render.mjs --config samples/huining-v2.json --all-views --include-disabled

# 竖屏短视频：9:16 → 导出 1080×1920（同一份配置，仅换画幅）
node scripts/render.mjs --config samples/huining-v2.json --view redSiteCount --shape sphere --aspect 9:16

# 放慢节奏：每根柱子 3s（总时长按 28 项 × 3000 / 0.72 ≈ 116.7s 自动推导）
node scripts/render.mjs --config samples/huining-v2.json --view population --interval 3000

# 仅渲染部门示例的 Q4，自定义帧率与输出
node scripts/render.mjs --config samples/departments.json --view q4 --fps 24 --out out/dept_q4.mp4

# 行星直径 + 质量两个视图（方形画幅）
node scripts/render.mjs --config samples/planets.json --all-views --aspect 1:1 --frames 240
```

> 旧入口 `scripts/capture.mjs` 保留为薄封装：`node scripts/capture.mjs [frames]` ≡ `render.mjs --config samples/huining.json --all-views [--frames N]`。

---

## 四·五、质量保障（QA）

内置十二套验证脚本（均可直接运行，无需手动先起 dev server）：

```bash
# —— npm 快捷入口（推荐）——
npm test                # 纯逻辑单元测试（无需浏览器）
npm run qa              # verify.mjs + interact.mjs（需 chromium + Xvfb）
npm run qa:aspect       # 画幅比例 ↔ 导出像素 一致性（需 chromium + Xvfb）
npm run qa:playback     # 真实播放模式全程采样（自动构建 + 自启静态服务）
npm run qa:overlay      # 录制合成信息层像素验证：标题/徽标/来源在 3 画幅全部入合成帧（v2.7.1 新增，v2.8.3 增补"原目标卡区已清空"断言）
npm run qa:geometry     # 信息层 DOM ↔ Canvas 几何收敛：四画幅锚点逐项对齐（v2.8.0 新增，v2.8.3 增补 .target-panel 已移除断言）
npm run qa:perf         # 出片性能回归：单帧耗时上限 / 无空白帧 / 无上下文丢失累积（v2.8.0 新增）
npm run qa:fixes3       # 三缺陷回归：画幅驱动画布 / 圆柱直壁平顶剖面 / 尾部相机 C¹ 平滑（v2.8.1 新增）
npm run qa:fixes4       # 三缺陷回归：暂停续播 / 开场首柱可见 / 同屏≥2根柱体（v2.8.3 新增）
npm run qa:fixes5       # 连续注视点 + 画幅自适应取景回归（v2.9.0 新增）
npm run qa:template     # 单模板往返：导入/导出/撤销/拖拽/通道分派（v2.10.0 新增）
npm run qa:all          # 一键跑全部 QA

# —— 直接调用 ——
node scripts/qa/config.test.mjs     # 纯逻辑单元测试：配置规范化 / 数据健壮性 / v2 模板适配 / **模板往返无损（A/B/C 组）** / 画幅与间隔推导 / 信息层模型口径 / overlayMetrics 契约（无需浏览器）
node scripts/qa/verify.mjs          # 构图硬指标（全景+跟随期）/ 形状渲染 / v2 模板直出 / 逐条出现 / 镜头跟随 / 确定性 / 标签覆盖与换行 / WebGL 上下文丢失
node scripts/qa/verify-aspect.mjs   # 画幅与间隔：四种比例取景框比例 == 所选比例 / 全景相机未被 maxDistance 钳制 / 各比例出片非空白 / interval 推导时长 / 导出像素 / 边界回退
node scripts/qa/interact.mjs        # 交互回归：视图·主题·比例·间隔切换 / 信息面板 / 重播 / 数据表 / CSV / portrait 口径 / 控制台异常
node scripts/qa/mk-preview-v2.mjs   # 工具：用 v2 模板数据集生成预览图（需已构建 dist/）
node scripts/qa/verify-playback.mjs # 真实播放模式全程采样：断言无空白帧（自动构建 dist + 自启静态服务）
node scripts/qa/verify-overlay.mjs  # 录制合成信息层：WebGL 画布 + 信息层合成后各分区确有绘制（v2.7.1 新增）
node scripts/qa/verify-geometry.mjs # DOM 信息层 vs Canvas 度量：四画幅锚点对齐 + --ov-* == overlayMetrics()（v2.8.0 新增）
node scripts/qa/perf.mjs            # 出片性能回归；加 --compare 可对单进程 / 逐帧方案做 A/B 并打印加速比（v2.8.0 新增）
node scripts/qa/verify-fixes3.mjs   # 三缺陷回归：①画幅比例驱动 3D 画布 ②cylinder 剖面=直壁平顶（surface 实现）③尾部相机单调无抖（v2.8.1 新增）
node scripts/qa/verify-fixes4.mjs   # 三缺陷回归：①暂停/继续按钮与进度冻结 ②开场首柱可见（含 t=0 首帧种子）③同屏 ≥2 根柱体（v2.8.3 新增）
node scripts/qa/verify-fixes5.mjs   # 连续注视点连续性 + 各画幅同屏柱数下限（v2.9.0 新增）
node scripts/qa/verify-template.mjs # 模板往返端到端：①JSON 导入全量替换 ②撤销逐字段复原（含 config 外的 UI 状态）③导出产物合法且闭环无损 ④CSV/JSON 通道分派 ⑤拖拽导入且不劫持 3D 视图（v2.10.0 新增，44 项断言）
```

> 截图/中间产物默认写入系统临时目录（`os.tmpdir()`），可用环境变量 `QA_ART=/your/dir` 覆盖。
> 浏览器可通过 `CHROMIUM_PATH` / `CHROME_PATH` 指定；无显示器环境脚本会自动拉起 Xvfb。

`verify.mjs` 会输出每项指标实测值（例：全景柱体外接框 **宽 98.3% / 高 47%–49%**，远超 ≥62%/≥45% 的硬指标；
跟随期柱底 85.7% 完整入画、同框内容 84.8%；逐条出现亮像素质心 1.8k→700k 单调增长；镜头跟随内容质心
活动范围 ~177px；同 `t` 两次渲染差异 0.000%）。

**最近一次实测（1920×1080）**

| 项目 | 结果 |
|---|---|
| 构图（4 视图全景） | 宽 98.3% / 高 42%–50%（柱体族硬指标 ≥62%/≥45%；球体视图高占比放宽至 ≥18%）✅ |
| 形状渲染（v2.4.0 新增） | bar/cube/cylinder/rounded 亮像素均 >55 万、sphere 10.6 万，连续切换 5 种形状零异常 ✅ |
| 跟随期构图（v2.3.0 新增） | 柱底 83.7%（≤98% 硬指标）/ 同框内容 84.1% ✅ |
| 由低到高逐条出现 | 亮像素 1,841 → 573,255，单调增 ✅ |
| 镜头跟随 | 内容质心活动范围 Δcx = 202px ✅ |
| 结尾全景 | 跟随末帧 84.1% 宽 → 全景 78.8%，全柱入画 ✅ |
| 确定性（同 t 两次） | 像素差异 0.002% ✅ |
| 标签覆盖（v2.3.1 新增） | 海拔 7/7、面积 14/14 全贴；人口/红色（n=28）全景 15 个、跟随期 14 个（修复前仅 4 个）✅ |
| 中文标签（label_overflow） | 整串测宽/单字宽 = 6.00（无逐字竖排）✅ |
| WebGL 上下文丢失 | 事件捕获 + 暂停循环 + 无未捕获异常 ✅ |
| v2 模板直出（v2.5.0 新增） | 真实 v2 模板经 `?cfg=` 直出：视图数=启用指标数(3)、标题/副标题正确映射、主角高亮、旧格式契约不受影响 ✅ |
| 画幅比例（v2.6.0 新增） | 四种比例下取景框实测比例与所选**完全一致**（16:9→1.7778、9:16→0.5625、1:1→1.0000、4:3→1.3333，偏差 0.00%）；各比例出片非空白 ✅ |
| 全景相机未被钳制（v2.6.0 新增） | 28 项长列表（请求距离 ≈770）下四画幅实测距离与请求值一致（偏差 0.1%~0.3%）；若回退旧的 `maxDistance: boxW*4`（≈457）必失败——该钳制是竖屏柱阵出画的原根因 ✅ |
| 导出像素（v2.6.0 新增） | 长边恒 1920 且为偶数：`16:9→1920×1080`、`9:16→1080×1920`、`1:1→1920×1920`、`4:3→1920×1440`；`ffprobe` 实测竖屏出片确为 1080×1920 ✅ |
| 播放间隔（v2.6.0 新增） | `?interval=3000` → 时长按 `4×3000/0.72=16667ms` 推导；间隔↑则时长严格单调↑；2s 为默认值 ✅ |
| 信息编辑（v2.6.0 新增） | 标题改动即时同步到舞台 `header`（QA 实测「QA 标题校验」）；`source`/`notes` 与 `subtitle` 并存 ✅ |
| **信息入画（v2.7.0 新增）** | 标题 / 徽标 / 来源在**四种画幅 × 编辑/出片**下全部落在取景框内、互不重叠；出片模式照常渲染并进入导出帧 ✅（v2.8.3 起不再含目标卡） |
| **右栏避让（v2.7.0 新增）** | 5 档窗口（1920×1080 → 1024×768）下右栏与取景框重叠恒为 0px²，取景框按可用区居中（`--vp-dx`）✅ |
| **录制合成信息层（v2.7.1 新增）** | `qa:overlay`：3 画幅 × 跟随期/全景下，合成帧相对纯 WebGL 画布在标题区/徽标区/来源区均有新增亮像素；**v2.8.3 增补**：原目标卡区着墨 **0 px**、overlay 模型已无 `target` 字段 ✅ |
| **出片提速（v2.8.0 新增）** | 1920×1080 / 30 帧同机 A/B：逐帧新进程 **95.4 s（3.18 s/帧）** → 单进程多帧 **13.6 s（0.21 s/帧）** = **7.0×（↓85.7%）**；`ffprobe` 复核 `1920×1080, 30 fps, 31 帧` ✅ |
| **GL 回读路径（v2.8.0 实测）** | `--use-gl=swiftshader` vs `--use-angle=swiftshader`：CDP 截屏 946 ms → 193 ms（**4.04×**，三轮交叉验证稳定）。这是提速的主要来源，而非进程启动 ✅ |
| **信息层几何收敛（v2.8.0 新增）** | `qa:geometry`：16:9 / 9:16 / 1:1 / 4:3 下 DOM 锚点（标题左上、徽标右上、来源落位）与 `overlayMetrics()` **逐项对齐（容差 2 px）**，`--ov-*` CSS 变量 == JS 度量；**v2.8.3 增补** `.target-panel === null` 断言 ✅ |
| **暂停 / 继续（v2.8.3 新增）** | `qa:fixes4` ① 组 18 项：按钮位于「重播」之前、点击切换文案/图标/aria-pressed、**暂停期间进度冻结**（0.047355 → 0.047355 差 0）、续播恢复推进、空格键等价、暂停态点重播可恢复、出片模式不可见 ✅ |
| **开场首柱可见（v2.8.3 新增）** | `qa:fixes4` ② 组：**t=0 首帧柱体像素 0 → 1378**（种子高度）；t=0.005/0.03/0.05 逐档断言"有柱体 / 不贴边（两侧 ≥8%）/ 有柱在生长 / 已达物理同屏上限" ✅ |
| **同屏 ≥2 根柱体（v2.8.3 新增）** | `qa:fixes4` ③④ 组：t=0.05 柱阵横向跨度 **13%~41%（1 簇）→ 21%~69%（3 簇）**、柱阵中心 **≈27% → 45%（画面中央带）**；圆柱模式同样满足 ✅ |
| 配置单元测试 | **124/124** 通过 ✅（v2.8.3 增补 `!('target' in model)` 字段级断言） |
| QA 汇总（verify） | **45/45** 通过 ✅ |
| 画幅 QA | **32/32** 通过 ✅（含相机钳制守卫） |
| 交互回归 | **10/10** 通过 ✅ |
| 播放回归 | 50 采样 **0 空白帧** ✅（v2.8.3 复测） |
| 性能回归（v2.8.0 新增） | `qa:perf` **4/4**：全帧非空白 / 生成 mp4 / 单帧 ≤2.5 s / 无上下文丢失累积 ✅ |
| 三缺陷回归 v2.8.1 | `qa:fixes3` **18/18** ✅ |
| 三缺陷回归 v2.8.3 | `qa:fixes4` **48/48** ✅ |
| CLI 出片（v2.8.3 复测） | `--view population --frames 40` → 1920×1080 mp4 正常；**抽帧确认第 0 帧首柱种子可见、第 4 帧"3 根满高 + 1 根正在生长"四柱同框** ✅ |

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
│   ├── huining.json       # 会宁县多视图（旧格式：area/pop/elev/red）
│   ├── huining-v2.json    # 会宁县规范数据模板（v2 schema：dataset/metrics/entities）
│   ├── departments.json   # 某科技公司部门季度产出（合成示例）
│   └── planets.json       # 太阳系行星基础参数（近似值示例）
├── scripts/
│   ├── render.mjs         # 出片 CLI（配置驱动；--aspect/--interval/--engine/--frame-format）
│   ├── capture.mjs        # 旧入口薄封装 → render.mjs --all-views
│   ├── lib/capture-core.mjs  # 出片管线核心（Xvfb/编码器/单进程多帧+CDP截帧/逐帧回退）
│   └── qa/                # 质量保障：config.test.mjs + verify.mjs + verify-aspect.mjs + interact.mjs
│                          #          + verify-playback.mjs + verify-overlay.mjs + verify-geometry.mjs + perf.mjs
├── src/
│   ├── core/config.js     # 配置规范化 + base64url 编解码 + DEFAULT/SAMPLE
│   ├── core/adapt.js      # v2 数据模板 → 内部格式适配层（纯逻辑）
│   ├── core/video.js      # 画幅比例表 / 导出像素推导 / 播放时长推导（纯逻辑）
│   ├── core/overlay.js    # 画面内信息层：数据模型 + Canvas 绘制（纯逻辑；v2.7.1 录制合成共用）
│   ├── data/huining-v2.js # 内置 v2 模板数据集（会宁县 28 乡镇 · 5 指标）
│   ├── theme.js           # 主题对象
│   ├── App.vue            # 主布局 / 取景框(.viewport) / 截帧模式识别
│   ├── components/BarRace3D.vue  # 3D 柱体 + 动画/截帧核心
│   ├── components/MetricBar.vue  # 右侧控件 dock（视图/形状/比例/间隔/主题/数据/操作；窄屏退回底部）
│   ├── components/InfoPanel.vue  # 信息编辑面板（标题/来源/备注）
│   └── ...                # 数据表/CSV 等
└── README.md
```

---

## 六、踩坑记录（出片管线铁律）

1. **不必每帧新开进程（v2.8.0 修正）**：早期结论是「持久复用浏览器连开数十页会让 swiftshader 的 WebGL 上下文耗尽」——**方向对但代价过大**：每帧 `puppeteer.launch()` 让 30 帧多花约 82 s（实测 95.4 s → 13.6 s）。
   正确做法是**单进程多帧 + 主动管理上下文**：一次 `launch`，每 60 帧 `endRecord→resize→beginRecord` 分段重建；同时监听 `getContextLossCount()`，一旦发现丢失立即重建。既不耗尽上下文，也不必反复付进程冷暖启的代价。`--engine perframe` 保留为隔离兜底，并在单进程失败时自动回退。
2. **GL 回读路径比进程启动贵一个数量级（v2.8.0 实测）**：`--use-angle=swiftshader` 下 CDP 截屏 946 ms，换成 `--use-gl=swiftshader` 只要 193 ms（**4.04×**，三轮交叉验证）。瓶颈在 ANGLE 的截图回读，不在进程启动（后者仅 0.85 s/帧）。**先量再优化**——本轮最初误以为瓶颈是进程冷启。
3. **不要用 chromium CLI 的 `--screenshot` / `--virtual-time-budget`**：该模式下 GPU 进程不启动、WebGL 不可用，截出 *"Sorry, your browser doesn't support WebGL."* 空白页；且空白 PNG 体积也会超过阈值被误判有效帧。→ 改用 puppeteer 并等待 `document.body.dataset.ready === '1'` 再截。
4. **页面务必用 `127.0.0.1` 访问**：chromium 会把 `localhost` 优先解析成 IPv6 `::1`，而服务若只监听 IPv4 就连不上，同样截出空白页。→ 静态服务显式监听 `0.0.0.0`，页面用 `127.0.0.1`。
5. **无显示器环境自动拉起 Xvfb**：否则 ANGLE/WebGL 退化为极慢软件路径甚至超时；且不能只看 `DISPLAY` 是否存在（很多环境预设了实际不可用的 `:0`）。→ 用 `xdpyinfo` 实际探测，不可用再自建 Xvfb。
   ★ 若脚本内部已调 `setupDisplay()`（自建 Xvfb），**不要再套一层 `xvfb-run`** —— 嵌套会造成启动挂起。
6. **`renderAt(t)` 后要等两个 rAF 再截帧**：echarts-gl 的实际绘制发生在下一个 `requestAnimationFrame`，立即截帧会拿到上一帧的画面。

> 额外工程教训（可视化层）：
> - echarts-gl 的 `bar3D` **不支持函数式 label 配置**（`offset`/`distance`/`formatter` 传函数会被静默忽略甚至导致标签消失）——标签样式必须传常量；本项目改为**逐数据项常量 `label`**（`formatter` 传字符串、逐项开关 `show`）。
> - **构图是第一优先级**：相机 `distance` 与 `boxWidth` 必须按柱体数量自适应（本项目按柱体外接框反推距离，使全景占宽 ≥62%）。曾因相机拉太远（distance≈138、boxWidth=52）导致柱子缩成小点、画面 90% 空白——这是最典型的"看上去很科技、其实没内容"翻车。
> - **极值悬殊数据**：线性高度会让小值柱体被压成"纸片"（如行星质量 木星 317.8 vs 水星 0.055）。`computeFrame` 对高度系数设下限 `hFrac = H_FLOOR + (1-H_FLOOR)*ratio`（`H_FLOOR=0.08`），保证每根柱体可见；颜色与标签仍用真实值。
> - **主题必须贯穿**：App 侧 HUD（网格/地平线/面板/进度条）的颜色要经 CSS 变量（`--cy`/`--cy-dim`）取自主题，避免"切换主题但 HUD 还是青色"的割裂。
