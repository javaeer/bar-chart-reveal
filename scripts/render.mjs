#!/usr/bin/env node
// 出片 CLI（SPEC 第 6 节）：配置驱动的 3D 柱状赛跑 → MP4
//
// 用法：
//   node scripts/render.mjs --config samples/huining.json [--view area] [--theme tech] \
//     [--shape cylinder] [--frames 180] [--fps 30] \
//     [--out out/huining_area.mp4] [--poster out/huining_area.png] [--all-views]
//
// 说明：
//   - 缺省 --config=samples/huining.json --frames=180 --fps=30
//   - 不指定 --view 时渲染该 config 的全部 views（等价于 --all-views）
//   - --shape 覆盖形状：bar/cube/cylinder/rounded/sphere（缺省用配置内 shape/defaultShape）
//   - 缺省输出 out/<configName>_<view>.<encExt>（encExt 由可用编码器决定：mp4/webm）
//   - 页面 URL 契约：/?t=<0..1>&view=<viewKey>&theme=<themeName>&shape=<shape>&cfg=<base64url(configJSON)>
//     cfg 由 src/core/config.js 的 encodeConfig 生成（UTF-8 安全）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeConfig, normalizeConfig } from '../src/core/config.js';
import { pickEncoder, resolveChromium, renderFrames } from './lib/capture-core.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const o = {
    config: 'samples/huining.json',
    view: null, theme: null, shape: null,
    frames: 180, fps: 30,
    // 原始字符串（用于非法值报错时回显用户实际输入，而非 parseInt 后的 NaN）
    framesArg: null, fpsArg: null,
    out: null, poster: null,
    allViews: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--all-views') o.allViews = true;
    else if (a === '--config') o.config = argv[++i];
    else if (a === '--view') o.view = argv[++i];
    else if (a === '--theme') o.theme = argv[++i];
    else if (a === '--shape') o.shape = argv[++i];
    else if (a === '--frames') { o.framesArg = argv[++i]; o.frames = parseInt(o.framesArg, 10); }
    else if (a === '--fps') { o.fpsArg = argv[++i]; o.fps = parseInt(o.fpsArg, 10); }
    else if (a === '--out') o.out = argv[++i];
    else if (a === '--poster') o.poster = argv[++i];
    else { console.error('未知参数: ' + a); process.exit(2); }
  }
  return o;
}

// 多 view 渲染时把 view key 插入输出文件名
function insertView(out, view) {
  const ext = path.extname(out);
  const base = ext ? out.slice(0, -ext.length) : out;
  return `${base}_${view}${ext || '.mp4'}`;
}

// —— 数值参数校验（任务四）——
// 返回错误信息数组（空数组表示通过）。规则：
//   · --frames：必须为正整数（≥2，出片至少需要 2 帧才能合成）
//   · --fps   ：必须为 1..60 的整数
// 说明：parseArgs 用 parseInt 解析，无法区分"未提供"与"非法"——未提供时取默认值，
// 非法字符串会得到 NaN，故此处对 NaN 单独给出"应为整数"的提示。
const FPS_MIN = 1, FPS_MAX = 60, FRAMES_MIN = 2;

export function validateNumericArgs(o) {
  const errors = [];

  if (!Number.isInteger(o.frames) || Number.isNaN(o.frames)) {
    errors.push(`--frames 应为整数，收到「${o.framesArg ?? o.frames}」`);
  } else if (o.frames < FRAMES_MIN) {
    errors.push(`--frames 应 ≥ ${FRAMES_MIN}（出片至少需要 ${FRAMES_MIN} 帧才能合成视频），收到 ${o.frames}`);
  }

  if (!Number.isInteger(o.fps) || Number.isNaN(o.fps)) {
    errors.push(`--fps 应为整数，收到「${o.fpsArg ?? o.fps}」`);
  } else if (o.fps < FPS_MIN || o.fps > FPS_MAX) {
    errors.push(`--fps 应在 ${FPS_MIN}–${FPS_MAX} 之间，收到 ${o.fps}`);
  }

  return errors;
}

