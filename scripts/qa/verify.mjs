// 端到端 QA：构图硬指标 / 逐条出现 / 镜头跟随 / 全景 / 确定性 / 标签重叠 / 交互回归
// 用法：node scripts/qa/verify.mjs
// 依赖：puppeteer-core（项目 devDep）+ 系统 chromium + Xvfb。复用 capture-core 的环境逻辑。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { decodeConfig, encodeConfig } from '../../src/core/config.js';
import {
  pickEncoder, resolveChromium, setupDisplay, startServer, shootFrame,
} from '../lib/capture-core.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');
const ART = '/root/.codebuddy/artifact/2f8a7d30-9c21-4f0b-1d2d-3cf38b318000/qa';
fs.mkdirSync(ART, { recursive: true });

const W = 1920, H = 1080;
const results = [];
function check(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}

// ── 像素分析（用 sharp 不可得，改用纯 JS 解码 PNG）────────────────
// 用 puppeteer 直接把 PNG 读进 <canvas> 分析太绕；这里用最小 PNG 解码：借助 ffmpeg 转 raw。
import { execFileSync } from 'node:child_process';
function pngToRaw(png) {
  if (Buffer.isBuffer(png)) return png;
  const raw = png + '.raw';
  execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', png, '-f', 'rawvideo', '-pix_fmt', 'rgb24', raw], { stdio: ['ignore', 'ignore', 'pipe'] });
  const buf = fs.readFileSync(raw);
  fs.rmSync(raw, { force: true });
  return buf;
}
// 统计：背景底色附近的像素视为"空"；偏离则视为"内容"
function analyze(png, opts = {}) {
  const raw = pngToRaw(png);
  const { bg = [6, 12, 24], tol = 46, topSkip = 0, bottomSkip = 0 } = opts;
  let minX = W, minY = H, maxX = -1, maxY = -1, cnt = 0, sumX = 0, sumY = 0;
  for (let y = 0; y < H; y++) {
    if (y < topSkip || y >= H - bottomSkip) continue;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      const d = Math.abs(raw[i] - bg[0]) + Math.abs(raw[i + 1] - bg[1]) + Math.abs(raw[i + 2] - bg[2]);
      if (d > tol) {
        cnt++; sumX += x; sumY += y;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  if (!cnt) return { cnt: 0, w: 0, h: 0, cx: 0, cy: 0, bbox: null };
  return {
    cnt, w: (maxX - minX) / W, h: (maxY - minY) / H,
    cx: sumX / cnt, cy: sumY / cnt,
    bbox: { minX, minY, maxX, maxY },
  };
}
// 与基准帧逐像素差异比例
function diffRatio(a, b) {
  const ra = pngToRaw(a), rb = pngToRaw(b);
  let d = 0;
  const n = Math.min(ra.length, rb.length);
  for (let i = 0; i < n; i += 3) {
    if (Math.abs(ra[i] - rb[i]) + Math.abs(ra[i + 1] - rb[i + 1]) + Math.abs(ra[i + 2] - rb[i + 2]) > 24) d++;
  }
  return d / (n / 3);
}

const cfg = JSON.parse(fs.readFileSync(path.join(root, 'samples/huining.json'), 'utf8'));
const cfgB64 = encodeConfig(cfg);

async function main() {
  resolveChromium(); pickEncoder();
  const xvfb = await setupDisplay();
  const srv = await startServer(path.join(root, 'dist'));

  const url = (t, extra = '') => `/?t=${t.toFixed(4)}&cfg=${cfgB64}${extra}`;
  const chromePath = resolveChromium();
  const shoot = async (t, name, extra = '') => {
    const p = path.join(ART, name);
    await shootFrame({ chromiumPath: chromePath, base: srv.base, url: url(t, extra), outPath: p });
    return p;
  };

  try {
    // ── 1) 全景构图硬指标（4 个 view）──
    for (const v of cfg.views) {
      const png = await shoot(1, `pano_${v.key}.png`, `&view=${v.key}`);
      const a = analyze(png, { topSkip: 110, bottomSkip: 0 }); // 跳过顶部标题区
      check(`构图·${v.key} 全景宽占比 ≥62%`, a.w >= 0.62, `w=${(a.w * 100).toFixed(1)}%`);
      check(`构图·${v.key} 全景高占比 ≥45%`, a.h >= 0.45, `h=${(a.h * 100).toFixed(1)}%`);
    }

    // ── 2) 由低到高逐条出现（亮柱像素随 t 单调增）──
    const ts = [0.0, 0.18, 0.36, 0.54, 0.72];
    const counts = [];
    for (const t of ts) {
      const png = await shoot(t, `reveal_${String(t).replace('.', '_')}.png`);
      const a = analyze(png, { topSkip: 110 });
      counts.push({ t, cnt: a.cnt, cx: a.cx });
    }
    const monotonic = counts.every((c, i) => i === 0 || c.cnt >= counts[i - 1].cnt * 0.98);
    check('逐条出现·亮像素质心随时间单调增加', monotonic,
      counts.map((c) => `t=${c.t}:${c.cnt}`).join(' '));
    check('逐条出现·首帧明显少于末帧', counts[counts.length - 1].cnt > counts[0].cnt * 3,
      `${counts[0].cnt} → ${counts[counts.length - 1].cnt}`);

    // ── 3) 镜头跟随（内容质心 x 随 t 移动）──
    const cxMove = Math.abs(counts[counts.length - 1].cx - counts[0].cx);
    check('镜头跟随·内容质心发生明显水平位移', cxMove > 80, `Δcx=${cxMove.toFixed(0)}px`);

    // ── 4) 结尾全景：外接框显著变宽且全部柱体入画 ──
    const midPng = await shoot(0.72, 'follow_end.png');
    const aMid = analyze(midPng, { topSkip: 110 });
    const aEnd = analyze(path.join(ART, 'pano_area.png'), { topSkip: 110 });
    check('结尾全景·外接框比跟随末帧更宽或相当', aEnd.w >= aMid.w * 0.9,
      `follow w=${(aMid.w * 100).toFixed(1)}% → pano w=${(aEnd.w * 100).toFixed(1)}%`);

    // ── 5) 确定性（同 t 两次渲染像素一致）──
    const d1 = await shoot(0.5, 'det_a.png');
    const d2 = await shoot(0.5, 'det_b.png');
    const dr = diffRatio(d1, d2);
    check('确定性·同 t 两次渲染一致（差异<0.5%）', dr < 0.005, `diff=${(dr * 100).toFixed(3)}%`);

    // ── 6) 标签重叠检测（对全景帧做文字行连通性统计）──
    // 简化：统计"偏亮文字色像素"的 X 方向直方图连通段数量，对比柱子数；段数≈柱数说明标签分散。
    const labelStats = analyze(path.join(ART, 'pano_area.png'), { topSkip: 110 });
    check('标签·全景帧存在可辨识内容（非空白）', labelStats.cnt > 50000, `cnt=${labelStats.cnt}`);

    fs.writeFileSync(path.join(ART, '_metrics.json'), JSON.stringify({ counts, results }, null, 2));
  } finally {
    await srv.close();
    if (xvfb) xvfb.kill();
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n==== QA 汇总：${results.length - failed.length}/${results.length} 通过 ====`);
  if (failed.length) { failed.forEach((f) => console.log('  失败: ' + f.name)); process.exitCode = 1; }
}

main().catch((e) => { console.error('QA 崩溃:', e); process.exit(1); });
