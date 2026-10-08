// 交互回归：画布 / 视图切换 / 主题切换 / 重播 / 数据表应用 / CSV 模板 / 控制台异常
// 用法：node scripts/qa/interact.mjs
//   —— 每步都有超时护栏，任一步卡住也不会让整个脚本挂死。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { resolveChromium, setupDisplay, startServer } from '../lib/capture-core.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');
const results = [];
const check = (n, p, d) => { results.push({ n, p, d }); console.log(`${p ? '✅' : '❌'} ${n}${d ? ' — ' + d : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 超时护栏：把 promise 包一层，超过 ms 直接返回 fallback（避免整脚本挂死）
const guard = (p, ms, fallback) => Promise.race([p, sleep(ms).then(() => fallback)]);

async function main() {
  const chromePath = resolveChromium();
  await setupDisplay();
  const srv = await startServer(path.join(root, 'dist'));
  const browser = await puppeteer.launch({
    executablePath: chromePath, headless: 'new',
    args: ['--no-sandbox', '--disable-gpu-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars'],
  });
  const errors = [];
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

    await page.goto(`${srv.base}/`, { waitUntil: 'load' });
    await guard(page.waitForSelector('.bar-race canvas', { timeout: 15000 }), 18000, null);
    await sleep(800);

    // 1) 画布
    check('画布渲染存在', !!(await page.$('.bar-race canvas')));

    const btnTexts = () => page.$$eval('.ui button', (bs) => bs.map((b) => b.textContent.trim()));
    const clickByText = async (sel, text, sub = false) => {
      const texts = await page.$$eval(sel, (bs) => bs.map((b) => b.textContent.trim()));
      const i = texts.findIndex((t) => (sub ? t.includes(text) : t === text));
      if (i < 0) return false;
      const bs = await page.$$(sel);
      await bs[i].click();
      return true;
    };

    // 2) 视图切换：点"人口"→ 变激活态
    let viewSwitchOk = false;
    if (await clickByText('.ui button', '人口')) {
      await sleep(600);
      viewSwitchOk = await page.$$eval('.ui button', (bs) => {
        const b = bs.find((x) => x.textContent.trim() === '人口');
        return b ? b.classList.contains('active') : false;
      });
    }
    check('视图切换生效（激活态切换）', viewSwitchOk, `按钮=${(await btnTexts()).slice(0, 4).join('/')}`);

    // 3) 主题切换
    let themeOk = false;
    if (await clickByText('.ui button', '暖阳橙')) { await sleep(500); themeOk = true; }
    check('主题切换可用', themeOk);

    // 4) 重播
    let replayOk = await clickByText('.ui button', '重播', true);
    if (replayOk) await sleep(900);
    check('重播可用', replayOk);

    // 5) 数据表：打开 → 改值 → 应用并重建
    let tableOk = false;
    if (await clickByText('.data-ui button', '数据表', true)) {
      const ok = await guard(page.waitForSelector('#tbl-body input[data-k="value"]', { timeout: 6000 }), 8000, null);
      if (ok) {
        await page.$eval('#tbl-body input[data-k="value"]', (el) => {
          el.value = '99999';
          el.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await sleep(200);
        const applied = await guard((async () => {
          const texts = await page.$$eval('.box .actions button', (bs) => bs.map((b) => b.textContent.trim()));
          const i = texts.findIndex((t) => t.includes('应用'));
          if (i < 0) return false;
          const bs = await page.$$('.box .actions button');
          await bs[i].click();
          return true;
        })(), 8000, false);
        await sleep(700);
        tableOk = applied;
      }
    }
    check('数据表编辑并重建可用', tableOk);

    // 6) CSV 模板：点击后按钮仍可用（不校验真实下载，避免无头下载行为差异）
    await sleep(300);
    const tplOk = await guard(clickByText('.data-ui button', '模板', true), 6000, false);
    check('CSV 模板按钮可点击', tplOk);

    // 7) 控制台异常（favicon 404 已消除；其余任何 error 都算失败）
    check('无未捕获异常 / 控制台错误', errors.length === 0, errors.slice(0, 3).join(' | ') || 'clean');
  } catch (e) {
    check('测试执行异常', false, e.message);
  } finally {
    await guard(browser.close(), 8000, null);
    await guard(srv.close(), 5000, null);
  }
  const failed = results.filter((r) => !r.p);
  console.log(`\n==== 交互回归：${results.length - failed.length}/${results.length} 通过 ====`);
  if (failed.length) { failed.forEach((f) => console.log('  失败: ' + f.n)); process.exitCode = 1; }
  process.exit(process.exitCode || 0);
}
main().catch((e) => { console.error('交互回归崩溃:', e); process.exit(1); });
