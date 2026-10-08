<template>
  <div ref="el" class="bar-race"></div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';
import * as echarts from 'echarts';
import 'echarts-gl';
import { getTheme, rampColorAt, rgbStr } from '../theme.js';

// —— 冻结契约（SPEC 第 4 节）——
// props: items, unit, fixed, theme, reveal, duration, captureT
// emits: active / done
// exposes: replay / computeFrame / render
const props = defineProps({
  items: { type: Array, required: true }, // [{name, value, highlight?}]
  unit: { type: String, default: '' },
  fixed: { type: Number, default: 0 },
  theme: { type: Object, default: null }, // getTheme() 归一化后的主题（内部会再兜底归一化）
  reveal: { type: Number, default: 0.72 },
  duration: { type: Number, default: 7200 }, // ms
  captureT: { type: Number, default: null }, // 非 null：确定性单帧（截图模式）
});
const emit = defineEmits(['active', 'done']);

const el = ref(null);
let chart = null;

// —— WebGL 上下文丢失保护 ——
// 无头 Chromium 逐帧截图或长时间预览时，GPU 资源可能耗尽导致 'webglcontextlost'。
// 若不拦截，默认行为会让上下文**不可逆**销毁 → 画面永久黑屏/空白。
// 这里：丢失时 preventDefault + 暂停循环；恢复时重建 ECharts 实例并重放待渲染帧。
const isContextLost = ref(false);
// 丢失 / 恢复发生次数（单调递增）。用于测试与运维观测：
// 即便上下文在极短时间内"丢失→恢复"，计数也能证明确实发生过，不受读取时机影响。
const contextLossCount = ref(0);
const contextRestoreCount = ref(0);
let pendingFrameT = null;       // 丢失期间最后一次请求渲染的进度，恢复后补渲
let contextLostHandler = null;
let contextRestoredHandler = null;
let contextWatchedCanvas = null; // 当前已挂载监听的 canvas（用于复用判断 / 解绑）

// ================= 时间轴几何（场景单位） =================
// 所有场景尺寸以 S（单个 X 步距的场景长度）为基准，相机距离与 box 同比例缩放，
// 因此一组调好的构图参数对任意 items 数量都成立。
const S = 8; // 每个 X 步距 = 8 场景单位
const BAR_W_BASE = 0.72; // 柱宽 / 步距（历史基准，用于推导宽深比）
const BAR_W_MAX = 0.70; // 世界柱宽上限（相对步距）
const BAR_D = 0.62; // 柱深 / 步距（基准）
const GLOW_K = 1.22; // 光晕层相对主体放大
const ZMAX = 1.18; // z 轴数据上限（含回弹余量）
const FOV = 50;
// 跟随时可视宽度内应容纳的"柱位"数（越少越贴脸、柱子越大）。约 = 同时看到的柱数。
const FOLLOW_NEAR = 5.0;
// 单根柱宽占"跟随期可视宽"的目标比例上限——决定柱子有多粗壮显眼。
const BAR_FRAME_W = 0.14;
// 最高柱占"跟随期可视高"的比例——决定构图是否居中、是否入画
// （0.78 留出顶部 headroom，避免最高柱顶端与标签被画面裁掉）
const CORE_FILL = 0.78;
// 相机俯仰角（度）：必须足够大才能"俯视"看到地面线与柱体立面，否则柱子会被
// 裁掉底部、看起来像悬空方块。32~38 为佳（配合下方注视点高度求解）。
const ALPHA_FOLLOW = 33;
const ALPHA_WIDE = 30;
// 最矮柱的 高/宽 下限（保证"最矮柱也是有体积的柱体"而非薄片）
const MIN_HW = 1.20;
// 全景：柱体外接框（含光晕）目标占画面宽（硬指标 ≥0.62，留余量）
const WIDE_VIS = 0.72;
// 高度系数下限：极值悬殊数据（如地行星质量 317.8 vs 0.055）下，线性 ratio 会让
// 多数柱体被压成"纸片"。设 FLOOR 后最小柱体也保留可见高度，但 ratio=1 时高度不变、
// local=0 时仍为 0（出现动画不受影响）、升序语义与颜色/标签所用的真实 ratio 不变。
const H_FLOOR = 0.30;
// 标签密度：n 较大时只给"名次靠前 + 高亮 + 活跃"贴标签，避免 28 项糊成一片
const LABEL_MAX_ALL = 12;

