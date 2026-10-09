// 生成预览图（工具脚本，非回归套件成员）：v2 模板数据集全景 + 形状对比 + 画幅对比 + UI 截图
// 用法：node scripts/qa/mk-preview-v2.mjs [输出目录]
// 依赖：已构建的 dist/（先跑 npm run build）+ 系统 chromium + Xvfb。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { encodeConfig, pixelSizeFor, ASPECT_KEYS } from '../../src/core/config.js';
import { pickEncoder, resolveChromium, setupDisplay, startServer, shootFrame } from '../lib/capture-core.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');
const OUT = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(root, 'out', 'preview');
fs.mkdirSync(OUT, { recursive: true });

const v2 = JSON.parse(fs.readFileSync(path.join(root, 'samples/huining-v2.json'), 'utf8'));
const b64 = encodeConfig(v2);

(async () => {
  resolveChromium(); pickEncoder();
  const xvfb = await setupDisplay();
  const srv = await startServer(path.join(root, 'dist'));
  const shoot = async (name, t, extra, size) => {
    const p = path.join(OUT, name);
    await shootFrame({
      chromiumPath: resolveChromium(), base: srv.base,
      url: `/?t=${t}&cfg=${b64}${extra}`, outPath: p,
      ...(size || {}),
    });
    console.log('  ✓', name);
  };
  try {
    // —— ① 内置数据集全景 + 形状对比（16:9，默认）——
    await shoot('v2-人口-全景.png', 1, '&view=population');
    await shoot('v2-面积-全景.png', 1, '&view=area');
    await shoot('v2-红色遗址数-全景.png', 1, '&view=redSiteCount');
    await shoot('v2-球体.png', 1, '&view=area&shape=sphere');
    await shoot('v2-圆柱.png', 1, '&view=area&shape=cylinder');
    await shoot('v2-立方体.png', 1, '&view=area&shape=cube');

    // —— ② 画幅对比（v2.6）：同一视图 × 四种比例，各按长边 1920 导出 ——
    for (const key of ASPECT_KEYS) {
      const { width, height } = pixelSizeFor(key, 1920);
      await shoot(
        `v2.6-画幅-${key.replace(':', '-')}-${width}x${height}.png`,
        1,
        `&view=population&aspect=${encodeURIComponent(key)}`,
        { width, height },
      );
    }

    // —— ③ UI 截图（v2.6）：带控件的编辑态，展示流式 dock / 取景框 / 信息面板 ——
    const browser = await puppeteer.launch({
      executablePath: resolveChromium(),
      headless: 'new',
      args: [
        '--no-sandbox', '--disable-gpu-sandbox',
        '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
        '--hide-scrollbars', '--force-device-scale-factor=1', '--window-size=1600,900',
      ],
    });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 });
      await page.goto(`${srv.base}/?view=population`, { waitUntil: 'load' });
      await new Promise((r) => setTimeout(r, 2600));
      await page.screenshot({ path: path.join(OUT, 'v2.6-界面-16-9.png') });
      console.log('  ✓', 'v2.6-界面-16-9.png');

      // 切到 9:16 后再截一张（展示取景框自适应）
      await page.goto(`${srv.base}/?view=population&aspect=9:16`, { waitUntil: 'load' });
      await new Promise((r) => setTimeout(r, 2600));
      await page.screenshot({ path: path.join(OUT, 'v2.6-界面-9-16.png') });
      console.log('  ✓', 'v2.6-界面-9-16.png');

      // 信息面板（标题/来源/备注）
      await page.goto(`${srv.base}/?view=population`, { waitUntil: 'load' });
      await new Promise((r) => setTimeout(r, 2000));
      const btns = await page.$$('.data-ui button');
      for (const b of btns) {
        const t = await b.evaluate((el) => el.textContent.trim());
        if (t.includes('信息')) { await b.click(); break; }
      }
      await new Promise((r) => setTimeout(r, 700));
      await page.screenshot({ path: path.join(OUT, 'v2.6-信息面板.png') });
      console.log('  ✓', 'v2.6-信息面板.png');
    } finally {
      await browser.close();
    }
  } finally {
    await srv.close();
    if (xvfb) xvfb.kill();
  }
})();
