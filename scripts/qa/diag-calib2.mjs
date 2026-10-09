// 跟随期垂直构图精细标定：扫描 cy（绝对值），测柱底/柱顶屏幕位置
// 用法：node scripts/qa/diag-calib2.mjs
// 自包含：自动构建 dist（若缺失）→ 启动本地静态服务（不再依赖硬编码的 localhost:5173）。
import puppeteer from 'puppeteer-core';
import { resolveChromium, setupDisplay, startServer } from '../lib/capture-core.mjs';
import { PNG } from 'pngjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');
const dist = path.join(root, 'dist');
// 截图输出目录：默认系统临时目录，可用 QA_ART 覆盖。
const outDir = process.env.QA_ART
  ? path.resolve(process.env.QA_ART)
  : path.join(os.tmpdir(), 'bar-chart-reveal-calib');
fs.mkdirSync(outDir, { recursive: true });

function analyzePNG(buf) {
  const png = PNG.sync.read(buf);
  const { width: W, height: H, data } = png;
  const my = Math.round(H * 0.02);
  const rowCount = new Array(H).fill(0);
  for (let y = my; y < H - my; y++) {
    for (let x = Math.round(W * 0.03); x < Math.round(W * 0.97); x++) {
      const i = (y * W + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const isWhite = r > 150 && g > 150 && b > 150;
      const isBlueCyan = !isWhite && b > 140 && g > 110 && r < 130;
      const isYellow = !isWhite && r > 190 && g > 150 && b < 130;
      if (isBlueCyan || isYellow) rowCount[y]++;
    }
  }
  let minY = H, maxY = -1;
  for (let y = 0; y < H; y++) if (rowCount[y] >= 25) { if (y < minY) minY = y; if (y > maxY) maxY = y; }
  return { H, minY, maxY, top: (minY / H * 100).toFixed(1), bottom: (maxY / H * 100).toFixed(1) };
}

// —— 自包含：dist 缺失时先构建，再自启静态服务 ——
if (!fs.existsSync(path.join(dist, 'index.html'))) {
  console.log('▶ 未检测到 dist，先执行 vite build ...');
  execFileSync('npx', ['vite', 'build'], { cwd: root, stdio: 'inherit' });
}

const xvfb = await setupDisplay(console.log, console.warn);
const srv = await startServer(dist, console.log);
const browser = await puppeteer.launch({
  executablePath: resolveChromium(),
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1280, height: 653 },
});
const page = await browser.newPage();

for (const t of [0.36, 0.71]) {
  console.log(`\n===== t=${t} =====`);
  for (let cy = -2; cy <= 16; cy += 2) {
    const url = `${srv.base}/?t=${t}&debug=1&cam=18,${cy},87.12`;
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForFunction(() => document.body.dataset.ready === '1', { timeout: 30000 });
    await new Promise((r) => setTimeout(r, 350));
    const buf = await page.screenshot();
    const a = analyzePNG(buf);
    console.log(`cy=${String(cy).padStart(3)} -> 柱体 y ${a.minY}-${a.maxY} (top=${a.top}% bottom=${a.bottom}%)`);
    if (cy === 6 || cy === 10) fs.writeFileSync(path.join(outDir, `calib2_t${t}_cy${cy}.png`), buf);
  }
}
await browser.close();
await srv.close();
if (xvfb) xvfb.kill();