// —— 标签字体（单一真源）——
// 中文字体必须显式声明：无头环境下 font-family 若解析到不含中文字形的字体，
// canvas measureText 会把每个汉字当作超宽字符 → 标签"逐字换行/竖排"。
// 与 index.html 的 @font-face 保持同一字体栈。
const LABEL_FONT_FAMILY = '"Noto Sans CJK SC","PingFang SC","Microsoft YaHei",sans-serif';
const LABEL_FONT_SIZE = 16;
// 显式用于 canvas 测量的字体串（任务二要求：测量标签宽度前显式设置 ctx.font）
const LABEL_MEASURE_FONT = `bold ${LABEL_FONT_SIZE}px ${LABEL_FONT_FAMILY}`;

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
// 轻微回弹，让柱子"弹"出来（f(0)=0，峰值 ~1.1）
const easeOutBack = (t) => 1 + 2.7 * Math.pow(t - 1, 3) + 1.7 * Math.pow(t - 1, 2);

// ================= 标签测量守卫（任务二）=================
// 用一个独立的离屏 canvas 做文本测量，**每次测量前显式设置 ctx.font**——
// 这是修复"中文标签逐字换行"的关键：若沿用被污染/未初始化的 ctx.font，
// measureText 会退化成"每字≈一个字宽"的异常值，进而触发逐字换行。
let measureCtx = null;
function getMeasureCtx() {
  if (measureCtx) return measureCtx;
  if (typeof document === 'undefined') return null;
  const cv = document.createElement('canvas');
  measureCtx = cv.getContext('2d');
  return measureCtx;
}
// 返回文本像素宽度；ctx 不可用时返回 0（调用方走降级路径）
function measureTextWidth(text, font = LABEL_MEASURE_FONT) {
  const ctx = getMeasureCtx();
  if (!ctx) return 0;
  ctx.font = font; // 关键：显式设置，杜绝字号/字体串污染
  return ctx.measureText(String(text)).width;
}
// 字体是否已就绪（含中文字形）。未就绪时测量结果不可信，用于 QA / 调试断言。
function isLabelFontReady() {
  if (typeof document === 'undefined' || !document.fonts) return true;
  try { return document.fonts.check(LABEL_MEASURE_FONT, '中'); } catch { return true; }
}

