// QA：三个用户报障的永久回归断言（v2.8.1）
// 对应实际问题：
//   ① 「视频内容选择任意比例，显示的和生成的都是同样的」
//      → 断言：切换 aspect 后，3D 画布 CSS 尺寸必须**跟随取景框**且比例正确。
//        （旧缺陷：chart.resize() 只绑 window.resize，画幅切换只改 CSS 变量，
//          画布像素尺寸永远冻结在首次布局值 → 预览所见 ≠ 出片所得。）
//   ② 「当前圆柱显示的却是胶囊」
//      → 断言：cylinder 的垂直剖面必须**直壁 + 平顶**（中段宽度恒定、顶部不是尖角），
//        且必须与 rounded 显著不同（bar3D 的 bevel 无法表达真圆柱）。
//   ③ 「视频尾部过渡蹦跶不停」
//      → 断言：相机 cx 在 t∈[reveal,1] 必须**单调趋 0**、二阶差分峰值有界、
//        且在 t=reveal 处无阶跃（起点须与跟随期终点同源）。
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { resolveChromium, setupDisplay, startServer } from '../lib/capture-core.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (cond, msg) => {
  if (cond) { pass++; console.log(`✅ ${msg}`); }
  else { fail++; console.log(`❌ ${msg}`); }
};

// ── ③ 可离线验证的纯数值断言：尾部 CX 抖动阈值 ──
const TAIL_D2_LIMIT = 0.75;   // cx 二阶差分峰值上限（修复前 8.06）
const TAIL_JUMP_LIMIT = 0.05; // t=reveal 处单帧跃变量上限（修复前 6.13）

