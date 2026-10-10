// 出片管线核心（可复用）：自动 Xvfb、chromium 绝对路径探测、编码器选择、
// 逐帧全新浏览器进程、127.0.0.1 访问、等 document.body.dataset.ready。
//
// 设计依据（均来自 capture.mjs 的踩坑记录，完整保留）：
//  1) 每一帧启动「全新独立 chromium 进程」——持久浏览器连开多页会让 swiftshader 的
//     WebGL 上下文耗尽，最终导致整个会话挂掉。
//  2) 不用 chromium CLI 的 --screenshot / --virtual-time-budget：该 flag 下 GPU 进程不
//     起来、WebGL 不可用，截出 "Sorry, your browser doesn't support WebGL." 空白页。
//     改用 puppeteer 并等待页面就绪标记 body.dataset.ready==='1' 后再截。
//  3) 静态服务显式监听 0.0.0.0、页面用 127.0.0.1 访问——chromium 会把 "localhost"
//     优先解析成 IPv6 ::1，仅监听 IPv4 时会连不上，截出空白页。
//  4) 无显示器环境自动拉起 Xvfb；否则 ANGLE/WebGL 退化为极慢软件路径甚至超时。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ───────────────────────────────────────────────────────────
// 编码器选择：libx264 > libopenh264 > libvpx-vp9
// ───────────────────────────────────────────────────────────
export function pickEncoder() {
  let out = '';
  try {
    out = execFileSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8' });
  } catch {
    throw new Error(
      '未找到 ffmpeg。请安装 ffmpeg 并确保其在 PATH 中。\n' +
      '  安装指引：\n' +
      '    · Debian/Ubuntu : sudo apt-get update && sudo apt-get install -y ffmpeg\n' +
      '    · macOS (brew)  : brew install ffmpeg\n' +
      '    · Windows(winget): winget install Gyan.FFmpeg\n' +
      '  安装后可用 `ffmpeg -version` 验证；如为自定义路径，请把其所在目录加入 PATH。'
    );
  }
  if (out.includes('libx264')) return { name: 'libx264', args: ['-pix_fmt', 'yuv420p', '-crf', '18'], ext: 'mp4' };
  if (out.includes('libopenh264')) return { name: 'libopenh264', args: ['-b:v', '8000k', '-pix_fmt', 'yuv420p'], ext: 'mp4' };
  if (out.includes('libvpx-vp9')) return { name: 'libvpx-vp9', args: ['-b:v', '0', '-crf', '32', '-row-mt', '1', '-pix_fmt', 'yuv420p'], ext: 'webm' };
  throw new Error(
    'ffmpeg 已安装，但无可用的视频编码器（需 libx264 / libopenh264 / libvpx-vp9 之一）。\n' +
    '  常见原因：安装了精简版 ffmpeg（如 ffmpeg-static 或部分发行版的最小包）。\n' +
    '  解决：安装带 x264 的完整版 ffmpeg（Debian/Ubuntu: sudo apt-get install -y ffmpeg；\n' +
    '        macOS: brew install ffmpeg）。可用 `ffmpeg -encoders | grep -E "libx264|libvpx-vp9"` 自查。'
  );
}