// ================= 纯函数：t → 画面状态 =================
// 浏览器动画与逐帧截帧共用，保证逐帧一致；无副作用、不依赖外部可变状态。
function computeFrame(tRaw) {
  const th = getTheme(props.theme);
  const rows = Array.isArray(props.items) ? props.items : [];
  const n = rows.length;
  const reveal = clamp(Number(props.reveal) || 0.72, 0.05, 0.95);
  const t = clamp(Number(tRaw) || 0, 0, 1);

  // —— 自适应构图尺寸 ——
  // 设计目标（对应"看不到主体"）：无论 n 多少，"最矮柱"也必须是一个高挑柱体，
  // 即 最矮柱高 / 柱宽 ≥ MIN_HW。做法：先定 boxH（柱体世界高度），再由 boxH
  // 反推柱宽与相机距离——而不是先由"整排跨度"反推距离（那会让柱子越来越扁）。
  const span = Math.max(n - 1, 0); // 数据单位（含 0）
  const xPad = clamp(4.6 - n * 0.49, 0.65, 1.8);
  const xRange = span + xPad * 2;
  const boxW = S * xRange;
  const boxD = S * 1.7;

  // —— 视口纵横比 → 可视系数（水平可视宽 / 距离）——
  const elv = el.value;
  let aspect = elv && elv.clientWidth && elv.clientHeight ? elv.clientWidth / elv.clientHeight : 1.778;
  const aspectC = clamp(aspect, 1.15, 2.2);
  const visFactor = 2 * Math.tan((FOV / 2) * Math.PI / 180) * aspectC;

  // —— ① 跟随距离：由"希望同时看到 FOLLOW_NEAR 根柱"反推 ——
  //  可视宽 = followDist * visFactor ≈ FOLLOW_NEAR * 步距 → 决定柱子多大。
  const followDist = Math.max((FOLLOW_NEAR * S) / visFactor, S * 2.0);
  const visW = followDist * visFactor;                        // 跟随期可视宽（世界）
  const visH = 2 * followDist * Math.tan((FOV / 2) * Math.PI / 180); // 跟随期可视高

  // —— ② boxH：先定"最高柱世界高度"= 可视高 × CORE_FILL（保证整体入画、构图居中）——
  //  这是唯一由画面决定的量；柱宽则由"最矮柱非薄片"反推（见③）。
  const worldMaxH = visH * CORE_FILL;
  const boxH = worldMaxH * ZMAX;

  // —— ③ 柱宽：满足两约束，取较小者 ——
  //   (a) 世界柱宽 ≤ 最矮柱高 / MIN_HW   → 最矮柱不减薄片
  //   (b) 世界柱宽 ≤ 可视宽 × BAR_FRAME_W → 柱子不过粗
  //   (c) 世界柱宽 ≤ 步距 × BAR_W_MAX     → 相邻柱不粘连
  const minBarH = H_FLOOR * worldMaxH;
  const barWworld = Math.min(
    minBarH / MIN_HW,
    visW * BAR_FRAME_W,
    S * BAR_W_MAX,
  );
  const barDworld = barWworld * (BAR_D / BAR_W_BASE);

  // —— ④ 全景距离：整排跨度反推（结尾拉远，全部柱体入画）——
  const barsSpan = barWworld * GLOW_K + span * S; // 首尾柱外缘跨度（世界）
  const wideDist = Math.max(barsSpan / (WIDE_VIS * visFactor), followDist * 1.2);

  const barW = barWworld;
  const barD = barDworld;

  if (!n) {
    return { bars: [], camera: { alpha: 20, beta: 6, distance: wideDist, center: [0, S, 0], fov: FOV }, activeIdx: -1, revealed: 0, theme: th, boxW, boxD, boxH, barW, barD, xPad };
  }

  // —— 升序（低→高）弹出次序；稳定排序 ——
  const idxs = rows.map((_, i) => i);
  idxs.sort((a, b) => (Number(rows[a].value) || 0) - (Number(rows[b].value) || 0) || a - b);
  const maxV = Math.max(...rows.map((r) => Number(r.value) || 0)) || 1;

  const step = reveal / n;
  const growDur = Math.min(step * 1.8, reveal * 0.5);
  const activeIdx = clamp(Math.round((t / step) - 0.5), 0, n - 1); // 当前活跃柱（升序序号）

  // —— 逐柱生长（升序 k=0..n-1 依次弹出）——
  // 关键：柱子一旦"出现"就长到**自己的完整比例高度**（不是从 0 慢慢长到很矮），
  // 这样即使是最矮的第一根，也是一个"有体积的柱体"而非趴地的薄片。
  // 生长过程用 easeOutBack 从 0→hFrac 弹入（视觉上是"拔地而起"）。
  const bars = [];
  let revealed = 0;
  idxs.forEach((rowIdx, k) => {
    const appearT = (k + 1) * step;
    const startT = Math.max(appearT - growDur, 0);
    const local = easeOutBack(clamp((t - startT) / growDur, 0, 1));
    if (local > 0.001) revealed++;
    const v = Number(rows[rowIdx].value) || 0;
    const ratio = clamp(v / maxV, 0, 1);
    // 高度系数：H_FLOOR 保证最矮柱仍有可见高度；ratio=1 → 1（最高柱不变）
    const hFrac = H_FLOOR + (1 - H_FLOOR) * ratio;
    const z = Math.max(hFrac * local, 0.0001);
    const x = -span / 2 + k; // 世界坐标（场景单位），与相机中心同一坐标系
    const color = rows[rowIdx].highlight ? th.highlight : rampColorAt(th.ramp, ratio);
    bars.push({
      name: rows[rowIdx].name,
      worldX: x,
      value: [x, 0, z],
      real: v,
      ratio,
      hFrac,
      rank: n - k, // 升序第 k → 名次 n-k（1 为最大）
      shown: local > 0.001,
      grow: local,
      hl: rows[rowIdx].highlight === true,
      color,
    });
  });

  // —— 标签选取（常量逐项 label，规避函数式配置被忽略的问题）——
  // n ≤ 12 全部显示；n > 12 只给"名次靠前 + 高亮 + 当前活跃 + 已出现"的贴标签，避免糊字。
  // 额外：用显式字体的 measureText 估算标签宽度，过宽的名称进一步收窄，
  // 从源头避免"标签比柱子还宽 → 挤压换行"（任务二 label_overflow 防护）。
  const maxLabelW = Math.max(120, el.value ? el.value.clientWidth * 0.22 : 300);
  const labelTopN = n <= 18 ? 8 : Math.max(4, Math.round(16 / Math.sqrt(n)));
  bars.forEach((b, i) => {
    b.showLabel = b.shown && (
      n <= LABEL_MAX_ALL ||
      b.rank <= labelTopN ||
      b.hl ||
      i === activeIdx
    );
    if (b.showLabel) {
      const valueText = b.real.toFixed(Number(props.fixed) || 0) + (props.unit || '');
      // 测量前显式设置 ctx.font（见 measureTextWidth）；超宽则按比例收缩名称
      let nm = b.name;
      const wName = measureTextWidth(nm);
      if (wName > maxLabelW) {
        // 名称独占宽度超限时，逐字回缩并补省略号，保证「名称+数值」总宽可控
        const chars = Array.from(nm);
        let cut = chars.length;
        while (cut > 1 && measureTextWidth(chars.slice(0, cut).join('') + '…') > maxLabelW) cut--;
        nm = chars.slice(0, cut).join('') + '…';
      }
      b.labelName = nm;
      b.labelText = `${nm}\n${valueText}`;
    }
  });

  // —— 相机：跟随期 → 全景期（两端连续）——
  // 关键修复（对应"镜头未跟随 / 看不到主体"）：
  //   ① 水平中心 = 当前活跃柱世界坐标（真正跟着柱子走，不再扫空地）；
  //   ② 垂直中心 = 按"地面线落在画面下方固定比例"反解出的注视点高度（不裁底、不悬空）；
  //   ③ 俯仰 alpha ≥ 32：必须"俯视"才能看到柱体立面 + 底面，否则柱子被裁成方块。
  const activeBar = bars[activeIdx] || bars[bars.length - 1];
  // 水平：活跃柱附近已出现柱的均值；切换时按组内进度平滑插值
  let sumX = 0, cntX = 0;
  const halfWin = 2; // 取活跃柱前后各 2 根求均值，平滑跟随
  for (let k = Math.max(0, activeIdx - halfWin); k <= Math.min(bars.length - 1, activeIdx + halfWin); k++) {
    if (!bars[k].shown) continue;
    sumX += bars[k].worldX * S;
    cntX++;
  }
  const cxFollowRaw = cntX ? sumX / cntX : (activeBar ? activeBar.worldX * S : 0);
  const fracIn = clamp((t / step) - Math.floor(t / step), 0, 1);
  const prevBar = bars[Math.max(0, activeIdx - 1)];
  const curBar = bars[activeIdx];
  const cxFollow = (prevBar && curBar && prevBar !== curBar)
    ? lerp(prevBar.worldX * S, curBar.worldX * S, easeInOut(fracIn))
    : cxFollowRaw;

  // 垂直中心（注视点高度 cy）：让"地面线"稳定落在画面下方固定位置。
  // 【为什么用经验标定而不是解析反解】
  //   echarts-gl 的 viewControl 投影并非标准透视（其 center 为轨道目标点，实际
  //   垂直映射与 fov/box 共同作用），解析式与其偏差达 300px 量级，不可用。
  //   因此这里采用「离线标定 + 线性插值」：固定 distance 与 n 时，实测发现
  //   地面线屏幕高度 groundY ≈ A(alpha) + B(alpha)·cy 严格线性（R²≈1）。
  //   下表由真实渲染逐帧实测得到（alpha ∈ {30,34,38,42}，dist≈24.13，H=900）。
  //   标定脚本见仓库 scripts/calib-camera.md（可复现）。
  const worldH = boxH / ZMAX;
  const GROUND_FRAC = 0.885; // 地面线目标屏幕高度占比（0=顶 1=底）→ 底部留白 ~10%
  const _H = 900; // 标定分辨率（按比例换算到实际高分辨率即可，插值与分辨率无关）
  // alpha → [A, B]，A=截距(px)，B=每单位 cy 的像素斜率
  const CAM_CALIB = [
    { a: 30, A: 793.4, B: 22.0 },
    { a: 34, A: 773.5, B: 21.7 },
    { a: 38, A: 760.8, B: 18.4 },
    { a: 42, A: 745.0, B: 15.8 },
  ];
  const calibAt = (alphaDeg) => {
    const cs = CAM_CALIB;
    if (alphaDeg <= cs[0].a) return cs[0];
    if (alphaDeg >= cs[cs.length - 1].a) return cs[cs.length - 1];
    for (let i = 0; i < cs.length - 1; i++) {
      if (alphaDeg >= cs[i].a && alphaDeg <= cs[i + 1].a) {
        const u = (alphaDeg - cs[i].a) / (cs[i + 1].a - cs[i].a);
        return { A: lerp(cs[i].A, cs[i + 1].A, u), B: lerp(cs[i].B, cs[i + 1].B, u) };
      }
    }
    return cs[1];
  };
  // 反解 cy：A + B·cy = GROUND_FRAC·H  →  cy = (GROUND_FRAC·H − A)/B
  const cyForGround = (alphaDeg) => {
    const { A, B } = calibAt(alphaDeg);
    return clamp((GROUND_FRAC * _H - A) / B, 0.2, 12);
  };
  const cyFollow = cyForGround(ALPHA_FOLLOW);
  const cyWide = cyForGround(ALPHA_WIDE);

  // 俯仰：足够大才能看到地面线与柱体立面（避免裁底/悬空）。
  const alphaFollow = ALPHA_FOLLOW;

  let alpha, beta, distance, cx, cy;
  if (t <= reveal) {
    alpha = alphaFollow; beta = 4;
    distance = followDist;
    cx = cxFollow;
    cy = cyFollow;
  } else {
    const u = easeInOut(clamp((t - reveal) / (1 - reveal), 0, 1));
    alpha = lerp(alphaFollow, ALPHA_WIDE, u);
    beta = lerp(4, 8, u);
    distance = lerp(followDist, wideDist, u);
    cx = lerp(cxFollow, 0, u);      // 连续缩放到全景居中
    cy = lerp(cyFollow, cyWide, u);
  }

  // —— 调试标定钩子（仅 ?cam=alpha,cy,distance 时生效，生产路径不受影响）——
  // 用于离线标定"地面线在画面中的位置"，把柱子钉在地面上、避免裁底/悬空。
  if (typeof location !== 'undefined' && /[?&]cam=/.test(location.search)) {
    const m = location.search.match(/[?&]cam=([^&]+)/);
    if (m) {
      const [oa, oy, od] = m[1].split(',').map(Number);
      if (Number.isFinite(oa)) alpha = oa;
      if (Number.isFinite(oy)) cy = oy;
      if (Number.isFinite(od)) distance = od;
    }
  }

  return {
    bars,
    camera: { alpha, beta, distance, center: [cx, cy, 0], fov: FOV },
    activeIdx,
    revealed,
    theme: th,
    boxW, boxD, boxH, barW, barD, xPad,
  };
}

