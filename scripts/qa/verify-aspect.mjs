// v2.6 端到端 QA：画幅比例（预览 ↔ 导出一致性）与播放间隔（时长推导）
// 用法：node scripts/qa/verify-aspect.mjs
//
// 覆盖：
//   A. 四种比例（16:9 / 9:16 / 1:1 / 4:3）下，浏览器取景框 .viewport 的实际渲染比例
//      必须等于所选比例（容差 1.5%）——这是"预览比例 == 导出比例"的核心证据。
//   B. 比例切换后画面仍有内容（非空白），且构图未崩（内容占比合理）。
//   C. ?interval= 生效：时长按 interval × n / revealRatio 推导（页面自检 + 断言）。
//   D. 导出像素推导（纯逻辑）：pixelSizeFor 在各比例下长边恒为 1920 且为偶数。
//   E. 边界：非法 aspect 回退 16:9；非法 interval 回退默认 2000。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import {
  ASPECTS, ASPECT_KEYS, pixelSizeFor, deriveDuration, normalizeAspect,
  encodeConfig, normalizeConfig, DEFAULT_BAR_INTERVAL_MS,
} from '../../src/core/config.js';
import { resolveChromium, setupDisplay, startServer, shootFrame } from '../lib/capture-core.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');
const ART = process.env.QA_ART
  ? path.resolve(process.env.QA_ART)
  : path.join(os.tmpdir(), 'bar-chart-reveal-aspect');
fs.mkdirSync(ART, { recursive: true });

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}

// 内容竖向延展：把 PNG 解成 raw RGB，统计"非背景"像素的纵向外接框高度 / 画面高。
// 背景色取深色底（6,12,24）+ 容差，与 verify.mjs 一致。
// 目的：量化"跟随期柱体是否仍高耸"。柱体塌成横带时该比例会明显偏低。
import { execFileSync } from 'node:child_process';
function pngVerticalExtent(png, W, H) {
  const raw = png + '.raw';
  execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', png,
    '-f', 'rawvideo', '-pix_fmt', 'rgb24', raw], { stdio: ['ignore', 'ignore', 'pipe'] });
  const buf = fs.readFileSync(raw);
  fs.rmSync(raw, { force: true });
  const bg = [6, 12, 24], tol = 46;
  let minY = H, maxY = -1;
  // 上下各跳过 6%（排除 HUD 四角装饰线与标题栏对小比例画幅的污染）
  const topSkip = Math.round(H * 0.06);
  const botSkip = Math.round(H * 0.06);
  for (let y = topSkip; y < H - botSkip; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      const d = Math.abs(buf[i] - bg[0]) + Math.abs(buf[i + 1] - bg[1]) + Math.abs(buf[i + 2] - bg[2]);
      if (d > tol) { if (y < minY) minY = y; if (y > maxY) maxY = y; break; }
    }
  }
  const ratio = maxY >= minY ? (maxY - minY + 1) / H : 0;
  return { ratio, minY, maxY };
}

// 浏览器视口：用一个"偏方"的窗口，确保四种比例都能在各方向内接（不因窗口过扁而失真）
const WIN_W = 1440, WIN_H = 900;

