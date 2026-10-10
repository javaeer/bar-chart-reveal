// 探针：把「注视点 center[0]（cx）」随 t 的轨迹打出来，定位硬切换点。
// 用法：node scripts/qa/probe-cx.mjs [--view population] [--steps 900]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { resolveChromium, setupDisplay, startServer } from '../lib/capture-core.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');
const args = process.argv.slice(2);
const get = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const view = get('view', 'population');
const STEPS = Number(get('steps', 900));

await setupDisplay();
const srv = await startServer(path.join(root, 'dist'), null);
const browser = await puppeteer.launch({
  executablePath: resolveChromium(), headless: 'new',
  args: ['--no-sandbox', '--disable-gpu-sandbox', '--use-gl=angle', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader', '--hide-scrollbars'],
});

try {
  const page = await browser.newPage();
  const VIEWS = [[1280, 720], [1080, 1920], [1080, 1080]];
  for (const [W, H] of VIEWS) {
    await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
    await page.goto(`${srv.base}/?view=${view}&debug=1`, { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.__barRace, { timeout: 30000 });

    const rows = await page.evaluate((steps) => {
      const api = window.__barRace;
      const out = [];
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const f = api.computeFrame(t);
        out.push({
          t: +t.toFixed(6),
          cx: +f.camera.center[0].toFixed(4),
          cy: +f.camera.center[1].toFixed(4),
          activeIdx: f.activeIdx,
          revealed: f.revealed,
          dist: +f.camera.distance.toFixed(4),
          halfW: +(f.boxW / 2).toFixed(3),
        });
      }
      return out;
    }, STEPS);

    const cxs = rows.map((r) => r.cx);
    const jumps = [];
    for (let i = 1; i < rows.length; i++) {
      const d = rows[i].cx - rows[i - 1].cx;
      if (Math.abs(d) > 0.5) jumps.push({ i, t: rows[i].t, from: rows[i - 1].cx, to: rows[i].cx, d });
    }
    const idxJumps = [];
    for (let i = 1; i < rows.length; i++) if (rows[i].activeIdx !== rows[i - 1].activeIdx) idxJumps.push({ t: rows[i].t, from: rows[i - 1].activeIdx, to: rows[i].activeIdx });
    const idxTs = new Set(idxJumps.map((j) => j.t));
    const unmatched = jumps.filter((j) => !idxTs.has(j.t));

    console.log(`\n══════ ${W}×${H}  (step=${(1 / STEPS).toFixed(5)}, 即 ${STEPS} 档) ══════`);
    console.log(`boxW=${(rows[0].halfW * 2).toFixed(2)}  →  center 应被钳到 ±${rows[0].halfW.toFixed(1)}`);
    console.log(`cx 范围 ${Math.min(...cxs).toFixed(2)} ~ ${Math.max(...cxs).toFixed(2)}`);
    console.log(`|Δcx| > 0.5 的硬跳：${jumps.length} 处`);
    console.log('   t        前cx      后cx      Δcx     activeIdx  revealed');
    for (const j of jumps.slice(0, 25)) {
      const a = rows[j.i - 1], b = rows[j.i];
      const tag = idxTs.has(j.t) ? '  ←activeIdx切换' : '  ★额外跳';
      console.log(`${j.t.toFixed(5)} ${j.from.toFixed(2).padStart(9)} ${j.to.toFixed(2).padStart(9)} ${j.d.toFixed(2).padStart(8)}   ${a.activeIdx}→${b.activeIdx}     ${b.revealed}${tag}`);
    }
    console.log(`→ ${jumps.length} 处硬跳：${jumps.length - unmatched.length} 处与 activeIdx 切换同刻，${unmatched.length} 处额外`);
    const quiet = [];
    for (let i = 1; i < rows.length; i++) if (!idxTs.has(rows[i].t) && !idxTs.has(rows[i - 1].t)) quiet.push(Math.abs(rows[i].cx - rows[i - 1].cx));
    quiet.sort((a, b) => b - a);
    console.log(`→ 非切换帧 |Δcx|: 中位 ${quiet[Math.floor(quiet.length / 2)]?.toFixed(4)} · 最大 ${quiet[0]?.toFixed(4)}`);
    console.log(`→ activeIdx 切换次数 ${idxJumps.length}；最大单次 |Δcx| = ${jumps.length ? Math.max(...jumps.map((j) => Math.abs(j.d))).toFixed(2) : 0}`);
  }
} finally {
  await browser.close();
  await srv.close();
  process.exit(0);
}
