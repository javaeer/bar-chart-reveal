// QA：信息层「单一几何事实源」收敛验证（DOM ↔ Canvas 双层一致性）
//
// 【背景】v2.7 起信息层有两套渲染路径：
//   · DOM 预览层  — App.vue 的 .viewport 内 HTML（header / .metric-chip /
//                    .vp-source），样式由 --ov-* CSS 变量驱动；
//   · Canvas 录制层 — overlay.js:paintOverlay()，画在合成 canvas 上供录屏取流。
//   两条路径若各自维护排版系数，必然漂移（预览与出片观感对不上）。
//
// 【本脚本断言】两层的关键几何锚点必须在同一位置（容差 2px）：
//   ① 标题左上角   ② 视图徽标右上角   ③ 来源基线（左下/右下）
//   ④ --ov-* 变量值必须 == overlay.js:overlayMetrics() 的输出
//
// 【v2.8.3 变更】「当前目标」卡已彻底移除（用户指令），故：
//   · 不再探测/断言 .target-panel（该元素已不存在，probe 返回 null）；
//   · --ov-name / --ov-val / --ov-panel-* / --ov-bar-gap / --ov-rank* / --ov-unit
//     仍由 App.vue 注入（overlayMetrics 契约字段需完整），故变量一致性断言**全部保留**。
//
// 【怎么拿到 Canvas 侧几何】overlay.js 的 overlayMetrics() 已由 window.__brOverlayProvider
//   暴露（model.m）。Canvas 绘制坐标全部以 m.* 为输入，故 m.* 即 Canvas 侧几何真值。
//   DOM 侧用 getBoundingClientRect() 实测，换算到取景框局部坐标后逐项比对。
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { resolveChromium, setupDisplay, startServer } from '../lib/capture-core.mjs';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TOL = 2; // px 容差（子像素渲染 + clamp 取整）

async function probe(page, srv, { label, url, vw, vh }) {
  await page.setViewport({ width: vw, height: vh, deviceScaleFactor: 1 });
  await page.goto(`${srv.base}${url}`, { waitUntil: 'load' });
  await sleep(2600);
  return page.evaluate(() => {
    const vp = document.querySelector('.viewport');
    const provider = window.__brOverlayProvider;
    if (!vp || !provider) return { err: 'missing .viewport / __brOverlayProvider' };
    const model = provider();
    const m = model.m;                       // ← Canvas 侧几何真值（paintOverlay 的输入）
    const rect = vp.getBoundingClientRect();

    // DOM 元素矩形 → 取景框局部坐标
    const local = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left - rect.left, y: r.top - rect.top, w: r.width, h: r.height,
               right: rect.right - r.right, bottom: rect.bottom - r.bottom };
    };
    // --ov-* 变量实测值（CSSOM 解析，不用 getComputedStyle 的 px 字符串兜底）
    const cs = getComputedStyle(vp);
    const varPx = (k) => {
      const v = cs.getPropertyValue(k).trim();
      const n = parseFloat(v);
      return Number.isFinite(n) ? n : null;
    };
    return {
      size: { w: rect.width, h: rect.height },
      portrait: model.portrait,
      m,
      vars: {
        padX: varPx('--ov-pad-x'), padY: varPx('--ov-pad-y'),
        title: varPx('--ov-title'), sub: varPx('--ov-sub'),
        name: varPx('--ov-name'), val: varPx('--ov-val'),
        panelW: varPx('--ov-panel-w'), dot: varPx('--ov-dot'),
        gapS: varPx('--ov-gap-s'), src: varPx('--ov-src'),
        subIndent: varPx('--ov-sub-indent'),
        panelPadY: varPx('--ov-panel-pad-y'), panelPadX: varPx('--ov-panel-pad-x'),
        barGap: varPx('--ov-bar-gap'),
        chipK: varPx('--ov-chip-k'), chipV: varPx('--ov-chip-v'),
        chipPadY: varPx('--ov-chip-pad-y'),
        chipPadKX: varPx('--ov-chip-pad-kx'), chipPadVX: varPx('--ov-chip-pad-vx'),
        rank: varPx('--ov-rank'), rankB: varPx('--ov-rank-b'), unit: varPx('--ov-unit'),
      },
      header: local('header'),
      chip: local('.metric-chip'),
      // ★ v2.8.3：.target-panel 已移除（恒为 null，仅留探测以示"确实不存在"）
      panel: local('.target-panel'),
      source: local('.vp-source'),
    };
  });
}

const near = (a, b, tol = TOL) => a !== null && b !== null && Math.abs(a - b) <= tol;