// ================= 渲染 =================
// 初始化 / 重建 ECharts 实例（WebGL 上下文恢复后需整体重建，无法原地复活 GL 资源）。
// 调用前会 dispose 旧实例，避免同一容器上堆积多个 GL 上下文。
//
// 注意：此处**不**立刻挂载上下文监听——echarts.init() 返回时其 <canvas> 尚未创建，
// canvas 是在第一次 setOption（GL 系列初始化）时才插入 DOM 的。
// 若此刻 attach 会因 getCanvas()===null 静默失败（曾导致监听完全没生效）。
// 真正的挂载放在 ensureContextWatchers()，在每次成功 setOption 后调用。
function initChart() {
  if (!el.value) return;
  if (chart) {
    try { chart.dispose(); } catch { /* 已失效实例，忽略 */ }
    chart = null;
  }
  chart = echarts.init(el.value, null, { renderer: 'canvas' });
  return chart;
}

// 确保上下文监听已挂载。canvas 可能尚未就绪（初次 init 后），故允许重试。
function ensureContextWatchers() {
  if (contextLostHandler && contextWatchedCanvas && contextWatchedCanvas.isConnected) return;
  attachContextWatchers();
}

function buildOption(f) {
  const th = f.theme;
  const axes = {
    axisLine: { lineStyle: { color: 'transparent' } },
    axisLabel: { show: false },
    axisTick: { show: false },
    splitLine: { show: false },
    splitArea: { show: false },
  };
  const span = Math.max(f.bars.length - 1, 0);

  const mkBar = (b) => {
    const it = {
      name: b.name,
      value: b.value,
      itemStyle: { color: rgbStr(b.color), opacity: 1 },
    };
    if (b.showLabel) {
      // 常量字符串 formatter：echarts-gl 只认常量配置（函数式会被静默忽略，
      // 且空文本会中断整个标签循环）——逐项开关 show 即可，安全且无重叠。
      it.label = { show: true, formatter: b.labelText };
    }
    return it;
  };

  const base = { type: 'bar3D', shading: 'lambert', bevelSize: 0.28, bevelSmoothness: 3 };

  // 光晕层：略大 + 半透明同色，轻微霓虹辉光
  const glow = {
    ...base,
    name: 'glow',
    barSize: [f.barW * GLOW_K, f.barD * GLOW_K],
    silent: true,
    label: { show: false },
    data: f.bars.filter((b) => b.shown).map((b) => ({
      value: b.value,
      itemStyle: { color: rgbStr(b.color), opacity: 0.2 },
    })),
  };

  // 主体层：系列级 label 常量样式（默认关闭，逐项开启）
  const main = {
    ...base,
    name: 'main',
    barSize: [f.barW, f.barD],
    data: f.bars.filter((b) => b.shown).map(mkBar),
    label: {
      show: false,
      position: 'top',
      distance: 0.6,
      textStyle: {
        color: th.labelColor,
        fontSize: LABEL_FONT_SIZE,
        fontWeight: 700,
        lineHeight: 20,
        // 与 index.html @font-face / LABEL_MEASURE_FONT 同一字体栈，保证测量与实际渲染一致
        fontFamily: LABEL_FONT_FAMILY,
        textBorderColor: th.labelBg,
        textBorderWidth: 3,
        backgroundColor: th.labelBg,
        borderColor: th.labelBorder,
        borderWidth: 1,
        borderRadius: 3,
        padding: [4, 8],
      },
    },
    emphasis: { itemStyle: { opacity: 1 } },
    itemStyle: { opacity: 1 },
  };

  return {
    animation: false,
    backgroundColor: 'transparent',
    grid3D: {
      boxWidth: f.boxW,
      boxDepth: f.boxD,
      boxHeight: f.boxH,
      viewControl: {
        alpha: f.camera.alpha,
        beta: f.camera.beta,
        distance: f.camera.distance,
        center: f.camera.center,
        fov: f.camera.fov,
        autoRotate: false,
        minDistance: S * 2,
        maxDistance: f.boxW * 4,
      },
      environment: th.environment,
      light: {
        main: { intensity: 1.25, shadow: false, alpha: 40, beta: 20 },
        ambient: { intensity: 0.55 },
      },
      splitLine: { show: true, lineStyle: { color: th.gridLine, width: 1 } },
      ...axes,
    },
    xAxis3D: { type: 'value', min: -span / 2 - f.xPad, max: span / 2 + f.xPad, ...axes },
    yAxis3D: { type: 'value', min: -0.85, max: 0.85, ...axes },
    zAxis3D: { type: 'value', min: 0, max: ZMAX, ...axes },
    series: [glow, main],
  };
}

