// QA：用户三个报障的永久回归断言（v2.10.1）
//   ① 重播 / 切换形状时数据未完成初始化
//      → 断言：开场首帧即有可见柱/球（非空白）；球体在【揭示段】每帧 sphereRworldCur>0
//        （旧回归：sphereRworldCur 仅在尾部赋值，揭示段为 undefined → 球憋到最后才冒出）；
//        且经 UI 切到球体后立即可见（数据已重建初始化）。
//   ② 最后一根柱出现后等待全屏过久 + 展示全部耗时过长
//      → 断言：revealRatio 实际生效为 0.85；尾部相机拉远（cx→0）在 reveal 后 ≤0.16
//        比例内完成，余下稳定停在全景（t=1 时 cx≈0，无末端漂移）。
//   ③ 球体效果惨不忍睹（旧版 scatter3D 四层同心贴片 = 扁圆光斑）
//      → 断言：球体由 surface 系列（lambert 光照、真实网格 ≥500 顶点）构成；
//        无旧式 sphere_ 开头 scatter3D billboard；仅 1 个隐形标签承载 scatter3D。
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
    await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });

    // ══════════ ① 重播 / 切形状：数据初始化 ══════════
    console.log('\n───── ① 重播 / 切形状 数据初始化 ─────');

    // 1a 球体：开场首帧 + 揭示中段均应有可见球（sphereRworldCur 每帧初始化）
    await page.goto(`${srv.base}/?view=population&shape=sphere&debug=1`, { waitUntil: 'load' });
    await sleep(2200);
    const b1 = await page.evaluate(() => {
      const c = window.__barRace;
      c.beginRecord();
      const at0 = c.renderAt(0.0);          // 重播回到起点
      const early = c.renderAt(0.04);       // 刚开场（对应"重播时数据未完成初始化"）
      const mid = c.renderAt(0.45);         // 揭示中段
      c.endRecord();
      const cnt = (f) => f.bars.filter((b) => b.shown && (b.sphereRworldCur || 0) > 0.0005).length;
      return {
        at0Shown: cnt(at0), at0Total: at0.bars.length,
        earlyShown: cnt(early), earlyTotal: early.bars.length,
        midShown: cnt(mid), midTotal: mid.bars.length,
        earlyFirstR: early.bars[0] ? +(early.bars[0].sphereRworldCur || 0).toFixed(4) : 0,
        earlyNA: early.bars.some((b) => b.shown && (b.sphereRworldCur === undefined || b.sphereRworldCur === null)),
      };
    });
    ok(b1.at0Shown >= 1, `① 重播起点 t=0 即有可见球（${b1.at0Shown}/${b1.at0Total}，非空白首帧）`);
    ok(b1.earlyShown >= 1, `① 球体开场即出现（t=0.04 已显示 ${b1.earlyShown}/${b1.earlyTotal} 球）`);
    ok(b1.midShown >= 3, `① 球体揭示中段大量就位（t=0.45 已显示 ${b1.midShown}/${b1.midTotal} 球）`);
    ok(b1.earlyFirstR > 0, `① 球体首柱半径已初始化（${b1.earlyFirstR} > 0，非 undefined）`);
    ok(!b1.earlyNA, `① 揭示段无 sphereRworldCur 为 undefined 的可见球（旧回归已消除）`);

    // 1b 经 UI 由 bar 切到 sphere：切后立即可见（数据重建初始化）
    await page.goto(`${srv.base}/?view=population&shape=bar&debug=1`, { waitUntil: 'load' });
    await sleep(2200);
    const switched = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('.seg-btn.shape')];
      const sphere = btns.find((b) => (b.getAttribute('title') || b.textContent || '').includes('球体'));
      if (sphere) sphere.click();
      return !!sphere;
    });
    await sleep(500); // watch(props.shape) → render → computeFrame 重建
    const sw = await page.evaluate(() => {
      const c = window.__barRace;
      c.beginRecord();
      const f = c.renderAt(0.1);
      c.endRecord();
      return {
        shape: f.shape,
        sphereShown: f.bars.filter((b) => b.shown && (b.sphereRworldCur || 0) > 0.0005).length,
        total: f.bars.length,
      };
    });
    ok(switched, '① 找到"球体"形状按钮并完成点击');
    ok(sw.shape === 'sphere', `① 切形状后 shape=${sw.shape}（已切换）`);
    ok(sw.sphereShown >= 1, `① 切到球体后立即可见（${sw.sphereShown}/${sw.total} 球，数据已初始化）`);

    // ══════════ ② 尾部相机过渡时长有界（不拖沓） ══════════
    console.log('\n───── ② 尾部过渡时长有界 ─────');
    await page.goto(`${srv.base}/?view=population&shape=bar&debug=1`, { waitUntil: 'load' });
    await sleep(2200);
    const tail = await page.evaluate(() => {
      const c = window.__barRace;
      const rr = window.__barRaceDS ? window.__barRaceDS.getConfig().revealRatio : null;
      c.beginRecord();
      const xs = [];
      for (let i = 0; i <= 240; i++) {
        const t = i / 240;
        const f = c.renderAt(t);
        xs.push({ t: +t.toFixed(4), cx: f.camera ? f.camera.center[0] : null });
      }
      c.endRecord();
      return { rr, xs };
    });
    ok(tail.rr && Math.abs(tail.rr - 0.85) < 0.01, `② revealRatio 实际生效 ${tail.rr}（≈0.85，非旧 0.72）`);
    if (tail.xs.length) {
      const v = tail.xs.map((x) => x.cx);
      const reveal = tail.rr || 0.85;
      // 尾部（reveal→1）中 cx 漂移结束的时刻：首个 t≥reveal 使得其后 |cx|<0.02
      let tEnd = 1;
      for (let i = 0; i < tail.xs.length; i++) {
        const { t, cx } = tail.xs[i];
        if (t < reveal) continue;
        let stable = true;
        for (let j = i; j < tail.xs.length; j++) if (Math.abs(tail.xs[j].cx) >= 0.02) { stable = false; break; }
        if (stable) { tEnd = t; break; }
      }
      const tailLen = tEnd - reveal;
      ok(tailLen <= 0.16, `② 尾部拉远在 reveal 后 ${tailLen.toFixed(3)} 比例内完成（≤0.16，余下稳定全景；旧 0.72→0.28 拖沓）`);
      ok(Math.abs(v[v.length - 1]) < 1e-3, `② t=1 时 cx=${v[v.length - 1].toExponential(2)}≈0（末端无漂移，稳定全景）`);
      const cxAtReveal = tail.xs.reduce((a, x) => (x.t <= reveal + 1e-6 ? x.cx : a), 0);
      ok(Math.abs(cxAtReveal) > 0.2, `② reveal 处确有显著偏移 ${cxAtReveal.toFixed(3)}（说明确有"拉远"动作）`);
    } else {
      ok(false, '② 无法获取相机轨迹');
    }

    // ══════════ ③ 球体为真实 3D 球面（surface + lambert） ══════════
    console.log('\n───── ③ 球体真实 3D 球面 ─────');
    await page.goto(`${srv.base}/?view=population&shape=sphere&debug=1`, { waitUntil: 'load' });
    await sleep(2200);
    const s3 = await page.evaluate(() => {
      const c = window.__barRace;
      c.beginRecord(); c.renderAt(0.5); c.endRecord();
      const opt = window.__brChart.getOption();
      const series = opt.series || [];
      const surf = series.filter((s) => s.type === 'surface');
      const surfLambert = surf.filter((s) => s.shading === 'lambert');
      const surfTess = surf.filter((s) => Array.isArray(s.data) && s.data.length >= 500); // 真实网格（≥500 顶点）
      const scatter = series.filter((s) => s.type === 'scatter3D');
      const billboard = scatter.filter((s) => (s.name || '').startsWith('sphere_'));
      // 全景（t=1）最大球屏幕直径：验证"球群饱满"而非一排细珠
      c.beginRecord(); const fw = c.renderAt(1.0); c.endRecord();
      const cv = document.querySelector('.bar-race canvas');
      const ch = (cv && cv.height) || 720;
      const visH = 2 * fw.camera.distance * Math.tan((16 / 2) * Math.PI / 180);
      const maxR = Math.max(...fw.bars.map((b) => b.sphereRworldCur || 0));
      const diaPx = 2 * maxR * (ch / visH);
      return {
        total: series.length, surface: surf.length, surfaceLambert: surfLambert.length,
        surfaceTess: surfTess.length, scatter: scatter.length, billboard: billboard.length,
        diaPx: +diaPx.toFixed(1), maxR: +maxR.toFixed(2),
      };
    });
    ok(s3.surface > 0, `③ 球体由 surface 系列构成（${s3.surface} 个，真实 3D 网格）`);
    ok(s3.surfaceLambert === s3.surface, `③ 全部 surface 启用 lambert 光照（${s3.surfaceLambert}/${s3.surface}，立体明暗）`);
    ok(s3.surfaceTess >= 1, `③ 存在真实镶嵌球面（${s3.surfaceTess} 个系列顶点数≥500，非两片扁盘）`);
    ok(s3.billboard === 0, `③ 已无旧式 scatter3D 同心贴片（billboard=${s3.billboard}）`);
    ok(s3.scatter === 1, `③ 仅保留 1 个隐形标签承载 scatter3D（${s3.scatter}）`);
    // 28 球同框时，单球直径≈步距投影（≈21px）即为"相邻相抵、饱满成串"的最优尺寸；
    // 阈值取 16px：确保是清晰可辨的 3D 球而非亚像素噪点（旧版扁盘无论多大都是错误的观感）。
    ok(s3.diaPx >= 16, `③ 全景最大球直径 ${s3.diaPx}px（≥16px，饱满成球非细珠；半径 ${s3.maxR} 世界单位 ≈ 步距相抵）`);

  } finally {
    await browser.close();
    await srv.close();
  }
  console.log(`\n==== 三问题回归汇总：${pass}/${pass + fail} 通过 ====`);
  process.exit(fail ? 1 : 0);
})();