(async () => {
  await setupDisplay();
  const srv = await startServer(path.join(root, 'dist'));
  const browser = await puppeteer.launch({
    executablePath: resolveChromium(), headless: 'new',
    args: ['--no-sandbox', '--disable-gpu-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars'],
  });
  const fails = [];
  const ok = (c, msg) => { console.log(`${c ? '✅' : '❌'} ${msg}`); if (!c) fails.push(msg); };

  try {
    const page = await browser.newPage();
    for (const [label, url, vw, vh] of [
      ['16:9', '/?t=0.9&view=population&debug=1', 960, 540],
      ['9:16', '/?t=0.9&view=population&aspect=9:16&debug=1', 540, 960],
      ['1:1',  '/?t=0.9&view=population&aspect=1:1&debug=1', 700, 700],
      ['4:3',  '/?t=0.9&view=population&aspect=4:3&debug=1', 800, 600],
    ]) {
      const r = await probe(page, srv, { label, url, vw, vh });
      console.log(`\n== ${label} ==  viewport ${Math.round(r.size.w)}×${Math.round(r.size.h)}  portrait=${r.portrait}`);
      if (r.err) { ok(false, `${label}: ${r.err}`); continue; }

      // ── ① CSS 变量 == overlayMetrics() 输出（数值一致性，容差 0.5px）──
      const mV = { padX: r.m.padX, padY: r.m.padY, title: r.m.title, sub: r.m.sub,
        name: r.m.name, val: r.m.val, panelW: r.m.panelW, dot: r.m.dot, gapS: r.m.gapS,
        src: r.m.src, subIndent: r.m.subIndent,
        panelPadY: r.m.panelPadY, panelPadX: r.m.panelPadX, barGap: r.m.barGapS,
        chipK: r.m.chipK, chipV: r.m.chipV, chipPadY: r.m.chipPadY,
        chipPadKX: r.m.chipPadKX, chipPadVX: r.m.chipPadVX,
        rank: r.m.rank, rankB: r.m.rankB, unit: r.m.unit };
      const mism = Object.keys(mV).filter((k) => !near(r.vars[k], mV[k], 0.5));
      ok(mism.length === 0, `${label}: --ov-* 全部 == overlayMetrics()${mism.length ? '（不符：' + mism.map((k) => `${k}: css=${r.vars[k]} js=${mV[k]}`).join(', ') + '）' : ''}`);

      // ── ② 标题左上角 == (padX, padY) ──
      if (r.header) {
        ok(near(r.header.x, r.m.padX) && near(r.header.y, r.m.padY),
          `${label}: 标题锚点 (${
            r.header.x.toFixed(1)}, ${r.header.y.toFixed(1)}) ≈ (padX ${r.m.padX.toFixed(1)}, padY ${r.m.padY.toFixed(1)})`);
      } else ok(false, `${label}: 未找到 header`);

      // ── ③ 视图徽标右上角 == (padX, padY) ──
      if (r.chip) {
        ok(near(r.chip.right, r.m.padX) && near(r.chip.y, r.m.padY),
          `${label}: 徽标锚点 右距 ${r.chip.right.toFixed(1)} ≈ padX ${r.m.padX.toFixed(1)}，上距 ${r.chip.y.toFixed(1)} ≈ padY ${r.m.padY.toFixed(1)}`);
      } else ok(false, `${label}: 未找到 .metric-chip`);

      // ── ④ 目标卡：已移除（v2.8.3）——断言"确实不存在"，防止误改回来 ──
      ok(r.panel === null, `${label}: .target-panel 已移除（探测结果 ${r.panel === null ? 'null ✅' : '仍存在 ❌'}）`);

      // ── ⑤ 来源：横屏左下 / 竖屏右下（与 Canvas 落位规则一致）──
      if (r.source) {
        if (r.portrait) {
          ok(near(r.source.right, r.m.padX), `${label}: 竖屏来源右距 ${r.source.right.toFixed(1)} ≈ padX ${r.m.padX.toFixed(1)}（应贴右）`);
        } else {
          ok(near(r.source.x, r.m.padX), `${label}: 横屏来源左缘 ${r.source.x.toFixed(1)} ≈ padX ${r.m.padX.toFixed(1)}（应贴左）`);
        }
        ok(near(r.source.bottom, r.m.padY), `${label}: 来源下距 ${r.source.bottom.toFixed(1)} ≈ padY ${r.m.padY.toFixed(1)}`);
      } else ok(false, `${label}: 未找到 .vp-source`);
    }
  } finally { await browser.close(); await srv.close(); }

  console.log(`\n==== 信息层几何收敛（DOM ↔ Canvas 同源）：${fails.length ? fails.length + ' 项失败' : '全部通过'} ====`);
  if (fails.length) process.exitCode = 1;
})();