// ───────────────────────────────────────────────────────────
// chromium 绝对路径探测：逐个候选探测 + CHROMIUM_PATH/CHROME_PATH
// puppeteer 不会在 PATH 里解析裸命令名，必须是绝对路径。
// ───────────────────────────────────────────────────────────
export function resolveChromium() {
  const env = process.env.CHROMIUM_PATH || process.env.CHROME_PATH;
  if (env && fs.existsSync(env)) return env;
  const cands = [
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable', '/snap/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  for (const c of cands) if (fs.existsSync(c)) return c;
  for (const name of ['chromium', 'chromium-browser', 'google-chrome']) {
    try { return execFileSync('which', [name], { encoding: 'utf8' }).trim(); } catch { /* next */ }
  }
  throw new Error(
    '未找到 chromium。请安装 Chromium 或设置 CHROMIUM_PATH 环境变量指向浏览器可执行文件。\n' +
    '  安装指引：\n' +
    '    · Debian/Ubuntu : sudo apt-get update && sudo apt-get install -y chromium chromium-common\n' +
    '                       （或 google-chrome-stable）\n' +
    '    · macOS         : brew install --cask chromium  （或安装 Google Chrome）\n' +
    '  自定义路径：export CHROMIUM_PATH=/path/to/chrome   （亦兼容 CHROME_PATH）\n' +
    '  出片另需 Xvfb（无显示器环境）：sudo apt-get install -y xvfb'
  );
}

// ───────────────────────────────────────────────────────────
// 显示可用性探测：不能只看 DISPLAY 是否存在——很多环境预设了实际不可用的
// DISPLAY（如 :0），此时 WebGL 上下文创建失败。故需实际探测。
// ───────────────────────────────────────────────────────────
export function displayUsable() {
  if (!process.env.DISPLAY) return false;
  try { execFileSync('xdpyinfo', ['-display', process.env.DISPLAY], { stdio: 'ignore' }); return true; }
  catch { return false; }
}

// 自动拉起 Xvfb（若需要）。返回 xvfb 子进程或 null。异步等待显示就绪。
// 注意：出片是 headless 渲染，必须保证 WebGL(swiftshader) 可用。继承来的 DISPLAY（如沙箱
// 预设的 :0）可能"xdpyinfo 可用"却无 GL，导致 WebGL 上下文创建失败、整片空白。故统一
// 拉起独立 Xvfb 作为确定性软件渲染环境；若无 Xvfb 则清除 DISPLAY，让 headless chromium
// 走 surfaceless swiftshader。
export async function setupDisplay(log = console.log, warn = console.warn) {
  let hasXvfb = true;
  try { execFileSync('which', ['Xvfb'], { stdio: 'ignore' }); } catch { hasXvfb = false; }
  if (hasXvfb) {
    const disp = ':' + (90 + Math.floor(Math.random() * 8));
    const xvfb = spawn('Xvfb', [disp, '-screen', '0', '1920x1080x24'], { stdio: 'ignore' });
    // ★ v2.8.0：unref + exit 钩子。此前 ChildProcess 句柄会挂住事件循环，
    //   导致 QA 脚本打完结果后进程不退出（qa:all 串联时表现为"卡死"）；
    //   unref 让 node 可正常退出，exit 钩子负责收割 Xvfb，不留孤儿进程。
    xvfb.unref();
    process.once('exit', () => { try { xvfb.kill('SIGTERM'); } catch { /* ignore */ } });
    process.env.DISPLAY = disp;
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 200));
      try { execFileSync('xdpyinfo', ['-display', disp], { stdio: 'ignore' }); break; } catch { /* retry */ }
    }
    log(`▶ 已启动 Xvfb 虚拟显示 (${disp})`);
    return xvfb;
  }
  if (process.env.DISPLAY) {
    warn('⚠ 未安装 Xvfb，清除 DISPLAY 以使用 surfaceless swiftshader 渲染');
    delete process.env.DISPLAY;
  }
  return null;
}

// ───────────────────────────────────────────────────────────
// 极简静态服务器（零依赖）：显式监听 0.0.0.0，返回 { server, base, close }
// ───────────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png',
  '.ico': 'image/x-icon',
};