function applyFrame(t) {
  const f = computeFrame(t);
  lastRenderedT = t; // 供上下文丢失时记录待恢复帧
  // 上下文已丢失时不写 GL 资源（setOption 仍会触发 GL 调用，可能抛错）；
  // 恢复流程会用 pendingFrameT 补渲这一帧。
  if (isContextLost.value) return f;
  if (!chart) return f;
  const opt = buildOption(f);
  chart.setOption(opt, { notMerge: true });
  // setOption 之后 ECharts 的 <canvas> 才真正存在 —— 此刻再确保监听已挂载。
  ensureContextWatchers();

  // 惰性调试钩子：仅当 URL 含 debug=1（用于端到端验证脚本精确读取帧状态），
  // 生产/出片路径完全不触发，不写入任何全局状态。
  if (typeof location !== 'undefined' && /[?&]debug=1\b/.test(location.search)) {
    window.__brFrame = {
      t,
      revealed: f.revealed,
      n: f.bars.length,
      activeIdx: f.activeIdx,
      camera: { alpha: f.camera.alpha, beta: f.camera.beta, distance: +f.camera.distance.toFixed(2), center: f.camera.center.map((v) => +v.toFixed(2)) },
      bars: f.bars.map((b) => ({ x: +(b.value[0]).toFixed(2), z: +(b.value[2]).toFixed(3), ratio: +b.ratio.toFixed(3), shown: b.shown, rank: b.rank })),
      // 标签诊断：字体是否就绪 + 每个标签的实测像素宽（供 label_overflow 检测）
      labelFontReady: isLabelFontReady(),
      labelFont: LABEL_MEASURE_FONT,
      labels: f.bars.filter((b) => b.showLabel).map((b) => ({
        name: b.labelName ?? b.name,
        w: +measureTextWidth(b.labelName ?? b.name).toFixed(1),
        text: b.labelText,
      })),
    };
  }

  const act = f.bars[f.activeIdx];
  emit('active', act ? {
    name: act.name,
    value: act.real,
    rank: act.rank,
    total: f.bars.length,
    revealed: f.revealed,
    progress: t,
    shown: act.shown,
  } : null);
  return f;
}

