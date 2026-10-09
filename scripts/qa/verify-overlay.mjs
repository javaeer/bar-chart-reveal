// QA：录制器「合成画布」必须包含信息层（标题/视图徽标/当前目标/来源备注）
//
// 【背景】浏览器内导出 WebM 走 canvas.captureStream()，它只能捕获 WebGL 画布本身，
//   DOM 覆盖层（.vp-overlay）不在其中 → 导出的视频没有标题与信息面板。
//   修复方案见 src/core/overlay.js：录制时把 WebGL 画布与信息层合成到离屏 canvas 再取流。
//
// 【本脚本断言】对每种画幅，合成后相对「仅 3D」的新增亮像素要落在正确的分区里。
//   注意：来源/备注的落位随画幅变化（横屏左下 x=padX，竖屏右下 x=w-padX），
//   采样区必须同向 —— 早前的假阴性就是因为横屏却采样了右侧区域。
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { resolveChromium, setupDisplay, startServer } from '../lib/capture-core.mjs';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run(page, srv, { label, url, vw, vh }) {
  await page.setViewport({ width: vw, height: vh, deviceScaleFactor: 1 });
  await page.goto(`${srv.base}${url}`, { waitUntil: 'load' });
  await sleep(2600);
  const r = await page.evaluate(() => {
    const cv = document.querySelector('.bar-race canvas');
    const provider = window.__brOverlayProvider;
    const paint = window.__brPaintOverlay;
    if (!cv || !provider || !paint) return { err: 'missing hook' };
    const model = provider();
    const W = cv.width, H = cv.height;
    // 合成画布 = 录制器逻辑：画 3D + 画信息层
    const comp = document.createElement('canvas'); comp.width = W; comp.height = H;
    const ctx = comp.getContext('2d');
    ctx.drawImage(cv, 0, 0, W, H);
    const before = ctx.getImageData(0, 0, W, H).data.slice();
    paint(ctx, model);
    const after = ctx.getImageData(0, 0, W, H).data;
    // 统计"信息层新增的亮像素"
    let added = 0;
    for (let i = 0; i < after.length; i += 4) {
      const a = before[i] + before[i + 1] + before[i + 2];
      const b = after[i] + after[i + 1] + after[i + 2];
      if (b - a > 90) added++;
    }
    // 分区统计（标题区 / 右上徽标区 / 目标卡区 / 左下来源区）
    const region = (x0, y0, x1, y1) => {
      let n = 0;
      for (let y = Math.floor(y0); y < Math.floor(y1); y++) {
        for (let x = Math.floor(x0); x < Math.floor(x1); x++) {
          const i = (y * W + x) * 4;
          const a = before[i] + before[i + 1] + before[i + 2];
          const b = after[i] + after[i + 1] + after[i + 2];
          if (b - a > 90) n++;
        }
      }
      return n;
    };
    return {
      size: { W, H }, modelInfo: { title: model.title, target: model.target && model.target.name, notes: model.notes.length, portrait: model.portrait },
      added,
      titleZone: region(0, 0, W * 0.6, H * 0.22),
      chipZone: region(W * 0.62, 0, W, H * 0.16),
      targetZone: model.portrait ? region(0, H * 0.55, W * 0.75, H * 0.85) : region(0, H * 0.25, W * 0.35, H * 0.75),
      // 来源落位随画幅变化：横屏左下、竖屏右下 —— 采样区必须同向，否则会假阴性
      sourceZone: model.portrait ? region(W * 0.40, H * 0.86, W, H) : region(0, H * 0.84, W * 0.70, H),
    };
  });
  console.log(`\n== ${label} ==`);
  console.log(JSON.stringify(r));
  return r;
}

(async () => {
  await setupDisplay();
  const srv = await startServer(path.join(root, 'dist'));
  const browser = await puppeteer.launch({
    executablePath: resolveChromium(), headless: 'new',
    args: ['--no-sandbox', '--disable-gpu-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars'],
  });
  const fails = [];
  const ok = (c, m) => { console.log(`${c ? '✅' : '❌'} ${m}`); if (!c) fails.push(m); };
  try {
    const page = await browser.newPage();
    for (const [label, url, vw, vh] of [
      ['16:9 跟随期', '/?t=0.35&view=population&debug=1', 960, 540],
      ['16:9 全景', '/?t=0.9&view=population&debug=1', 960, 540],
      ['9:16 全景', '/?t=0.9&view=population&aspect=9:16&debug=1', 540, 960],
      ['4:3 全景', '/?t=0.9&view=population&aspect=4:3&debug=1', 800, 600],
    ]) {
      const r = await run(page, srv, { label, url, vw, vh });
      if (r.err) { ok(false, `${label}: ${r.err}`); continue; }
      ok(r.added > 500, `${label}: 合成后信息层新增亮像素 ${r.added}（>500）`);
      ok(r.titleZone > 50, `${label}: 标题区已绘制 ${r.titleZone} px`);
      ok(r.chipZone > 50, `${label}: 右上徽标区已绘制 ${r.chipZone} px`);
      ok(r.targetZone > 50, `${label}: 当前目标卡区已绘制 ${r.targetZone} px`);
      ok(r.sourceZone > 50, `${label}: 左下来源区已绘制 ${r.sourceZone} px`);
    }
  } finally { await browser.close(); await srv.close(); }
  console.log(`\n==== 合成录制信息层：${fails.length ? fails.length + ' 项失败' : '全部通过'} ====`);
  if (fails.length) process.exitCode = 1;
})();