(async () => {
  await setupDisplay();
  const srv = await startServer(path.join(root, 'dist'));
  const browser = await puppeteer.launch({
    executablePath: resolveChromium(), headless: 'new',
    args: ['--no-sandbox', '--disable-gpu-sandbox', '--use-gl=swiftshader',
      '--enable-unsafe-swiftshader', '--hide-scrollbars'],
  });
  try {
    const page = await browser.newPage();

    // ══════════ ① 画幅比例必须驱动 3D 画布尺寸 ══════════
    // ★ 注意：**不能用 `?t=`**。capture 模式（?t=…）会把 vpSize 强制设为整个窗口
    //   （出片需要满窗口），此时取景框恒等于窗口 ⇒ 测不出"画幅是否驱动画布"。
    //   必须走正常预览路径（aspect 由 URL / 控件驱动），才是用户看到的取景框。
    console.log('\n───── ① 画幅比例 → 画布尺寸 ─────');
    const EXP = { '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1, '4:3': 4 / 3 };
    for (const [label, want] of Object.entries(EXP)) {
      await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
      const q = label === '16:9' ? '' : `?aspect=${label}`;
      await page.goto(`${srv.base}/${q}`, { waitUntil: 'load' });
      await sleep(2600);
      const r = await page.evaluate(() => {
        const g = (s) => { const e = document.querySelector(s); return e ? e.getBoundingClientRect() : null; };
        const vp = g('.viewport'), cv = g('.bar-race canvas');
        return { vp: vp && { w: +vp.width.toFixed(1), h: +vp.height.toFixed(1) },
          cv: cv && { w: +cv.width.toFixed(1), h: +cv.height.toFixed(1) } };
      });
      const rv = +(r.vp.w / r.vp.h).toFixed(3);
      const rc = +(r.cv.w / r.cv.h).toFixed(3);
      ok(Math.abs(rv - want) < 0.06,
        `① ${label}: 取景框比例 ${rv} ≈ 目标 ${want.toFixed(3)}（${r.vp.w}×${r.vp.h}）`);
      ok(Math.abs(rc - rv) < 0.06 && Math.abs(rc - want) < 0.06,
        `① ${label}: 画布比例跟随取景框 ${rc}（画布 ${r.cv.w}×${r.cv.h}）`);
    }

    // ══════════ ② 圆柱剖面必须直壁 + 平顶 ══════════
    // ★ 同样走正常预览路径（无 ?t=），并在动画播完后于**全景帧**截图测量。
    //   扫描线取样窗口按柱体实际占据的高度区间选取（画面中下部），
    //   避免采到上方空白/下方地面网格。
    console.log('\n───── ② 圆柱几何剖面 ─────');
    await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
    const profiles = {};
    for (const shape of ['rounded', 'cylinder']) {
      await page.goto(`${srv.base}/?view=population&shape=${shape}`, { waitUntil: 'load' });
      await sleep(2600);
      // 冻结到 t=1（全景）后再测量：用 renderAt 拉全景帧
      profiles[shape] = await page.evaluate(() => {
        const c = window.__barRace;
        if (!c || typeof c.beginRecord !== 'function') return null;
        c.beginRecord();
        c.renderAt(1);              // 全景帧（t=1：全部柱体已就位）
        c.endRecord();
        const cv = document.querySelector('.bar-race canvas');
        if (!cv) return null;
        const W = cv.width, H = cv.height;
        const tmp = document.createElement('canvas'); tmp.width = W; tmp.height = H;
        const ctx = tmp.getContext('2d'); ctx.drawImage(cv, 0, 0, W, H);
        // 先按行求"亮像素总数"，找出柱体真正占据的竖向区间
        const rowLit = [];
        for (let y = 0; y < H; y++) {
          const d = ctx.getImageData(0, y, W, 1).data;
          let n = 0;
          for (let x = 0; x < W; x++) { const i = x * 4; if (d[i] + d[i + 1] + d[i + 2] > 190) n++; }
          rowLit.push(n);
        }
        const peak = Math.max(...rowLit, 1);
        const rows = rowLit.map((v, y) => [y, v]).filter(([, v]) => v > peak * 0.25).map(([y]) => y);
        if (!rows.length) return null;
        const y0 = rows[0], y1 = rows[rows.length - 1];
        // 在柱体占据区间内均匀取 11 档测量总亮宽 → 归一化剖面
        const prof = [];
        for (let k = 0; k < 11; k++) {
          const y = Math.round(y0 + (y1 - y0) * (k / 10));
          const d = ctx.getImageData(0, Math.min(y, H - 1), W, 1).data;
          let run = 0;
          for (let x = 0; x < W; x++) { const i = x * 4; if (d[i] + d[i + 1] + d[i + 2] > 190) run++; }
          prof.push(run);
        }
        const mx = Math.max(...prof, 1);
        return { prof: prof.map((v) => +(v / mx).toFixed(3)), band: [y0, y1] };
      });
    }
    const cyl = profiles.cylinder?.prof || [];
    const rnd = profiles.rounded?.prof || [];
    console.log(`  cylinder 剖面: ${JSON.stringify(cyl)}  band=${JSON.stringify(profiles.cylinder?.band)}`);
    console.log(`  rounded  剖面: ${JSON.stringify(rnd)}  band=${JSON.stringify(profiles.rounded?.band)}`);
    ok(cyl.length === 11 && cyl.some((v) => v > 0.5), '② 成功采到柱体剖面（有亮带）');
    // 直壁判定：中段（第 4~8 档）宽度应基本恒定
    const mid = cyl.slice(3, 9);
    const midSpread = mid.length ? Math.max(...mid) - Math.min(...mid) : 1;
    ok(midSpread < 0.35, `② cylinder 中段直壁（宽度极差 ${midSpread.toFixed(3)} < 0.35）`);
    // 平顶判定：顶部档（第 3 档）不应塌成尖角
    ok((cyl[3] ?? 0) > 0.30, `② cylinder 顶部为面非尖角（第4档 ${cyl[3]} > 0.30）`);
    // 与 rounded 必须可区分
    const diff = cyl.length && rnd.length
      ? cyl.reduce((s, v, i) => s + Math.abs(v - (rnd[i] ?? 0)), 0) / cyl.length : 0;
    ok(diff > 0.02, `② cylinder 与 rounded 剖面有区分度（平均差 ${diff.toFixed(4)} > 0.02）`);

    // ══════════ ③ 尾部过渡：cx 单调趋 0 + 无阶跃 + 二阶差分有界 ══════════
    console.log('\n───── ③ 尾部过渡平滑性 ─────');
    await page.goto(`${srv.base}/?view=population&debug=1&t=0.72`, { waitUntil: 'load' });
    await sleep(2600);
    const traj = await page.evaluate(() => {
      const c = window.__barRace;
      if (!c || typeof c.beginRecord !== 'function') return null;
      c.beginRecord();
      const out = [];
      for (let i = 0; i <= 280; i++) {
        const t = 0.72 + (0.28 * i) / 280;   // 步长 0.001
        const f = c.renderAt(t);
        out.push({ t: +t.toFixed(4), cx: f && f.camera ? f.camera.center[0] : null });
      }
      c.endRecord();
      return out;
    });
    ok(!!traj, '③ 可获取逐帧相机轨迹（beginRecord/renderAt 可用）');
    if (traj) {
      const v = traj.map((x) => x.cx);
      // 单调递减（允许 1e-6 容差）
      let mono = true;
      for (let i = 1; i < v.length; i++) if (v[i] > v[i - 1] + 1e-6) { mono = false; break; }
      ok(mono, '③ cx 在尾部严格单调递减（无反向冲高 / 无过冲）');
      // 起止
      ok(Math.abs(v[v.length - 1]) < 1e-3, `③ 尾部终点 cx → 0（实测 ${v[v.length - 1].toExponential(2)}）`);
      // t=reveal 处首帧跃变
      const firstJump = Math.abs(v[1] - v[0]);
      ok(firstJump < TAIL_JUMP_LIMIT, `③ reveal 处无阶跃（首帧 |Δ|=${firstJump.toFixed(4)} < ${TAIL_JUMP_LIMIT}）`);
      // 二阶差分峰值
      let d2max = 0;
      for (let i = 2; i < v.length; i++) {
        d2max = Math.max(d2max, Math.abs((v[i] - v[i - 1]) - (v[i - 1] - v[i - 2])));
      }
      ok(d2max < TAIL_D2_LIMIT, `③ cx 二阶差分峰值 ${d2max.toFixed(4)} < ${TAIL_D2_LIMIT}（修复前 8.06）`);
      // 全程有界（不出现大于总行程 1/4 的单帧跳变）
      const spanCx = Math.max(...v) - Math.min(...v);
      let maxStep = 0;
      for (let i = 1; i < v.length; i++) maxStep = Math.max(maxStep, Math.abs(v[i] - v[i - 1]));
      ok(maxStep < spanCx / 4, `③ 无异常单帧跳变（max|Δ|=${maxStep.toFixed(3)} < 行程/4=${(spanCx / 4).toFixed(3)}）`);
    }
  } finally {
    await browser.close();
    await srv.close();
  }
  console.log(`\n==== 三问题回归汇总：${pass}/${pass + fail} 通过 ====`);
  process.exit(fail ? 1 : 0);
})();