// ================= WebGL 上下文丢失 / 恢复监听 =================
// 监听目标是**真正承载 GL 的 <canvas>**（echarts 容器 div 上不冒泡该事件）。
// 注意 getCanvas() 依赖 chart 已存在，故仅在重建后调用。
function attachContextWatchers() {
  detachContextWatchers();
  const canvas = getCanvas();
  if (!canvas) return; // canvas 尚未创建：调用方（ensureContextWatchers）会在下次渲染后重试

  contextLostHandler = (event) => {
    // 关键：阻止默认行为，浏览器才会在资源可用后派发 webglcontextrestored。
    // 若省略，上下文将被永久销毁，后续无法恢复。
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    console.warn('[BarRace3D] WebGL context lost, pausing render loop');
    isContextLost.value = true;
    contextLossCount.value++;
    // 记录当前进度：实时播放取暂停时刻；截帧/录制模式取最近一次 renderAt/pendingFrameT
    if (pendingFrameT == null) pendingFrameT = lastRenderedT;
    // 停止动画帧循环，避免在无上下文状态下空转
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
  };

  contextRestoredHandler = () => {
    console.info('[BarRace3D] WebGL context restored, re-initializing chart');
    isContextLost.value = false;
    contextRestoreCount.value++;
    // 重新初始化 ECharts 实例与 GL 资源（旧上下文无法复用）
    initChart();
    // 补渲丢失前最后一帧，避免画面停留在空白
    const t = pendingFrameT;
    pendingFrameT = null;
    if (t != null) {
      renderAt(t);
      // 截帧模式需重新置就绪标记，避免出片管线误判为失败帧
      if (props.captureT != null) document.body.dataset.ready = '1';
    } else if (!recording) {
      play();
    }
  };

  canvas.addEventListener('webglcontextlost', contextLostHandler, false);
  canvas.addEventListener('webglcontextrestored', contextRestoredHandler, false);
  contextWatchedCanvas = canvas;
}

