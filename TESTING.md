# 开发环境测试指南（v2.3.2）

本包是修复后的源码快照（**不含** `node_modules` / `dist` / `.git`），用于在开发机上验证。

## 一、安装与启动

```bash
cd bar-chart-reveal
npm install            # 注意：已统一使用 npm（pnpm-lock.yaml 已移除）
npm run dev            # 开发预览 → http://localhost:5173
```

## 二、快速自检（按耗时从短到长）

```bash
# 1) 纯逻辑单元测试（零依赖，秒级）—— 期望 32/32 通过
npm test

# 2) 生产构建 + 单文件构建 —— 期望均成功
npm run build
npm run build:single   # 产出 dist-single/index.html（可离线双击打开）

# 3) 交互回归（需 chromium + Xvfb）—— 期望 7/7 通过
npm run qa        # = verify.mjs + interact.mjs

# 4) 播放无空白帧验证（自动构建 + 自启静态服务）—— 期望「无空白帧」
npm run qa:playback

# 5) 一键跑全部
npm run qa:all
```

## 三、本次修复验证点（重点回归）

| 验证点 | 命令 | 修复前 | 修复后期望 |
|---|---|---|---|
| `pngjs` 依赖缺失 | `npm run qa:playback` | `ERR_MODULE_NOT_FOUND` 崩溃 | 正常输出「无空白帧」 |
| `verify.mjs` 硬编码绝对路径 | `npm run qa` | 写错目录 / 失败 | 29/29 通过，产物落 `os.tmpdir()` |
| 脚本硬编码 `localhost:5173` | `npm run qa:playback` | 需先手动 `npm run dev` | 全自动，无需手动起服务 |
| `dist-single` 入库 | `du -sh` 仓库 | 含 1.7MB 构建产物 | 已移出（按需 `npm run build:single` 生成） |
| 双 lockfile | `ls *lock*` | npm + pnpm 共存 | 仅 `package-lock.json` |
| 无 CI | 仓库根 | 无 `.github/` | 含 `ci.yml`（unit + qa 两作业） |

## 四、依赖与环境

- **Node** ≥ 18（已写入 `engines`）。
- 出片 / QA 额外需要：系统 `chromium`（或 `CHROMIUM_PATH`）、`ffmpeg`（含 libx264 等）、
  无显示器环境需 `Xvfb`；中文标签需系统含中文字形（如 `fonts-noto-cjk`）。
- QA 中间产物目录可用 `QA_ART=/your/dir` 覆盖（默认系统临时目录）。

## 五、出片（可选）

```bash
npm run render                                        # 默认会宁县全部 4 视图
node scripts/render.mjs --config samples/planets.json --all-views --frames 240
```
