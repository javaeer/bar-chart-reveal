# CLI 参考：render.mjs（权威详细参考）

> 本文件从 README 抽取，作为出片 CLI 的完整参数说明。

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