function detachContextWatchers() {
  const canvas = contextWatchedCanvas || getCanvas();
  if (canvas) {
    if (contextLostHandler) canvas.removeEventListener('webglcontextlost', contextLostHandler, false);
    if (contextRestoredHandler) canvas.removeEventListener('webglcontextrestored', contextRestoredHandler, false);
  }
  contextLostHandler = null;
  contextRestoredHandler = null;
  contextWatchedCanvas = null;
}

// —— 截帧模式：确定性单帧 ——
function renderCapture(p) {
  applyFrame(clamp(Number(p) || 0, 0, 1));
  document.body.dataset.ready = '1';
}

// —— 交互模式：rAF 时间轴（与截帧共用 computeFrame，逐帧一致）——
let rafId = null;
let t0 = 0;
let lastRenderedT = 0; // 最近一次渲染的时间轴进度（用于上下文恢复补渲）
// 录制标记：为 true 时暂停 rAF 自动推进，改由外部逐帧 renderAt(t) 驱动，
// 保证"导出内容"与"浏览器播放内容"逐帧一致（不受录制时机影响）。
let recording = false;
function loop(now) {
  if (props.captureT != null || recording || isContextLost.value) return;
  if (!t0) t0 = now;
  const p = Math.min((now - t0) / (Number(props.duration) || 7200), 1);
  applyFrame(p);
  if (p < 1) {
    rafId = requestAnimationFrame(loop);
  } else {
    rafId = null;
    emit('done'); // 播完停在全景
  }
}
function play() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
  t0 = 0;
  // 上下文丢失期间不启动循环，待恢复事件触发后再由 restored 回调续播
  if (props.captureT != null || recording || isContextLost.value) return;
  rafId = requestAnimationFrame(loop);
}

