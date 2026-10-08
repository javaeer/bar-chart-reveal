// 兼容旧入口（薄封装）：
//   node scripts/capture.mjs [frames]  ≡  node scripts/render.mjs --config samples/huining.json --all-views [--frames N]
//
// 新版出片统一走 render.mjs（配置驱动、支持任意数据集/主题/view）。
// 直接用法见 README。
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const args = ['scripts/render.mjs', '--config', 'samples/huining.json', '--all-views'];
// 兼容旧位置参数：node capture.mjs 120 → --frames 120
if (process.argv[2]) args.push('--frames', process.argv[2]);

const p = spawn('node', args, { cwd: root, stdio: 'inherit' });
p.on('exit', (code) => process.exit(code ?? 0));
