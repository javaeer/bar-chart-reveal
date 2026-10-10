// v2.9.0 回归：① 连续注视点（根治"每换一根柱整屏硬跳"）② 画幅自适应取景
// 用法：npm run qa:fixes5
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { resolveChromium, setupDisplay, startServer } from '../lib/capture-core.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');
const STEPS = Number(process.argv.includes('--steps') ? process.argv[process.argv.indexOf('--steps') + 1] : 900);

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`✅ ${m}`); } else { fail++; console.log(`❌ ${m}`); } };

await setupDisplay();
const srv = await startServer(path.join(root, 'dist'), null);
const browser = await puppeteer.launch({
  executablePath: resolveChromium(), headless: 'new',
  args: ['--no-sandbox', '--disable-gpu-sandbox', '--use-gl=angle', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader', '--hide-scrollbars'],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
  await page.goto(`${srv.base}/?view=population&debug=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__barRace, { timeout: 30000 });

  const rows = await page.evaluate((steps) => {
    const api = window.__barRace;
    const out = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const f = api.computeFrame(t);
      out.push({ t: +t.toFixed(6), cx: +f.camera.center[0].toFixed(4), activeIdx: f.activeIdx, revealed: f.revealed });
    }
    return out;
  }, STEPS);

  // ── ① 连续注视点 ──
  console.log('\n───── ① 注视点连续性（v2.9.0 核心修复） ─────');
  const d1 = [];
  for (let i = 1; i < rows.length; i++) d1.push({ i, d: rows[i].cx - rows[i - 1].cx, t: rows[i].t });
  const maxAbs = Math.max(...d1.map((x) => Math.abs(x.d)));
  // 修复前实测：单次最大 |Δcx| = 6.00（≈0.75 个柱距 S=8）
  ok(maxAbs <= 1.0, `① 单次最大 |Δcx| = ${maxAbs.toFixed(2)} ≤ 1.0（修复前 6.00）`);

  const idxTs = new Set();
  for (let i = 1; i < rows.length; i++) if (rows[i].activeIdx !== rows[i - 1].activeIdx) idxTs.add(rows[i].t);
  const syncJumps = d1.filter((x) => Math.abs(x.d) > 0.5 && idxTs.has(x.t));
  // 修复前：27 处与 activeIdx 切换同刻（= n−1，每根柱一次台阶）
  ok(syncJumps.length === 0, `① 与 activeIdx 切换同刻的硬跳 = ${syncJumps.length} 处（修复前 27，要求 0）`);

  // 跟随段（t ≤ 0.70，早于尾部过渡）应严格单调不减，且无回弹
  const follow = rows.filter((r) => r.t <= 0.70);
  let mono = true;
  for (let i = 1; i < follow.length; i++) if (follow[i].cx < follow[i - 1].cx - 1e-6) { mono = false; break; }
  ok(mono, `① 跟随段（t≤0.70）cx 严格单调不减（无回弹/过冲）`);

  // 二阶差分：速度不应突变（尾部 smoothstep 端点导数为 0）
  const cxs = rows.map((r) => r.cx);
  const d2 = Math.max(...cxs.slice(2).map((v, i) => Math.abs(cxs[i + 2] - 2 * cxs[i + 1] + cxs[i])));
  ok(d2 <= 0.5, `① cx 二阶差分峰值 = ${d2.toFixed(4)} ≤ 0.5（速度无突变）`);

  // ── ② 画幅自适应取景 ──
  console.log('\n───── ② 画幅自适应取景（同屏柱数下限保证） ─────');
  // 水平可视宽 = 2·d·tan(FOV/2)·aspect ⇒ 同屏柱数 = 可视宽 / S(8)
  const S = 8, FOV = 16;
  for (const [name, w, h] of [['16:9', 810, 456], ['4:3', 1080, 810], ['1:1', 810, 810], ['9:16', 456, 810]]) {
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    await page.goto(`${srv.base}/?view=population&debug=1`, { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.__barRace, { timeout: 30000 });
    const r = await page.evaluate(({ w, h }) => {
      const vp = document.querySelector('.viewport');
      if (!vp) return null;
      vp.style.setProperty('--vp-w', `${w}px`);
      vp.style.setProperty('--vp-h', `${h}px`);
      const f = window.__barRace.computeFrame(0.5);
      const el = document.querySelector('.bar-race') || vp;
      const a = el.clientWidth / el.clientHeight;
      return { dist: f.camera.distance, aspect: a };
    }, { w, h });
    if (!r) { ok(false, `② ${name}: 未找到 .viewport`); continue; }
    const bars = (2 * r.dist * Math.tan((FOV / 2) * Math.PI / 180) * r.aspect) / S;
    // 修复前 9:16 仅 1.72 根（连"同屏 2 根"都达不到）
    ok(bars >= 3.0, `② ${name} 跟随期同屏柱数 = ${bars.toFixed(2)} ≥ 3.0（修复前 9:16 仅 1.72）`);
  }
} finally {
  console.log(`\n==== v2.9.0 回归汇总：${pass}/${pass + fail} 通过 ====`);
  await browser.close();
  await srv.close();
  process.exit(fail ? 1 : 0);
}
