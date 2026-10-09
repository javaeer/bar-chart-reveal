// ============================================================
// 视频输出核心（纯逻辑：仅依赖全局对象，浏览器 / Node 通用）
// ------------------------------------------------------------
// 承载两类「视频规格」计算：
//   ① 画幅比例（aspect）：预览取景框与导出画面**共用同一份定义**，
//      确保「预览所见 = 导出所得」（单一事实源）。
//   ② 播放时长推导：由「每根柱子弹出间隔」+ 柱体数量 + 揭示占比，
//      自动算出总时长，避免手工调 durationMs。
//
// 设计原则：本模块不 import 任何 DOM / Node 模块，可被浏览器与 Node 直接复用，
// 也便于单测（与 config.js / adapt.js 保持同样的「纯逻辑」约束）。
// ============================================================

// ───────────────────────────────────────────────────────────
// 1. 画幅比例表
//    ratio = 宽 / 高（数值，便于直接参与像素换算）
//    longEdge 用于导出像素：长边固定，短边按比例推导（保证 4:3 与 16:9 边长一致）
// ───────────────────────────────────────────────────────────
export const ASPECTS = {
  '16:9': { key: '16:9', label: '横屏 16:9', ratio: 16 / 9 },
  '9:16': { key: '9:16', label: '竖屏 9:16', ratio: 9 / 16 },
  '1:1': { key: '1:1', label: '方形 1:1', ratio: 1 },
  '4:3': { key: '4:3', label: '经典 4:3', ratio: 4 / 3 },
};

// 展示顺序（UI 下拉/按钮按此顺序）
export const ASPECT_KEYS = ['16:9', '9:16', '1:1', '4:3'];

export const DEFAULT_ASPECT = '16:9';

// 把任意输入规范化为合法 aspect key；非法返回 null（由调用方决定回退与告警）
export function normalizeAspect(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  // 宽容：接受「1920x1080」这类像素写法映射到最接近的标准比例
  if (ASPECTS[s]) return s;
  const m = /^(\d+)\s*[:xX×]\s*(\d+)$/.exec(s);
  if (m) {
    const w = Number(m[1]);
    const h = Number(m[2]);
    if (w > 0 && h > 0) {
      const r = w / h;
      let best = null;
      let bestD = Infinity;
      ASPECT_KEYS.forEach((k) => {
        const d = Math.abs(ASPECTS[k].ratio - r);
        if (d < bestD) {
          bestD = d;
          best = k;
        }
      });
      // 允许 8% 相对误差，避免把 5:4 之类硬塞进 4:3
      if (best && bestD / r <= 0.08) return best;
    }
  }
  return null;
}

// 取得比例数值（非法输入回退默认 16:9 的数值）
export function ratioOf(aspect) {
  const k = normalizeAspect(aspect) || DEFAULT_ASPECT;
  return ASPECTS[k].ratio;
}

/**
 * 按「长边像素」推导导出分辨率。
 *
 * 长边固定 → 四种比例下长边像素一致（例如长边 1920：16:9 → 1920×1080，
 * 9:16 → 1080×1920，1:1 → 1920×1920，4:3 → 1920×1440）。
 * 结果均为偶数（编码器普遍要求 4:2:0 色度采样下的偶数宽高）。
 *
 * @param {string} aspect     比例 key（'16:9' / '9:16' / '1:1' / '4:3'）
 * @param {number} longEdge   长边像素（默认 1920）
 * @returns {{ width:number, height:number, aspect:string }}
 */
export function pixelSizeFor(aspect, longEdge = 1920) {
  const k = normalizeAspect(aspect) || DEFAULT_ASPECT;
  const r = ASPECTS[k].ratio;
  const L = Number.isFinite(Number(longEdge)) && Number(longEdge) > 0
    ? Math.round(Number(longEdge))
    : 1920;
  const even = (n) => {
    const v = Math.max(2, Math.round(n));
    return v % 2 === 0 ? v : v + 1;
  };
  let width;
  let height;
  if (r >= 1) {
    // 横屏 / 方形：宽为长边
    width = even(L);
    height = even(L / r);
  } else {
    // 竖屏：高为长边
    height = even(L);
    width = even(L * r);
  }
  return { width, height, aspect: k };
}

// ───────────────────────────────────────────────────────────
// 2. 播放时长推导
// ───────────────────────────────────────────────────────────
export const DEFAULT_BAR_INTERVAL_MS = 2000; // 每根柱子弹出间隔：2s
export const INTERVAL_MIN = 200;             // 下限 0.2s（再快会糊）
export const INTERVAL_MAX = 20000;           // 上限 20s（再慢没人等）

/**
 * 由「每根柱子弹出间隔」推导总播放时长。
 *
 * 语义：揭示阶段（柱子依次弹出）总耗时 = 柱体数量 × 每根间隔；
 * 揭示阶段占总时长的 revealRatio，故总时长 = 揭示耗时 / revealRatio，
 * 剩余 (1-revealRatio) 为末尾「数据微调/落位」宽放阶段。
 *
 * @param {number} n            柱体数量（<=0 时回退 1，避免除零）
 * @param {number} intervalMs   每根柱子弹出间隔（ms）
 * @param {number} revealRatio  揭示阶段占比（0..1）
 * @returns {number} 总时长 ms（正整数，且不小于揭示耗时）
 */
export function deriveDuration(n, intervalMs = DEFAULT_BAR_INTERVAL_MS, revealRatio = 0.72) {
  const count = Number.isFinite(Number(n)) && Number(n) > 0 ? Math.floor(Number(n)) : 1;
  let iv = Number(intervalMs);
  if (!Number.isFinite(iv) || iv <= 0) iv = DEFAULT_BAR_INTERVAL_MS;
  iv = Math.min(INTERVAL_MAX, Math.max(INTERVAL_MIN, iv));
  let rr = Number(revealRatio);
  if (!Number.isFinite(rr)) rr = 0.72;
  rr = Math.min(0.98, Math.max(0.05, rr));
  const revealTotal = count * iv;
  return Math.round(revealTotal / rr);
}

/**
 * 由总时长反推「每根柱子间隔」（互逆换算，供 UI 双向联动）。
 * 与 deriveDuration 保持一致：interval = duration × revealRatio / n。
 */
export function intervalFromDuration(durationMs, n, revealRatio = 0.72) {
  const d = Number(durationMs);
  const count = Number.isFinite(Number(n)) && Number(n) > 0 ? Math.floor(Number(n)) : 1;
  let rr = Number(revealRatio);
  if (!Number.isFinite(rr)) rr = 0.72;
  rr = Math.min(0.98, Math.max(0.05, rr));
  if (!Number.isFinite(d) || d <= 0) return DEFAULT_BAR_INTERVAL_MS;
  const iv = (d * rr) / count;
  return Math.round(Math.min(INTERVAL_MAX, Math.max(INTERVAL_MIN, iv)));
}

export default { ASPECTS, ASPECT_KEYS, DEFAULT_ASPECT, normalizeAspect, ratioOf, pixelSizeFor, deriveDuration, intervalFromDuration };