// —— 导出接口：确定性逐帧渲染 ——
// beginRecord()：暂停实时循环并回到 t=0；renderAt(t)：渲染指定进度；endRecord()：恢复。
function beginRecord() {
  recording = true;
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
  applyFrame(0);
}
function renderAt(t) {
  return applyFrame(clamp(Number(t) || 0, 0, 1));
}
function endRecord() {
  recording = false;
  play();
}

function render() {
  // 上下文丢失期间不重建实例：留给 webglcontextrestored 回调统一处理，
  // 否则会在 GL 不可用时反复 init 出坏实例。
  if (isContextLost.value) return;
  if (!chart) return;
  if (props.captureT != null) renderCapture(props.captureT);
  else play();
  // 兜底：若动画循环尚未跑到 setOption（极端时序），也尝试挂载一次监听。
  ensureContextWatchers();
}
function resize() { chart && !isContextLost.value && chart.resize(); }

onMounted(async () => {
  await nextTick();
  initChart();
  render();
  window.addEventListener('resize', resize);
});
onBeforeUnmount(() => {
  window.removeEventListener('resize', resize);
  detachContextWatchers();
  if (rafId) cancelAnimationFrame(rafId);
  chart && chart.dispose();
  chart = null;
});

watch(() => props.captureT, () => render());
watch(() => [props.items, props.theme, props.unit, props.fixed, props.reveal, props.duration], () => render(), { deep: true });

defineExpose({
  replay: play, render, computeFrame, beginRecord, renderAt, endRecord, getCanvas,
  // 上下文状态：以**函数**形式暴露，避免 defineExpose 对 ref 的 unwrap 让调用方
  // 拿到"某一时刻的快照值"而非实时状态。QA 据此断言丢失/恢复是否真的发生。
  isContextLost: () => isContextLost.value,
  getContextLossCount: () => contextLossCount.value,
  getContextRestoreCount: () => contextRestoreCount.value,
});

// 返回真正可录制的 <canvas>。
// 注意：chart.getDom() 返回的是 echarts 的**容器 div**（没有 captureStream），
// 必须再取其中的 canvas —— 曾因误用 getDom() 导致导出直接判定"不支持"而静默失败。
function getCanvas() {
  if (!chart) return null;
  const dom = chart.getDom();
  if (!dom) return null;
  if (dom.tagName === 'CANVAS') return dom;
  return dom.querySelector('canvas') || null;
}
</script>

<style scoped>
.bar-race { position: absolute; inset: 0; width: 100%; height: 100%; }
</style>
