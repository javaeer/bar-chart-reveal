// 快速构图预览（临时工具）：对 dev server 依次截取多帧，用于相机参数迭代
// 用法: node scripts/qa/diag-frames.mjs [outdir] [w] [h]
import puppeteer from 'puppeteer-core';
import { resolveChromium, setupDisplay } from '../lib/capture-core.mjs';
import fs from 'node:fs';

const outdir = process.argv[2] || '/tmp/frames';
const W = Number(process.argv[3] || 1280);
const H = Number(process.argv[4] || 653);
fs.mkdirSync(outdir, { recursive: true });

const xvfb = await setupDisplay(console.log, console.warn);
const browser = await puppeteer.launch({
  executablePath: resolveChromium(),
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: W, height: H },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message.slice(0, 200)}`));

const ts = [0.05, 0.18, 0.36, 0.54, 0.71, 0.80, 0.92, 1.0];
for (const t of ts) {
  // 每个 t 用全新页面加载（?t= 是确定性截帧模式）
  await page.goto(`http://localhost:5173/?t=${t}&debug=1`, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(() => document.body.dataset.ready === '1', { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 400)); // GL 追平
  const f = await page.evaluate(() => ({
    cam: window.__brFrame && window.__brFrame.camera,
    labels: window.__brFrame ? window.__brFrame.labels.length : -1,
  }));
  const name = `${outdir}/t_${String(t).replace('.', '_')}.png`;
  await page.screenshot({ path: name });
  console.log(`t=${t} cam=${JSON.stringify(f.cam)} labels=${f.labels} -> ${name}`);
}
await browser.close();
if (xvfb) xvfb.kill();
