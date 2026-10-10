// 性能回归：单进程多帧出片引擎（v2.8.0）
//
// 断言：
//   1. 单进程引擎能出片且全部帧非空白（内容正确性）
//   2. 产物 mp4 存在、规格正确（由 renderFramesSingleProcess 内部 ffprobe 前的 ffmpeg 保证）
//   3. 每帧耗时低于粗回归上限（防止意外退回"逐帧新进程"或读回路径劣化）
//   4. （可选 --compare）与逐帧方案 A/B，输出对比表 —— 供人查，不作硬断言
//      （CI 机器算力差异大，绝对耗时只做宽松上限；相对倍数打印出来供参考）
//
// 用法：npm run qa:perf            # 单进程 12 帧快速回归
//       node scripts/qa/perf.mjs --compare   # 额外跑逐帧方案做 A/B（慢）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderFrames, renderFramesSingleProcess, pickEncoder, resolveChromium } from '../lib/capture-core.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');
const FRAMES = Number(process.env.PERF_FRAMES || 12);
const FPS = 30;
const PER_FRAME_LIMIT_MS = 2500;   // 粗上限：本机实测 ~0.21s/帧；劣化 10× 仍能拦截
const OUT_DIR = path.join(process.env.QA_ART || fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'qa-perf-')));

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; console.log(`❌ ${name}${detail ? ' — ' + detail : ''}`); }
};

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  pickEncoder(); resolveChromium();
  const url = '/?t=0&view=population';
  const common = {
    root, dist: path.join(root, 'dist'), fps: FPS, url,
    width: 1280, height: 720,   // perf 回归用小画幅（更快），不影响"相对劣化"判定
  };

  // —— 1) 单进程引擎：正确性 + 速度 ——
  const t0 = Date.now();
  const single = await renderFramesSingleProcess({
    ...common, frames: FRAMES,
    out: path.join(OUT_DIR, 'perf-single.mp4'),
    poster: path.join(OUT_DIR, 'perf-single.png'),
  });
  const singleMs = Date.now() - t0;
  ok('单进程：全部帧非空白', single.ok === FRAMES + 1 && single.timing.blank === 0,
    `有效帧 ${single.ok}/${FRAMES + 1} · 空白 ${single.timing.blank}`);
  ok('单进程：mp4 已生成', fs.existsSync(single.out) && fs.statSync(single.out).size > 10000,
    `${(fs.statSync(single.out).size / 1024).toFixed(0)}KB`);
  ok(`单进程：每帧 ≤ ${PER_FRAME_LIMIT_MS / 1000}s（防引擎劣化）`,
    single.timing.perFrameMs <= PER_FRAME_LIMIT_MS,
    `${(single.timing.perFrameMs / 1000).toFixed(2)}s/帧（本机基线 ~0.2s）`);
  ok('单进程：无上下文丢失累积', single.timing.contextLosses === 0,
    `重建 ${single.timing.rebuilds} 次 · 丢失 ${single.timing.contextLosses} 次`);

  // —— 2) 可选 A/B：逐帧新进程方案 ——
  if (process.argv.includes('--compare')) {
    const t1 = Date.now();
    const per = await renderFrames({
      ...common, frames: FRAMES,
      out: path.join(OUT_DIR, 'perf-perframe.mp4'),
      poster: path.join(OUT_DIR, 'perf-perframe.png'),
    });
    const perMs = Date.now() - t1;
    const speedup = (perMs / singleMs).toFixed(2);
    console.log('\n—— A/B 对比 ——');
    console.log(`  单进程:   ${(singleMs / 1000).toFixed(1)}s（${(single.timing.perFrameMs / 1000).toFixed(2)}s/帧 · ${single.timing.frameFormat}）`);
    console.log(`  逐帧新进程: ${(perMs / 1000).toFixed(1)}s`);
    console.log(`  提速: ${speedup}×`);
    ok('A/B：单进程快于逐帧方案', singleMs < perMs, `${speedup}×`);
    ok('A/B：逐帧方案产物同样有效', fs.existsSync(per.out) && fs.statSync(per.out).size > 10000);
  }

  console.log(`\n==== 性能回归：${pass}/${pass + fail} 通过 ====`);
  if (fail) process.exitCode = 1;
})().catch((e) => { console.error('❌ perf 回归异常:', e.message); process.exit(1); });
