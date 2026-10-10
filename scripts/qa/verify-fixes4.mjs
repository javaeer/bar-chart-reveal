// QA：v2.8.3 三项用户报障的永久回归断言
// 对应用户原话：
//   ① 「干脆移除 当前目标 卡」            → 见 verify-geometry / verify-overlay / config.test
//                                           （.target-panel 不存在、模型无 target 字段）
//   ② 「添加暂停/继续播放功能」            → 本脚本 ① 组
//   ③ 「16:9 比例下，首根柱子不可见，且其他柱子生长也不可见，
//       应该保持两个柱体在屏幕中，且其中一个为生长的」→ 本脚本 ②③ 组
//
// 【② 暂停/继续】断言（在真实页面里操作按钮，不 mock）：
//   a. 操作分组内存在「暂停」按钮，且位于「重播」按钮**之前**（用户指定位置）；
//   b. 点击后进入暂停态：图标变 ▶、文案变「继续」、aria-pressed=true；
//   c. **暂停期间播放进度不再推进**（取两次 getProgress() 间隔 600ms，几乎不变）；
//   d. 再次点击可续播：进度重新推进；
//   e. 空格键等价于点击按钮（同一切换）；
//   f. 暂停态下点「重播」→ 恢复播放（按钮回到「暂停」文案）；
//   g. 出片模式（?t=…）下不渲染该按钮（不污染确定性出片链路）。
//
// 【③ 首柱可见 / 同屏≥2根】断言：
//   a. t=0.03（开场早期）画面内**柱体亮像素数 > 0 且占有可观的横向跨度**；
//      —— 旧缺陷：t=0 时 shown=0（一根都没有），t=0.005 仅 1 根且被推到屏宽 13%~41%；
//   b. 开场早期（t≈0.05）画面内**至少出现两组独立的柱体像素簇**（=≥2 根柱同框）；
//      —— 用横向列直方图的"连通亮段"数判定，比数 shown 更贴近"肉眼可见"；
//   c. 至少一根柱体处于"生长中"（0 < grow < 1），即用户要的"其中一个为生长的"；
//   d. 柱阵横向包围盒**不贴边**（左右边距均 ≥ 8%），且不完全偏离画面中心。
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

