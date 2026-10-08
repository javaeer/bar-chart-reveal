// 端到端播放验证：真实播放模式（rAF 驱动），全程多点采样 + 空白检测
// 对应用户 bug 1："页面观看时……未看到柱状图，直到最后才显示所有的柱子"
import puppeteer from 'puppeteer-core';
import { resolveChromium, setupDisplay } from '../lib/capture-core.mjs';
import { PNG } from 'pngjs';
import fs from 'node:fs';

const outdir = '/tmp/play_verify';
fs.mkdirSync(outdir, { recursive: true });

function barPixels(buf) {
  const png = PNG.sync.read(buf);
  const { width: W, height: H, data } = png;
  let count = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const isWhite = r > 150 && g > 150 && b > 150;
      const isBlueCyan = !isWhite && b > 140 && g > 110 && r < 130;
      const isYellow = !isWhite && r > 190 && g > 150 && b < 130;
      if (isBlueCyan || isYellow) count++;
    }
  }
  return count;
}

const xvfb = await setupDisplay(console.log, console.warn);
const browser = await puppeteer.launch({
  executablePath: resolveChromium(),
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1280, height: 653 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));

await page.goto('http://localhost:5173/?debug=1', { waitUntil: 'networkidle2', timeout: 60000 });
// 等动画真正开始（__brFrame.t > 0.005），确保覆盖 t≈0 的最早期画面
await page.waitForFunction(() => window.__brFrame && window.__brFrame.t > 0.005, { timeout: 30000 });

// 播放全程采样：前 1.2s 每 150ms（早期柱少，重点验证不空白），之后每 500ms
const samples = [];
let idx = 0;
const t0 = Date.now();
async function snap() {
  const buf = await page.screenshot();
  const px = barPixels(buf);
  const t = await page.evaluate(() => window.__brFrame ? +window.__brFrame.t.toFixed(3) : -1);
  fs.writeFileSync(`${outdir}/p_${String(idx).padStart(2, '0')}_t${t}.png`, buf);
  samples.push({ ms: Date.now() - t0, t, barPx: px });
  console.log(`t=${t.toFixed(2)} barPixels=${px}`);
  idx++;
}
for (let i = 0; i < 8; i++) { await snap(); await new Promise((r) => setTimeout(r, 150)); }
while (samples[samples.length - 1].t < 1) { await snap(); await new Promise((r) => setTimeout(r, 500)); }

const blanks = samples.filter((s) => s.t > 0.03 && s.barPx < 3000);
console.log('\nSUMMARY:', JSON.stringify({
  samples: samples.length,
  blanks: blanks.length,
  blankTs: blanks.map((b) => b.t),
  pageErrors: errors,
}));
console.log(blanks.length === 0 && errors.length === 0 ? '✅ 播放全程无空白帧' : '❌ 存在空白帧或页面错误');
await browser.close();
if (xvfb) xvfb.kill();
process.exit(blanks.length === 0 && errors.length === 0 ? 0 : 1);
