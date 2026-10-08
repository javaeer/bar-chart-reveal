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
    throw new Error('未找到 ffmpeg，请先安装 ffmpeg');
  }
  if (out.includes('libx264')) return { name: 'libx264', args: ['-pix_fmt', 'yuv420p', '-crf', '18'], ext: 'mp4' };
  if (out.includes('libopenh264')) return { name: 'libopenh264', args: ['-b:v', '8000k', '-pix_fmt', 'yuv420p'], ext: 'mp4' };
  if (out.includes('libvpx-vp9')) return { name: 'libvpx-vp9', args: ['-b:v', '0', '-crf', '32', '-row-mt', '1', '-pix_fmt', 'yuv420p'], ext: 'webm' };
  throw new Error('无可用的视频编码器（需 libx264 / libopenh264 / libvpx-vp9）');
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
  throw new Error('未找到 chromium，请安装或设置 CHROMIUM_PATH 环境变量');
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