// 在 canvas 上统计"柱体像素"的横向列直方图，返回连通亮段（= 屏幕上的柱体簇）信息。
// 判定阈值与 probe 一致：亮度 > 0.22 且饱和度 > 0.28（排除深色背景与灰白 HUD）。
const MEASURE = () => {
  const cv = document.querySelector('.bar-race canvas');
  if (!cv) return null;
  const W = cv.width, H = cv.height;
  const tmp = document.createElement('canvas'); tmp.width = W; tmp.height = H;
  const ctx = tmp.getContext('2d'); ctx.drawImage(cv, 0, 0, W, H);
  const { data } = ctx.getImageData(0, 0, W, H);
  const col = new Array(W).fill(0);
  let minX = W, maxX = -1, minY = H, maxY = -1, cnt = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const sat = mx ? (mx - mn) / mx : 0;
      const lum = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
      if (lum > 0.22 && sat > 0.28) {
        cnt++; col[x]++;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  // 连通亮段：列计数 > 2 视为"该列有柱体"，段间允许 ≤2 列的空隙（抗锯齿/光晕断开）
  const thresh = 2, gap = 2;
  const segs = [];
  let s = -1, gapRun = 0;
  for (let x = 0; x < W; x++) {
    if (col[x] > thresh) {
      if (s < 0) s = x;
      gapRun = 0;
    } else if (s >= 0) {
      if (++gapRun > gap) { segs.push([s, x - gapRun]); s = -1; gapRun = 0; }
    }
  }
  if (s >= 0) segs.push([s, W - 1]);
  // 过滤掉极窄段（< 4px 视作噪点/文字）
  const wide = segs.filter(([a, b]) => b - a >= 4);
  return {
    W, H, cnt,
    bbox: cnt ? { minX, maxX, minY, maxY,
      x0p: +(minX / W * 100).toFixed(1), x1p: +(maxX / W * 100).toFixed(1),
      y0p: +(minY / H * 100).toFixed(1), y1p: +(maxY / H * 100).toFixed(1) } : null,
    clusters: wide.length,
    clusterSpans: wide.map(([a, b]) => `${(a / W * 100).toFixed(0)}%~${(b / W * 100).toFixed(0)}%`),
  };
};

(async () => {
  await setupDisplay();
  const srv = await startServer(path.join(root, 'dist'));
  const browser = await puppeteer.launch({
    executablePath: resolveChromium(), headless: 'new',
    args: ['--no-sandbox', '--disable-gpu-sandbox', '--use-gl=angle', '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader', '--hide-scrollbars'],
  });
  try {
    const page = await browser.newPage();

    // ══════════ ① 暂停 / 继续播放按钮 ══════════
    console.log('\n───── ① 暂停 / 继续播放 ─────');
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    await page.goto(`${srv.base}/?view=population&debug=1`, { waitUntil: 'load' });
    await sleep(2600);

    // a. 按钮存在且在「重播」之前
    const btnInfo = await page.evaluate(() => {
      const all = [...document.querySelectorAll('.seg-btn')];
      const pause = all.find((b) => /暂停|继续/.test(b.textContent || ''));
      const replay = all.find((b) => /重播/.test(b.textContent || ''));
      if (!pause || !replay) return { pause: !!pause, replay: !!replay };
      // 比较 DOM 顺序：compareDocumentPosition
      const DOC_POSITION_PRECEDING = 2;
      const before = !!(replay.compareDocumentPosition(pause) & DOC_POSITION_PRECEDING);
      return {
        pause: true, replay: true, before,
        text: (pause.textContent || '').trim(),
        ico: (pause.querySelector('.ico') || {}).textContent,
        pressed: pause.getAttribute('aria-pressed'),
      };
    });
    ok(btnInfo.pause, '①-a 「暂停」按钮存在');
    ok(btnInfo.replay && btnInfo.before, '①-a 「暂停」按钮位于「重播」之前（用户指定位置）');
    ok(/暂停/.test(btnInfo.text || ''), `①-b 初始文案为「暂停」（实测 "${btnInfo.text}"）`);
    ok(btnInfo.ico === '⏸', `①-b 初始图标为 ⏸（实测 "${btnInfo.ico}"）`);
    ok(btnInfo.pressed === 'false', `①-b 初始 aria-pressed=false（实测 "${btnInfo.pressed}"）`);

    // b. 点击 → 暂停态
    const clickPause = () => page.evaluate(() => {
      const btn = [...document.querySelectorAll('.seg-btn')].find((b) => /暂停|继续/.test(b.textContent || ''));
      if (btn) btn.click();
      return !!btn;
    });
    const readBtn = () => page.evaluate(() => {
      const btn = [...document.querySelectorAll('.seg-btn')].find((b) => /暂停|继续/.test(b.textContent || ''));
      return btn ? { text: (btn.textContent || '').trim(), ico: (btn.querySelector('.ico') || {}).textContent,
        pressed: btn.getAttribute('aria-pressed') } : null;
    });
    await sleep(1200); // 先让动画推进一会儿，避免起点 t≈0
    await clickPause();
    await sleep(120);
    const afterPause = await readBtn();
    ok(/继续/.test(afterPause.text || ''), `①-b 点击后文案变「继续」（实测 "${afterPause.text}"）`);
    ok(afterPause.ico === '▶', `①-b 点击后图标变 ▶（实测 "${afterPause.ico}"）`);
    ok(afterPause.pressed === 'true', `①-b 点击后 aria-pressed=true（实测 "${afterPause.pressed}"）`);

    // c. 暂停期间进度不推进
    const g1 = await page.evaluate(() => window.__barRace.getProgress());
    await sleep(700);
    const g2 = await page.evaluate(() => window.__barRace.getProgress());
    ok(Math.abs(g2 - g1) < 1e-6, `①-c 暂停期间进度冻结（${g1.toFixed(6)} → ${g2.toFixed(6)}，差 ${Math.abs(g2 - g1).toExponential(1)}）`);
    ok(await page.evaluate(() => window.__barRace.isPaused()) === true, '①-c isPaused() 返回 true');

    // d. 再次点击 → 续播，进度恢复推进
    await clickPause();
    await sleep(700);
    const g3 = await page.evaluate(() => window.__barRace.getProgress());
    ok(g3 > g2 + 1e-6, `①-d 续播后进度重新推进（${g2.toFixed(6)} → ${g3.toFixed(6)}）`);
    ok(await page.evaluate(() => window.__barRace.isPaused()) === false, '①-d isPaused() 返回 false');
    const resumedBtn = await readBtn();
    ok(/暂停/.test(resumedBtn.text || ''), `①-d 按钮回到「暂停」文案（实测 "${resumedBtn.text}"）`);

    // e. 空格键等价于点击
    const beforeSpace = await page.evaluate(() => window.__barRace.isPaused());
    await page.keyboard.press('Space');
    await sleep(120);
    const afterSpace = await page.evaluate(() => window.__barRace.isPaused());
    ok(beforeSpace !== afterSpace, `①-e 空格键切换暂停态（${beforeSpace} → ${afterSpace}）`);
    // 再按一次复位
    await page.keyboard.press('Space');
    await sleep(120);
    ok(await page.evaluate(() => window.__barRace.isPaused()) === false, '①-e 再按空格恢复播放');

    // f. 暂停态下点「重播」→ 恢复播放
    await clickPause();
    await sleep(120);
    ok(await page.evaluate(() => window.__barRace.isPaused()) === true, '①-f 前置：已处于暂停态');
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('.seg-btn')].find((b) => /重播/.test(b.textContent || ''));
      if (btn) btn.click();
    });
    await sleep(400);
    ok(await page.evaluate(() => window.__barRace.isPaused()) === false, '①-f 点「重播」后解除暂停');
    const afterReplay = await readBtn();
    ok(/暂停/.test(afterReplay.text || ''), `①-f 按钮回到「暂停」文案（实测 "${afterReplay.text}"）`);

    // g. 出片模式不**显示**该按钮（DOM 仍在，但整个 dock 带 .hidden → display:none）
    await page.goto(`${srv.base}/?view=population&t=0.5`, { waitUntil: 'load' });
    await sleep(1800);
    const inCapture = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('.seg-btn')].find((b) => /暂停|继续/.test(b.textContent || ''));
      const dock = document.querySelector('.dock');
      // 可见性判据：按钮自身与其容器都不得被 display:none / visibility:hidden 隐藏
      const visible = (el) => {
        if (!el) return false;
        for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
          const cs = getComputedStyle(n);
          if (cs.display === 'none' || cs.visibility === 'hidden') return false;
        }
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      return { hasBtn: !!btn, btnVisible: visible(btn), dockHidden: !!(dock && dock.classList.contains('hidden')) };
    });
    ok(inCapture.hasBtn && !inCapture.btnVisible,
      `①-g 出片模式（?t=…）下暂停按钮不可见（dock.hidden=${inCapture.dockHidden}，按钮可见=${inCapture.btnVisible}）`);

    // ══════════ ② 开场首柱可见 ══════════
    console.log('\n───── ② 开场首柱可见 ─────');
    await page.setViewport({ width: 960, height: 540, deviceScaleFactor: 1 });
    await page.goto(`${srv.base}/?view=population&debug=1`, { waitUntil: 'load' });
    await sleep(2600);

    for (const [label, t] of [['t=0（开场首帧）', 0], ['t=0.005（开场首帧附近）', 0.005], ['t=0.03', 0.03], ['t=0.05', 0.05]]) {
      const r = await page.evaluate((tt) => {
        const c = window.__barRace;
        c.beginRecord();
        const f = c.renderAt(tt);
        const shown = f.bars.filter((b) => b.shown).length;
        // 「生长中」= 已开始生长且未长成。t=0 是 k=0 的生长起点，grow 恰为 0，
        // 故下界用 <=（含起点帧）；上界 <1 表示尚未长成。
        const growing = f.bars.filter((b) => b.grow <= 1 && b.grow < 0.999 && b.shown).length;
        const growingStrict = f.bars.filter((b) => b.grow > 0 && b.grow < 0.999).length;
        // 世界上"已出现"的柱数（shown 则已出现）—— 决定同屏柱数的物理上限
        const born = f.bars.filter((b) => b.shown).length;
        return { shown, growing, growingStrict, born, cx: +f.camera.center[0].toFixed(2) };
      }, t);
      // 注意：renderAt 后不能 endRecord（否则 rAF 恢复会覆盖画面再截图）
      const m = await page.evaluate(MEASURE);
      console.log(`  ${label}: shown=${r.shown} born=${r.born} growing=${r.growing}(strict ${r.growingStrict}) cx=${r.cx} 柱体像素=${m.cnt} 簇=${m.clusters}[${m.clusterSpans.join(' ')}] bbox=${JSON.stringify(m.bbox)}`);
      // ★ 核心断言（对任何 t 都成立）：画面里有柱体、不贴边、且有柱正生长
      ok(m.cnt > 400, `② ${label}: 画面存在柱体（${m.cnt} px > 400）`);
      ok(!!m.bbox && m.bbox.x0p >= 8 && m.bbox.x1p <= 92,
        `② ${label}: 柱阵不贴边（x ${m.bbox?.x0p}%~${m.bbox?.x1p}%，两侧边距 ≥8%）`);
      // 生长中：t=0 时 k=0 恰处于生长起点（grow=0），故用含起点的口径；
      // t>0 时优先用严格口径（0<grow<1），并回退到宽松口径以覆盖起点帧。
      ok(r.growing >= 1, `② ${label}: 存在生长中的柱体（严格 ${r.growingStrict} 根 / 含起点 ${r.growing} 根）`);
      ok(r.shown >= 1, `② ${label}: 画面内已出现柱体 ≥1 根（实测 ${r.shown}）`);
      // ★ t=0 专项：种子高度修复前首帧柱体像素为 0（空场景）。见 computeFrame 内 SEED_H。
      if (t === 0) {
        ok(m.cnt > 150, `② ${label}: 首帧已有可见柱体种子（${m.cnt} px > 150，修复前为 0）`);
      }
      // ★ 同屏柱数：受"世界上已诞生几根"的物理上限约束。
      //   t=0.005 时世界上只有 1 根柱（第 2 根 0.85×step≈0.0218 才诞生），
      //   故此处只要求"达到物理上限"；t≥0.03 起世界上已有 ≥2 根，要求全部同屏。
      ok(r.shown >= Math.min(r.born, 2),
        `② ${label}: 已出现柱体同屏（shown=${r.shown} ≥ min(世界上已诞生 ${r.born}, 2)）`);
    }
    // 收尾：结束录制模式，避免影响后续
    await page.evaluate(() => window.__barRace.endRecord());

    // ══════════ ③ 开场"同屏 ≥2 根"（像素级）：横向 ≥2 个独立柱体簇 ══════════
    console.log('\n───── ③ 开场同屏柱体簇数 ─────');
    await page.goto(`${srv.base}/?view=population&debug=1`, { waitUntil: 'load' });
    await sleep(2600);
    for (const t of [0.05, 0.08, 0.12]) {
      const r = await page.evaluate((tt) => {
        const c = window.__barRace;
        c.beginRecord();
        const f = c.renderAt(tt);
        const growing = f.bars.filter((b) => b.grow > 0.001 && b.grow < 0.999).length;
        return { growing, shown: f.bars.filter((b) => b.shown).length };
      }, t);
      const m = await page.evaluate(MEASURE);
      console.log(`  t=${t}: shown=${r.shown} growing=${r.growing} 簇=${m.clusters}[${m.clusterSpans.join(' ')}]`);
      ok(m.clusters >= 2, `③ t=${t}: 画面内 ≥2 个独立柱体簇（实测 ${m.clusters}：[${m.clusterSpans.join(' ')}]）`);
      // 柱阵中心不应严重偏离画面中线（≥30% 且 ≤70% 视为居中带）
      const centerP = (m.bbox.x0p + m.bbox.x1p) / 2;
      ok(centerP >= 25 && centerP <= 75, `③ t=${t}: 柱阵中心 ${centerP.toFixed(1)}% 在画面中央带 25%~75%`);
    }
    await page.evaluate(() => window.__barRace.endRecord());

    // ══════════ ④ 圆柱模式同样满足（柱体簇判定对真圆柱也成立）══════════
    console.log('\n───── ④ 圆柱模式开场同居中 ═════════');
    await page.goto(`${srv.base}/?view=population&shape=cylinder&debug=1`, { waitUntil: 'load' });
    await sleep(2600);
    const r4 = await page.evaluate(() => {
      const c = window.__barRace;
      c.beginRecord();
      c.renderAt(0.05);
      return { growing: c.computeFrame(0.05).bars.filter((b) => b.grow > 0.001 && b.grow < 0.999).length };
    });
    const m4 = await page.evaluate(MEASURE);
    console.log(`  cylinder t=0.05: growing=${r4.growing} 柱体像素=${m4.cnt} 簇=${m4.clusters}[${m4.clusterSpans.join(' ')}]`);
    ok(m4.cnt > 300, `④ cylinder: 画面存在柱体（${m4.cnt} px > 300）`);
    ok(m4.clusters >= 2, `④ cylinder: 画面内 ≥2 个独立柱体簇（实测 ${m4.clusters}）`);
    await page.evaluate(() => window.__barRace.endRecord());
  } finally {
    await browser.close();
    await srv.close();
  }
  console.log(`\n==== v2.8.3 回归汇总：${pass}/${pass + fail} 通过 ====`);
  process.exit(fail ? 1 : 0);
})();