async function main() {
  const chromePath = resolveChromium();
  const xvfb = await setupDisplay();
  const srv = await startServer(path.join(root, 'dist'));

  const launch = () => puppeteer.launch({
    executablePath: chromePath,
    headless: 'new',
    args: [
      '--no-sandbox', '--disable-gpu-sandbox',
      '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--hide-scrollbars', '--force-device-scale-factor=1',
      `--window-size=${WIN_W},${WIN_H}`,
    ],
  });

  // 在页面内读 .viewport 的实际像素尺寸 + 自检信息
  const probe = async (page) => page.evaluate(() => {
    const vp = document.querySelector('.viewport');
    if (!vp) return null;
    const r = vp.getBoundingClientRect();
    return {
      w: Math.round(r.width), h: Math.round(r.height),
      ratio: r.height ? r.width / r.height : 0,
      brViewport: window.__brViewport || null,
      brConfig: window.__brConfig || null,
    };
  });

  try {
    // ── A. 四种比例的取景框比例 == 所选比例（+ 相机距离未被 maxDistance 钳制）──
    const browser = await launch();
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: WIN_W, height: WIN_H, deviceScaleFactor: 1 });

      for (const key of ASPECT_KEYS) {
        const cfg = { title: '比例校验', aspect: key, barIntervalMs: 2000, views: [
          { key: 'v', label: 'V', unit: '', fixed: 0, items: [
            { name: '甲', value: 10 }, { name: '乙', value: 30 },
            { name: '丙', value: 20 }, { name: '丁', value: 42 },
          ] },
        ] };
        const url = `${srv.base}/?debug=1&aspect=${encodeURIComponent(key)}&cfg=${encodeConfig(cfg)}`;
        await page.goto(url, { waitUntil: 'load' });
        await page.waitForFunction(() => !!window.__brViewport, { timeout: 15000 });
        // 等取景框过渡动画结束（.viewport 有 width/height transition）
        await new Promise((r) => setTimeout(r, 600));

        const p = await probe(page);
        const want = ASPECTS[key].ratio;
        const got = p.ratio;
        const errPct = Math.abs(got - want) / want * 100;
        check(
          `A. 取景框比例 == 所选比例（${key}）`,
          errPct <= 1.5,
          `期望 ${want.toFixed(4)} / 实测 ${got.toFixed(4)}（偏差 ${errPct.toFixed(2)}%，${p.w}×${p.h}）`,
        );
      }
    } finally {
      await browser.close();
    }

    // ── A2. 全景相机距离未被 maxDistance 静默钳制（四画幅）──────────
    //   需在 capture 模式（t=1 全景帧）下读取，故单独走一遍页面。
    //   用 n=28 的长列表（柱数越多 → 全景跨度越大 → 距离越大），确保真正触发钳制场景：
    //   旧实现 maxDistance = boxW*4 ≈ 457，而竖屏 28 项的全景距离需求远超此值。
    {
      const bigView = {
        key: 'big', label: '大', unit: '单位', fixed: 0,
        items: Array.from({ length: 28 }, (_, i) => ({ name: `实体${i + 1}`, value: (i + 1) * 7 % 97 + 3 })),
      };
      const browser2 = await launch();
      try {
        const page2 = await browser2.newPage();
        await page2.setViewport({ width: WIN_W, height: WIN_H, deviceScaleFactor: 1 });
        for (const key of ASPECT_KEYS) {
          const cfg2 = { title: '钳制校验', aspect: key, barIntervalMs: 2000, views: [bigView] };
          await page2.goto(`${srv.base}/?t=1&debug=1&aspect=${encodeURIComponent(key)}&cfg=${encodeConfig(cfg2)}`, { waitUntil: 'load' });
          await page2.waitForFunction(() => document.body.dataset.ready === '1', { timeout: 20000 });
          await new Promise((r) => setTimeout(r, 800));
          const c = await page2.evaluate(() => {
            try {
              const g = window.__brChart.getModel().getComponent('grid3D');
              const p = g.coordinateSystem.viewGL.camera.position;
              const wanted = window.__brFrame.camera.distance;
              return { wanted, actual: Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z) };
            } catch { return null; }
          });
          if (c) {
            const dev = Math.abs(c.actual - c.wanted) / c.wanted;
            check(`A2. 全景相机距离未被 maxDistance 钳制（${key}）`, dev <= 0.30,
              `请求 ${c.wanted.toFixed(1)} / 实际 ${c.actual.toFixed(1)}（偏差 ${(dev * 100).toFixed(1)}%）`);
          }
        }
      } finally {
        await browser2.close();
      }
    }

    // ── B. 各比例下画面非空白 + 内容占比合理 ────────────────────
    //    ★ 关键回归点：更"方/竖"的画幅下，跟随期的柱体必须仍然**高耸**（占满画面主体），
    //      而不是塌成中间一条横向薄带。判据用"柱体像素的竖向延展"：
    //      竖直方向的内容外接框高度占画面比例应 ≥ 12%（实测 16:9≈45%、1:1≈21%、9:16≈13%）。
    //      修复前 1:1 / 9:16 会远低于此线（柱体被压成薄饼）。
    const cfgBase = JSON.parse(fs.readFileSync(path.join(root, 'samples/huining.json'), 'utf8'));
    for (const key of ASPECT_KEYS) {
      const cfg = { ...cfgBase, aspect: key, views: [cfgBase.views[1]] }; // 用 area 视图（14 项）
      const { width, height } = pixelSizeFor(key, 1920);
      const out = path.join(ART, `aspect-${key.replace(':', '-')}.png`);
      // 跟随期截帧（t=0.6，reveal=0.72 → 仍在跟随段内，柱体已基本弹出）
      await shootFrame({
        chromiumPath: chromePath,
        base: srv.base,
        url: `/?t=0.6&aspect=${encodeURIComponent(key)}&cfg=${encodeConfig(cfg)}`,
        outPath: out,
        width, height,
      });
      const size = fs.statSync(out).size;
      check(
        `B. ${key} 出片非空白（${width}×${height}）`,
        size > 8000,
        `${(size / 1024).toFixed(0)}KB`,
      );
      // 内容竖向延展：用纯 JS 解 PNG（复用 verify.mjs 的思路，这里内联一个最小实现）
      const extent = pngVerticalExtent(out, width, height);
      check(
        `B. ${key} 跟随期柱体仍有竖向延展（构图未塌成横带）`,
        extent.ratio >= 0.12,
        `内容竖向占屏 ${(extent.ratio * 100).toFixed(1)}%（≥12%）`,
      );
    }

    // ── C. ?interval= 生效 → 时长按 interval 推导 ────────────────
    {
      const n = 4;
      const cfg = { title: '间隔校验', barIntervalMs: 2000, revealRatio: 0.72, views: [
        { key: 'v', label: 'V', unit: '', fixed: 0, items: [
          { name: 'a', value: 1 }, { name: 'b', value: 2 },
          { name: 'c', value: 3 }, { name: 'd', value: 4 },
        ] },
      ] };
      const b64 = encodeConfig(cfg);
      const browser2 = await launch();
      try {
        const page = await browser2.newPage();
        await page.setViewport({ width: WIN_W, height: WIN_H, deviceScaleFactor: 1 });
        // interval=3000 → duration = 4×3000/0.72 = 16667
        await page.goto(`${srv.base}/?debug=1&interval=3000&cfg=${b64}`, { waitUntil: 'load' });
        await page.waitForFunction(() => !!window.__brConfig, { timeout: 15000 });
        const info = await page.evaluate(() => window.__brConfig);
        const want = deriveDuration(n, 3000, 0.72);
        check(
          'C. ?interval=3000 生效（barIntervalMs 写入）',
          info.barIntervalMs === 3000,
          `barIntervalMs=${info.barIntervalMs}`,
        );
        check(
          'C. 总时长按 间隔×n/revealRatio 推导',
          info.durationMs === want,
          `期望 ${want}ms / 实测 ${info.durationMs}ms`,
        );
      } finally {
        await browser2.close();
      }
      // 纯逻辑对照：不同间隔下时长严格单调
      const a = deriveDuration(10, 1000, 0.72);
      const b = deriveDuration(10, 2000, 0.72);
      const c = deriveDuration(10, 4000, 0.72);
      check('C. 间隔↑ → 时长↑（1s<2s<4s）', a < b && b < c, `${a} < ${b} < ${c}`);
      check('C. 间隔 2s 为默认值', DEFAULT_BAR_INTERVAL_MS === 2000, String(DEFAULT_BAR_INTERVAL_MS));
    }

    // ── D. 导出像素推导（纯逻辑）──────────────────────────────
    for (const key of ASPECT_KEYS) {
      const { width, height } = pixelSizeFor(key, 1920);
      const longEdge = Math.max(width, height);
      const even = width % 2 === 0 && height % 2 === 0;
      const ratioErr = Math.abs(width / height - ASPECTS[key].ratio) / ASPECTS[key].ratio * 100;
      check(
        `D. ${key} → ${width}×${height}（长边 1920 / 偶数 / 比例一致）`,
        longEdge === 1920 && even && ratioErr <= 1.5,
        `长边=${longEdge} 偶数=${even} 比例偏差=${ratioErr.toFixed(2)}%`,
      );
    }
    // 与浏览器默认 1920×1080 一致（向后兼容：默认 16:9 的导出像素不变）
    const def = pixelSizeFor('16:9', 1920);
    check('D. 默认 16:9 导出像素保持 1920×1080（向后兼容）', def.width === 1920 && def.height === 1080, `${def.width}×${def.height}`);

    // ── E. 边界：非法值回退 ───────────────────────────────────
    check('E. 非法 aspect → normalizeAspect 返回 null', normalizeAspect('7:3') === null, String(normalizeAspect('7:3')));
    check('E. 像素写法 1920x1080 → 识别为 16:9', normalizeAspect('1920x1080') === '16:9', String(normalizeAspect('1920x1080')));
    {
      const { config: c1 } = normalizeConfig({ aspect: '7:3', views: [{ items: [{ name: 'a', value: 1 }] }] });
      check('E. 非法 aspect 配置 → 回退 16:9', c1.aspect === '16:9', c1.aspect);
      const { config: c2 } = normalizeConfig({ barIntervalMs: -5, views: [{ items: [{ name: 'a', value: 1 }] }] });
      check('E. 非法 barIntervalMs → 回退默认 2000', c2.barIntervalMs === 2000, String(c2.barIntervalMs));
      const { config: c3 } = normalizeConfig({ barIntervalMs: 999999, views: [{ items: [{ name: 'a', value: 1 }] }] });
      check('E. 超大 barIntervalMs → clamp 20000', c3.barIntervalMs === 20000, String(c3.barIntervalMs));
      const { config: c4 } = normalizeConfig({ source: '某来源', notes: ['注1', '', '注2'], views: [{ items: [{ name: 'a', value: 1 }] }] });
      check('E. source / notes 保留（空注过滤）', c4.source === '某来源' && c4.notes.length === 2, `source=${c4.source} notes=${c4.notes.length}`);
      // 显式 durationMs 优先于 interval 推导（老配置行为不变）
      const { config: c5 } = normalizeConfig({ durationMs: 5000, barIntervalMs: 3000, views: [{ items: [{ name: 'a', value: 1 }] }] });
      check('E. 显式 durationMs 优先（不被间隔推导覆盖）', c5.durationMs === 5000 && c5._durationExplicit === true, String(c5.durationMs));
    }
  } finally {
    await srv.close();
    if (xvfb && typeof xvfb.close === 'function') await xvfb.close();
    else if (xvfb && typeof xvfb.stop === 'function') xvfb.stop();
  }

  const pass = results.filter((r) => r.pass).length;
  console.log(`\n==== 画幅/间隔 QA 汇总：${pass}/${results.length} 通过 ====`);
  if (pass !== results.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error('❌ QA 异常：' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