function main() {
  const opts = parseArgs(process.argv);

  // —— 参数合法性校验（任务四）——
  // 尽早失败：非法 --frames / --fps 直接在启动出片前拦下，避免跑了几分钟才报错。
  const argErrors = validateNumericArgs(opts);
  if (argErrors.length) {
    console.error('❌ 参数不合法：');
    argErrors.forEach((e) => console.error('   - ' + e));
    console.error('\n用法示例：node scripts/render.mjs --frames 180 --fps 30');
    process.exit(2);
  }

  const cfgPath = path.resolve(root, opts.config);
  if (!fs.existsSync(cfgPath)) {
    console.error('❌ 找不到配置文件: ' + cfgPath);
    process.exit(2);
  }
  let raw;
  try { raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); }
  catch (e) { console.error('❌ 配置文件不是合法 JSON: ' + e.message); process.exit(2); }

  const { config, warns } = normalizeConfig(raw);
  if (warns.length) {
    console.warn('⚠ 配置规范化提示:');
    warns.forEach((w) => console.warn('   - ' + w));
  }
  if (!config.views.length) {
    console.error('❌ 配置无有效视图，出片中止');
    process.exit(1);
  }

  const configName = path.basename(opts.config).replace(/\.json$/i, '');
  const themeName = opts.theme || (typeof config.theme === 'string' ? config.theme : 'tech');
  // --shape 覆盖：仅接受合法形状，非法值直接报错（避免静默回退后出片与预期不符）
  const SHAPE_KEYS = ['bar', 'cube', 'cylinder', 'rounded', 'sphere'];
  let shapeName = null;
  if (opts.shape != null) {
    const s = String(opts.shape).trim().toLowerCase();
    if (!SHAPE_KEYS.includes(s)) {
      console.error(`❌ --shape 非法（${opts.shape}），可选：${SHAPE_KEYS.join(' / ')}`);
      process.exit(2);
    }
    shapeName = s;
  }
  const cfgB64 = encodeConfig(config);

  // 决定本次要渲染的 view 列表
  let views;
  if (opts.allViews || !opts.view) views = config.views.map((v) => v.key);
  else if (config.views.some((v) => v.key === opts.view)) views = [opts.view];
  else {
    console.error(`❌ 配置中无 view=${opts.view}（可用：${config.views.map((v) => v.key).join(', ')}）`);
    process.exit(2);
  }
  const multi = views.length > 1;

  const enc = pickEncoder();
  const chromiumPath = resolveChromium();

  const run = async () => {
    for (const view of views) {
      const label = (config.views.find((v) => v.key === view) || {}).label || view;
      const urlForFrame = (t) =>
        `/?t=${t.toFixed(4)}&view=${encodeURIComponent(view)}&theme=${encodeURIComponent(themeName)}`
        + (shapeName ? `&shape=${encodeURIComponent(shapeName)}` : '')
        + `&cfg=${cfgB64}`;
      const outRel = opts.out
        ? (multi ? insertView(opts.out, view) : opts.out)
        : path.join('out', `${configName}_${view}.${enc.ext}`);
      const posterRel = opts.poster
        ? (multi ? insertView(opts.poster, view) : opts.poster)
        : path.join('out', `${configName}_${view}.png`);
      // 相对路径统一以仓库根(root)为基准解析，确保从任意 cwd 运行都能落到预期位置
      const out = path.resolve(root, outRel);
      const poster = path.resolve(root, posterRel);

      console.log(`\n▶ 渲染 view=${view} (${label}) → ${out}`);
      try {
        const res = await renderFrames({
          root,
          dist: path.join(root, 'dist'),
          frames: opts.frames,
          fps: opts.fps,
          out,
          poster,
          urlForFrame,
          encoder: enc,
          chromiumPath,
        });
        console.log(`✅ 生成: ${res.out}${res.poster ? ' (poster: ' + res.poster + ')' : ''}`);
      } catch (e) {
        console.error(`❌ view=${view} 出片失败: ${e.message}`);
        process.exitCode = 1;
      }
    }
  };

  return run();
}

// 正确 await 出片管线：捕获未处理拒绝，避免进程提前退出 / 静默失败
main().catch((e) => {
  console.error('❌ 出片管线异常: ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