export function startServer(distDir, log = console.log) {
  const server = http.createServer((req, res) => {
    let p = req.url.split('?')[0];
    if (p === '/') p = '/index.html';
    const fp = path.join(distDir, p);
    if (!fs.existsSync(fp)) { res.writeHead(404); res.end('404'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
    fs.createReadStream(fp).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(0, '0.0.0.0', () => {
      const PORT = server.address().port;
      const base = `http://127.0.0.1:${PORT}`;
      if (log) log(`▶ 静态服务已启动: ${base}（serving ${distDir}）`);
      resolve({
        server,
        base,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

// ───────────────────────────────────────────────────────────
// 单帧：全新 chromium 进程 + puppeteer 驱动（等就绪标记，避免 WebGL 空白页）
// 返回 true 表示截到有效帧（文件存在且体积 > 阈值）；失败返回 false。
// ───────────────────────────────────────────────────────────
export async function shootFrame({
  chromiumPath,
  base,
  url,
  outPath,
  width = 1920,
  height = 1080,
  timeout = 30000,
  minSize = 8000,
} = {}) {
  const browser = await puppeteer.launch({
    executablePath: chromiumPath,
    headless: 'new',
    args: [
      '--no-sandbox', '--disable-gpu-sandbox',
      '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--hide-scrollbars', '--force-device-scale-factor=1', '--window-size=1920,1080',
    ],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.goto(`${base}${url}`, { waitUntil: 'load' });
    await page.waitForFunction(() => document.body.dataset.ready === '1', { timeout });
    await page.screenshot({ path: outPath });
    return fs.existsSync(outPath) && fs.statSync(outPath).size > minSize;
  } finally {
    await browser.close();
  }
}

// ───────────────────────────────────────────────────────────
// 高级编排：出一套视频（单 view 或多 view 由调用方循环决定）。
//   opts: {
//     root, dist, frames, fps, out, poster,
//     urlForFrame(t, i, total) -> string,   // 相对路径，如 "/?t=0.5&view=area"
//     width, height, encoder, chromiumPath,
//     buildIfMissing = true,                  // dist 不存在时自动 vite build
//     log, warn,
//   }
// 返回 { ok, out, poster, encoder }；失败抛异常（由调用方处理）。
// ───────────────────────────────────────────────────────────
export async function renderFrames({
  root,
  dist,
  frames,
  fps,
  out,
  poster = null,
  urlForFrame,
  width = 1920,
  height = 1080,
  minSize = 8000,
  encoder = null,
  chromiumPath = null,
  buildIfMissing = true,
  log = console.log,
  warn = console.warn,
} = {}) {
  if (!fs.existsSync(path.join(dist, 'index.html'))) {
    if (!buildIfMissing) throw new Error('dist 不存在，且 buildIfMissing=false');
    log('▶ 未检测到 dist，先执行 vite build ...');
    execFileSync('npx', ['vite', 'build'], { cwd: root, stdio: 'inherit' });
  }

  const xvfb = await setupDisplay(log, warn);
  const enc = encoder || pickEncoder();
  const chrome = chromiumPath || resolveChromium();
  const srv = await startServer(dist, log);

  const frameDir = path.join(root, `.frames_${Date.now()}`);
  fs.rmSync(frameDir, { recursive: true, force: true });
  fs.mkdirSync(frameDir, { recursive: true });

  try {
    const total = Math.max(1, frames | 0);
    let ok = 0;
    let lastErr = null;
    log(`▶ 截帧 (frames=${total}, fps=${fps}) ...`);
    for (let i = 0; i <= total; i++) {
      const t = i / total;
      const outPath = path.join(frameDir, `frame_${String(i).padStart(4, '0')}.png`);
      let good = false;
      for (let attempt = 0; attempt < 3 && !good; attempt++) {
        try {
          good = await shootFrame({
            chromiumPath: chrome, base: srv.base,
            url: urlForFrame(t, i, total), outPath, width, height, minSize,
          });
        } catch (e) { good = false; lastErr = e; }
      }
      if (good) ok++; else warn(`  帧 ${i} 失败（跳过）${lastErr ? ' — ' + lastErr.message : ''}`);
    }

    if (ok < 2) {
      throw new Error('有效帧过少，出片中止');
    }

    // 补帧：若有个别帧最终仍失败，用最近的成功帧填充，避免 ffmpeg 因编号不连续而中断
    const present = [];
    for (let i = 0; i <= total; i++) {
      const p = path.join(frameDir, `frame_${String(i).padStart(4, '0')}.png`);
      if (fs.existsSync(p) && fs.statSync(p).size > minSize) present.push(i);
    }
    if (present.length < total + 1) {
      const lastGood = present.length ? present[present.length - 1] : -1;
      for (let i = 0; i <= total; i++) {
        const p = path.join(frameDir, `frame_${String(i).padStart(4, '0')}.png`);
        if (fs.existsSync(p) && fs.statSync(p).size > minSize) continue;
        // 优先用上一帧，否则用下一帧
        let src = null;
        for (let k = i - 1; k >= 0; k--) { const sp = path.join(frameDir, `frame_${String(k).padStart(4, '0')}.png`); if (fs.existsSync(sp) && fs.statSync(sp).size > minSize) { src = sp; break; } }
        if (!src) for (let k = i + 1; k <= total; k++) { const sp = path.join(frameDir, `frame_${String(k).padStart(4, '0')}.png`); if (fs.existsSync(sp) && fs.statSync(sp).size > minSize) { src = sp; break; } }
        if (src) { fs.copyFileSync(src, p); warn(`  帧 ${i} 缺失，已用相邻帧补齐`); ok++; }
      }
    }

    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    log(`▶ ffmpeg 合成（有效帧 ${ok}）...`);
    const args = ['-y', '-hide_banner', '-loglevel', 'error', '-framerate', String(fps),
      '-i', path.join(frameDir, 'frame_%04d.png'), '-c:v', enc.name, ...enc.args];
    if (enc.ext === 'mp4') args.push('-movflags', '+faststart');
    args.push(out);
    execFileSync('ffmpeg', args, { cwd: root, stdio: 'inherit' });

    if (poster) {
      // 取末帧（t=1 全景）作为海报，比首帧(空白)更具代表性
      const src = path.join(frameDir, `frame_${String(total).padStart(4, '0')}.png`);
      fs.mkdirSync(path.dirname(path.resolve(poster)), { recursive: true });
      if (fs.existsSync(src)) fs.copyFileSync(src, poster);
    }

    return { ok, out, poster, encoder: enc.name };
  } finally {
    await srv.close();
    if (xvfb) xvfb.kill();
    fs.rmSync(frameDir, { recursive: true, force: true });
  }
}

// ───────────────────────────────────────────────────────────
// 单进程多帧出片（v2.8.0）—— 逐帧新进程的提速替代方案
//
// 【为什么】
//   旧方案 renderFrames() 每帧 puppeteer.launch 一个全新 chromium 进程 +
//   加载整页 + 等 ready。实测（1920×1080 · swiftshader · 30 帧）：
//     逐帧新进程 107.2s（~3.6s/帧） → 单进程 39.2s（~1.24s/帧）
//   其中冷启动+就绪仅 0.85s/帧，**大头是每帧 1.24s 的截屏与软渲染重绘**。
//   因此本函数做了两件事，缺一不可：
//     ① 单进程 + 单页 + 循环 renderAt(t)   → 省掉 N 次冷启动
//     ② CDP Page.captureScreenshot({clip}) → 替代 page.screenshot()
//        （后者每次都做整页合成；clip 只截取景框区域，省掉页面级合成开销）
//
// 【复用已有接口】chart.beginRecord()/renderAt(t)/endRecord() 本就是为
//   "逐帧确定性录制"设计的（MetricBar 的浏览器内导出走同一套），此处直接复用，
//   保证出片内容与浏览器预览逐帧一致（computeFrame 纯函数单一事实源不变）。
//
// 【WebGL 上下文耗尽兜底】
//   旧方案靠"每帧新进程"天然隔离故障；单进程长跑需要显式对策：
//     · 每 rebuildEvery 帧主动重建图表实例（分段重建）
//     · 侦测 window.__barRace.getContextLossCount() 递增 → 立即重建
//     · 重建仍失败 → 由调用方回退到 renderFrames()（逐帧新进程）
// ───────────────────────────────────────────────────────────
export async function renderFramesSingleProcess({
  root,
  dist,
  frames,
  fps,
  out,
  poster = null,
  url,                       // 首帧 URL（含 ?t=0 与全部 cfg 参数），相对路径
  urlForFrame = null,        // 可选：仍按帧拼 URL（默认不用，靠 renderAt 驱动）
  width = 1920,
  height = 1080,
  clip = null,               // 可选 {x,y,width,height}；默认整视口
  rebuildEvery = 60,         // 分段重建间隔（帧）；<=0 表示不主动重建
  frameFormat = 'jpg',       // 'jpg'（默认，快 ~2-4×）| 'png'（像素级无损，慢）
  jpegQuality = 95,
  minSize = 8000,
  encoder = null,
  chromiumPath = null,
  buildIfMissing = true,
  log = console.log,
  warn = console.warn,
} = {}) {
  if (!fs.existsSync(path.join(dist, 'index.html'))) {
    if (!buildIfMissing) throw new Error('dist 不存在，且 buildIfMissing=false');
    log('▶ 未检测到 dist，先执行 vite build ...');
    execFileSync('npx', ['vite', 'build'], { cwd: root, stdio: 'inherit' });
  }

  const xvfb = await setupDisplay(log, warn);
  const enc = encoder || pickEncoder();
  const chrome = chromiumPath || resolveChromium();
  const srv = await startServer(dist, log);

  const frameDir = path.join(root, `.frames1p_${Date.now()}`);
  fs.rmSync(frameDir, { recursive: true, force: true });
  fs.mkdirSync(frameDir, { recursive: true });

  const total = Math.max(1, frames | 0);
  const ext = frameFormat === 'png' ? 'png' : 'jpg';
  const framePath = (i) => path.join(frameDir, `frame_${String(i).padStart(4, '0')}.${ext}`);
  const t0 = Date.now();
  let browser = null;
  let stats = { rebuilds: 0, contextLosses: 0, launchMs: 0, readyMs: 0, shootMs: 0 };

  try {
    browser = await puppeteer.launch({
      executablePath: chrome,
      headless: 'new',
      args: [
        '--no-sandbox', '--disable-gpu-sandbox',
        // ★ --use-gl=swiftshader（而非 --use-angle=swiftshader）：
        //   实测同环境下 CDP 截屏耗时 946ms → 193ms（~4.9×），整帧 1108ms → 393ms。
        //   ANGLE 转换层的读回路径在大画幅截屏上开销极高；legacy swiftshader 直读快得多。
        //   渲染内容一致（同为 swiftshader 软光栅），仅截屏管线不同。
        '--use-gl=swiftshader', '--enable-unsafe-swiftshader',
        '--hide-scrollbars', '--force-device-scale-factor=1',
        `--window-size=${width},${height}`,
      ],
    });
    stats.launchMs = Date.now() - t0;

    const page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    // 首帧 URL：?t=0 进入截帧（确定性）模式，组件挂载后停在自己的循环上，
    // 由 renderAt(t) 接管推进 —— 与浏览器内导出同一机制。
    const firstUrl = urlForFrame ? urlForFrame(0, 0, total) : url;
    await page.goto(`${srv.base}${firstUrl}`, { waitUntil: 'load' });
    await page.waitForFunction(() => document.body.dataset.ready === '1', { timeout: 30000 });
    stats.readyMs = Date.now() - t0;

    // 从 capture 模式进入"录制模式"：暂停实时循环，改由 renderAt(t) 显式驱动
    await page.evaluate(() => {
      const c = window.__barRace;
      if (c && typeof c.beginRecord === 'function') { c.beginRecord(); return true; }
      return false;
    });

    const cdp = await page.createCDPSession();
    const cdpClip = clip || { x: 0, y: 0, width, height };

    // 重建图表实例（分段重建 / 上下文丢失后恢复）。
    // resize 触发 echarts-gl 重建 GL 资源；随后重新 beginRecord 复位到录制态。
    async function rebuild() {
      await page.evaluate(() => {
        const c = window.__barRace;
        if (!c) return false;
        if (typeof c.endRecord === 'function') { try { c.endRecord(); } catch (e) {} }
        const el = document.querySelector('.bar-race');
        if (typeof c.resize === 'function') { try { c.resize(); } catch (e) {} }
        else if (el) window.dispatchEvent(new Event('resize'));
        if (typeof c.beginRecord === 'function') { c.beginRecord(); }
        return true;
      });
      stats.rebuilds++;
      // 重建后等 GL 稳定（渲染 1 帧不需要额外等待，下面循环里自带 rAF）
    }

    const lossCount = () => page.evaluate(() => {
      const c = window.__barRace;
      return (c && typeof c.getContextLossCount === 'function') ? c.getContextLossCount() : 0;
    });

    log(`▶ 单进程截帧 (frames=${total}, fps=${fps}, rebuildEvery=${rebuildEvery}) ...`);
    let ok = 0;
    let blank = 0;
    let lastLoss = await lossCount();

    for (let i = 0; i <= total; i++) {
      const t = i / total;
      // 分段重建：每 N 帧一次，或侦测到上下文丢失后立即重建
      const curLoss = await lossCount();
      if (curLoss > lastLoss) { lastLoss = curLoss; stats.contextLosses++; await rebuild(); }
      else if (rebuildEvery > 0 && i > 0 && i % rebuildEvery === 0) { await rebuild(); }

      // ★ 关键：renderAt(t) 只是 setOption，echarts-gl 的实际绘制发生在**下一个 rAF**。
      //   必须等 rAF 再截，否则抓到未绘制的空白 buffer（旧实现踩过此坑）。
      await page.evaluate((tt) => new Promise((r) => {
        const c = window.__barRace;
        if (c && typeof c.renderAt === 'function') c.renderAt(tt);
        requestAnimationFrame(() => requestAnimationFrame(r));
      }), t);

      const p = framePath(i);
      const shotStart = Date.now();
      try {
        // CDP 截屏 + clip：只截取景框区域，跳过 page.screenshot 的整页合成。
        // jpg 为默认（实测编码耗时约为 PNG 的 1/2-1/4，且经 x264 crf18 后视觉无差）；
        // png 供像素级比对场景（--frame-format png）。
        const shotOpts = { clip: { ...cdpClip, scale: 1 }, captureBeyondViewport: false };
        if (ext === 'jpg') { shotOpts.format = 'jpeg'; shotOpts.quality = jpegQuality; }
        else shotOpts.format = 'png';
        const res = await cdp.send('Page.captureScreenshot', shotOpts);
        fs.writeFileSync(p, Buffer.from(res.data, 'base64'));
        stats.shootMs += Date.now() - shotStart;
        if (fs.statSync(p).size > minSize) ok++; else blank++;
      } catch (e) {
        stats.shootMs += Date.now() - shotStart;
        blank++;
        warn(`  帧 ${i} 截屏失败（跳过）— ${e.message}`);
      }
    }

    if (ok < 2) throw new Error('有效帧过少，出片中止（单进程方案可能不适用于本环境）');

    // 补帧：与 renderFrames 相同策略（相邻成功帧填充），保证 ffmpeg 编号连续
    const present = [];
    for (let i = 0; i <= total; i++) if (fs.existsSync(framePath(i)) && fs.statSync(framePath(i)).size > minSize) present.push(i);
    if (present.length < total + 1) {
      for (let i = 0; i <= total; i++) {
        const p = framePath(i);
        if (fs.existsSync(p) && fs.statSync(p).size > minSize) continue;
        let src = null;
        for (let k = i - 1; k >= 0; k--) { const sp = framePath(k); if (fs.existsSync(sp) && fs.statSync(sp).size > minSize) { src = sp; break; } }
        if (!src) for (let k = i + 1; k <= total; k++) { const sp = framePath(k); if (fs.existsSync(sp) && fs.statSync(sp).size > minSize) { src = sp; break; } }
        if (src) { fs.copyFileSync(src, p); warn(`  帧 ${i} 缺失，已用相邻帧补齐`); ok++; }
      }
    }

    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    log(`▶ ffmpeg 合成（有效帧 ${ok}）...`);
    const args = ['-y', '-hide_banner', '-loglevel', 'error', '-framerate', String(fps),
      '-i', path.join(frameDir, `frame_%04d.${ext}`), '-c:v', enc.name, ...enc.args];
    if (enc.ext === 'mp4') args.push('-movflags', '+faststart');
    args.push(out);
    execFileSync('ffmpeg', args, { cwd: root, stdio: 'inherit' });

    if (poster) {
      // poster 契约保持 .png：jpg 帧序列时对末帧状态补拍一张 PNG（仅 1 帧成本可忽略）
      fs.mkdirSync(path.dirname(path.resolve(poster)), { recursive: true });
      if (ext === 'png') {
        if (fs.existsSync(framePath(total))) fs.copyFileSync(framePath(total), poster);
      } else {
        const shotOpts = { format: 'png', clip: { ...cdpClip, scale: 1 }, captureBeyondViewport: false };
        const res = await cdp.send('Page.captureScreenshot', shotOpts);
        fs.writeFileSync(poster, Buffer.from(res.data, 'base64'));
      }
    }

    const totalMs = Date.now() - t0;
    const timing = {
      totalMs,
      launchMs: stats.launchMs,
      readyMs: stats.readyMs - stats.launchMs,
      shootMs: stats.shootMs,
      perFrameMs: Math.round(stats.shootMs / (total + 1)),
      rebuilds: stats.rebuilds,
      contextLosses: stats.contextLosses,
      blank,
      frameFormat: ext,
    };
    log(`▶ 单进程出片完成：${(totalMs / 1000).toFixed(1)}s（${(timing.perFrameMs / 1000).toFixed(2)}s/帧 · ${ext} · 重建 ${stats.rebuilds} 次）`);

    return { ok, out, poster, encoder: enc.name, timing };
  } finally {
    if (browser) { try { await browser.close(); } catch (e) { /* 已关闭 */ } }
    await srv.close();
    if (xvfb) xvfb.kill();
    fs.rmSync(frameDir, { recursive: true, force: true });
  }
}
