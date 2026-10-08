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
// —— FOV 16（远焦"长焦镜头"）——
// 【修复：跟随期柱子巨大、倾斜、裁底】旧值 FOV=50（广角）下，画面边缘柱体的
// 透视倾斜可达 ~40°（hFOV 半角），且"同时 5 根柱同框"的近距构图让柱体占满
// 全屏、上下双向裁切、地面线完全不可见。长焦（16°）把边缘透视压到 ~14°，
// 柱体近乎平行排列，观感接近规范的数据可视化而非"贴脸特写"。
// 相机距离按 1/tan(FOV/2) 等比放大（FOLLOW_NEAR 同框数同步上调），场景单位
// 几何不变，因此构图逻辑与任意 n 兼容。
const FOV = 16;
// 跟随时可视宽度内应容纳的"柱位"数（参考值，用于推导固定距离）。
// 跟随期相机距离固定为 FOLLOW_DIST（见下），水平同框柱数随视口 aspect
// 自适应：16:9 ≈ 5.4 根、≈2:1 ≈ 6 根、竖屏更少——构图语义稳定。
const FOLLOW_NEAR = 6.0;
// —— 跟随期相机距离（场景单位，固定值）——
// 【为什么固定而不是按 aspect 反推】注视点高度 cy=-1.2 的"地面线 ~85% 屏高"
// 是在固定 distance 下实测标定的（echarts-gl 的垂直投影随 distance 变化，
// 见 scripts/qa/diag-calib2.mjs）；若 distance 随 aspect 反推（旧行为），
// 16:9 与 2:1 视口下地面线位置漂移达 13% 屏高，柱体会重新出画。
// 固定后垂直构图对所有 aspect 一致。87 ≈ FOLLOW_NEAR×S/visFactor(aspect≈1.96)。
const FOLLOW_DIST = 87;
// 单根柱宽占"跟随期可视宽"的目标比例上限——决定柱子有多粗壮显眼。
const BAR_FRAME_W = 0.14;
// 最高柱占"跟随期可视高"的比例——留出上下余量给标签与地面线（防裁顶/裁底）。
const CORE_FILL = 0.66;
// 相机俯仰角（度）：小俯角近"平视"，柱体立面完整、竖直棱线竖直；
// 全景期略加大俯角以带回 3D 顶面进深感。
const ALPHA_FOLLOW = 18;
const ALPHA_WIDE = 22;
// 最矮柱的 高/宽 下限（保证"最矮柱也是有体积的柱体"而非薄片）
const MIN_HW = 1.20;
// 全景：柱体外接框（含光晕）目标占画面宽（硬指标 ≥0.62，留余量）
const WIDE_VIS = 0.72;
// 高度系数下限：极值悬殊数据（如地行星质量 317.8 vs 0.055）下，线性 ratio 会让
// 多数柱体被压成"纸片"。设 FLOOR 后最小柱体也保留可见高度，但 ratio=1 时高度不变、
// local=0 时仍为 0（出现动画不受影响）、升序语义与颜色/标签所用的真实 ratio 不变。
const H_FLOOR = 0.30;
// 标签密度：n ≤ LABEL_MAX_ALL 时全部贴标签（14 乡镇等常规数据集应"每根柱子都有
// 名字"——此前 12 的阈值导致 14 项数据只有 rank≤8 的柱子带标签，被用户报为缺陷）；
// n 更大时按"全景柱距像素 vs 实测标签宽"自适应步距稀疏铺满（见 computeFrame 标签选取段），
// 避免"28 项数据全景期只有 4 个标签"（v2.3.0 的 labelTopN 平方根公式下限 4，被用户报为缺陷）。
const LABEL_MAX_ALL = 16;
// 跟随期标签窗口半径（柱数）：活跃柱 ±N 根全部贴标签。跟随期同框约 5.4 根
// （visW≈50 世界单位 / S=8），±4 已覆盖全部可见柱并留 1 根缓冲；跟随期柱距
// 像素 ≈ 356px ≫ 标签宽 ~120px，窗口全显不会重叠。仅跟随期(t ≤ reveal)生效。
const FOLLOW_LABEL_WIN = 4;

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

  // —— ① 跟随距离：固定值（见 FOLLOW_DIST 注释）——
  const followDist = Math.max(FOLLOW_DIST, S * 2.0);
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
  // 【三层策略】（v2.3.1 重构：修复"28 项数据全景期只有 4 个标签"——用户录屏报缺陷）
  //   a) n ≤ LABEL_MAX_ALL：全部贴标签（海拔 7 项 / 面积 14 项 → 每根柱子都有名字）；
  //   b) n 更大时按"全景柱距像素 vs 实测标签宽"自适应步距 stride 稀疏铺满：
  //      标签比柱距宽就隔 stride 根显示一个，队首(i=0)必显、队尾(i=n-1)按半步距
  //      补位必显（第 1 名在最右侧，观众最关心）。1920 宽 / 28 项 / 最长名 7 字：
  //      pitch≈51px、标签宽≈118px → stride=3 → 约 10 个标签、间距 153px，不重叠；
  //      （旧公式 labelTopN=max(4,round(16/√n)) 在 n=28 时只给 4 个标签，24/28 秃柱）
  //   c) 跟随期(t ≤ reveal)活跃柱 ±FOLLOW_LABEL_WIN 全部显示——同框仅 ~5 根、
  //      柱距 ~356px，空间充足；观众正在逐个讲解的阶段应"每根可见柱子都有名字"。
  // 另外：用显式字体的 measureText 估算标签宽度，过宽的名称逐字回缩加省略号
  // （任务二 label_overflow 防护）。
  const maxLabelW = Math.max(120, el.value ? el.value.clientWidth * 0.22 : 300);
  // 全景期柱距（像素）：全景外接框宽 = 视口宽 × WIDE_VIS，均摊到 (n-1) 个柱距
  const pitchPx = (el.value && el.value.clientWidth ? el.value.clientWidth * WIDE_VIS : 920) / Math.max(n - 1, 1);
  // 实测最大标签宽（名称行 / 数值行取大者）——stride 据此保证相邻标签不相撞
  let maxTagW = 0;
  for (const b of bars) {
    const vt = b.real.toFixed(Number(props.fixed) || 0) + (props.unit || '');
    maxTagW = Math.max(maxTagW, measureTextWidth(b.name), measureTextWidth(vt));
  }
  // 步距 = ceil(标签宽 / 柱距)，上限 6 防止极端宽标签/窄视口下标签全灭
  const stride = clamp(Math.ceil(maxTagW / Math.max(pitchPx, 1)), 1, 6);
  const isFollowPhase = t <= reveal;
  const showFlags = new Array(n).fill(false);
  // b) stride 稀疏铺满：从队首起每 stride 根显示一个
  let lastShown = -Infinity;
  for (let i = 0; i < n; i++) {
    if (i - lastShown >= stride) { showFlags[i] = true; lastShown = i; }
  }
  // 队尾补位：第 1 名（最右柱）距上一显示位不足整步距时，按半步距判断补显
  if (!showFlags[n - 1] && (n - 1 - lastShown) >= stride / 2) showFlags[n - 1] = true;
  // 保底强制位：高亮主角柱（hl，如"会师镇"）与当前活跃柱——最多引入 1~2 处
  // 单点重叠，但主角名字绝不能缺席（科普视频的核心信息点）
  if (bars[activeIdx]) showFlags[activeIdx] = true;
  bars.forEach((b, i) => { if (b.hl) showFlags[i] = true; });
  // c) 跟随期窗口：活跃柱 ±WIN 全显
  if (isFollowPhase) {
    for (let i = Math.max(0, activeIdx - FOLLOW_LABEL_WIN); i <= Math.min(n - 1, activeIdx + FOLLOW_LABEL_WIN); i++) {
      showFlags[i] = true;
    }
  }
  bars.forEach((b, i) => {
    b.showLabel = b.shown && showFlags[i];
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

  // —— 水平轨道边界 ——
  // 跟随到队首/队尾时，若注视点=活跃柱，画面会有一半落在"无柱区"
  // （实测：跟随到最后一根柱时右侧空半屏）。把注视点限制在
  // [±(数据半宽 − 半窗×0.65)] 的轨道上：画面边缘最多伸入无柱区
  // 0.35×半窗，队首/队尾的柱子自然停靠在画面 ~18% / ~74% 处，
  // 中段跟随行为不变（clamp 不触发）。
  const halfVisW = visW / 2;
  const trackEdge = (span / 2) * S - halfVisW * 0.65;
  const cxFollowFinal = clamp(cxFollow, -trackEdge, trackEdge);

  // 垂直中心（注视点高度 cy）：让"柱体 + 地面线 + 标签"整体稳定入画。
  // 【为什么用世界坐标比例而不是像素标定】
  //   旧实现用一张绑定 FOV=50 / dist≈24.13 / 分辨率 900 的像素标定表
  //   （CAM_CALIB）反解 cy；FOV 与距离一变（本次长焦化改参）整表失效，
  //   柱体被裁得上下出画。改用**世界坐标比例**：与 FOV/distance 无关。
  // 【跟随期注视点=贴地（cy≈-1.2，实测标定）】
  //   经逐档实测（scripts/qa/diag-calib2.mjs，cy ∈ [-2,16] 步长 2）：
  //   cy≈-1.2 时地面线稳定落在画面 ~85% 高度，柱体自地面向上生长、
  //   完整入画不裁底——这正是柱状图的标准透视构图（地平线在下三分之一）。
  //   注：跟随期升序弹出、早期柱矮，此构图下柱群自然位于画面中下部，
  //   与 HUD 标题区形成上下分层，符合数据可视化阅读习惯。
  // 【全景期】全阵（最高柱+标签）居中：cy = worldH × 0.62（实测地面线 ~64%，
  //   柱阵顶部 ~37%，14 根柱 + 全部标签完整入画）。
  const worldH = boxH / ZMAX;
  const CY_GROUND = -1.2;   // 跟随期注视点：地面线下方一点（实测标定值）
  const K_GAZE_WIDE = 0.62; // 全景期注视点系数
  const cyFollow = CY_GROUND;
  const cyWide = worldH * K_GAZE_WIDE;

  // 俯仰：跟随期近平视（柱体立面完整、棱线竖直）；全景期略俯视（顶面进深感）。
  const alphaFollow = ALPHA_FOLLOW;

  let alpha, beta, distance, cx, cy;
  if (t <= reveal) {
    alpha = alphaFollow; beta = 4;
    distance = followDist;
    cx = cxFollowFinal;
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
let sceneBuilt = false; // 当前 chart 实例是否已完成全量(notMerge)构建
function initChart() {
  if (!el.value) return;
  if (chart) {
    try { chart.dispose(); } catch { /* 已失效实例，忽略 */ }
    chart = null;
  }
  sceneBuilt = false; // 新实例必须重新全量构建
  chart = echarts.init(el.value, null, { renderer: 'canvas' });
  return chart;
}

// 确保上下文监听已挂载。canvas 可能尚未就绪（初次 init 后），故允许重试。
function ensureContextWatchers() {
  if (contextLostHandler && contextWatchedCanvas && contextWatchedCanvas.isConnected) return;
  attachContextWatchers();
}

// —— FOV 生效保障 ——
// 【关键兼容性事实】echarts-gl@2 的 grid3D **不消费 viewControl.fov**（其源码中
// 无任何读取 fov 的路径），clay 透视相机恒为默认 fov=50。长焦构图（本组件 FOV=16）
// 必须在每次 setOption 后直写 GL 相机。实测直写后 merge 更新不会重置该值
// （echarts-gl 不管理 fov，自然也不会覆盖），resize/交互仅更新位置与 aspect。
function ensureGLFov() {
  if (!chart) return;
  try {
    const g = chart.getModel().getComponent('grid3D');
    const cam = g && g.coordinateSystem && g.coordinateSystem.viewGL && g.coordinateSystem.viewGL.camera;
    if (cam && typeof cam.fov === 'number' && cam.fov !== FOV) {
      cam.fov = FOV;
      cam.update();
    }
  } catch { /* grid3D 尚未就绪（首个 setOption 前不可能是这种情况，防御即可） */ }
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
    // merge 逐帧更新时，上一帧 item 的 label 不会自动清除，必须**每帧显式**
    // 声明 show 与内容，否则"上一帧有标签、这一帧不该有"的柱子会残留旧标签。
    // 常量字符串 formatter：echarts-gl 只认常量配置（函数式会被静默忽略，
    // 且空文本会中断整个标签循环）——逐项开关 show 即可，安全且无重叠。
    it.label = b.showLabel
      ? { show: true, formatter: b.labelText }
      : { show: false };
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
  // 【修复：播放期画布空白（"直到最后才显示所有柱子"）】
  // 旧实现每帧 setOption(opt, { notMerge: true })——notMerge 会把上一次的
  // echarts-gl 场景（grid3D + bar3D 网格 + GL 资源）整体销毁重建。实测单次
  // 重建 9~90ms（低端 GPU / 软件渲染更甚），帧间隔 16ms 内下一次 setOption
  // 又把场景清掉 → GL 层永远处于"已清空、未画完"状态 → 播放全程空白；
  // 直到动画结束循环停止，最后一次重建才得以完成 → 用户只看到结尾全景。
  // 修复：仅实例首次（或上下文恢复重建后）做全量 notMerge 构建；此后逐帧
  // merge 增量更新（series data + viewControl），GL 网格原地更新。
  chart.setOption(opt, { notMerge: !sceneBuilt });
  sceneBuilt = true;
  // setOption 之后 ECharts 的 <canvas> 才真正存在 —— 此刻再确保监听已挂载。
  ensureContextWatchers();
  // echarts-gl 不消费 viewControl.fov（见函数注释），setOption 后直写长焦 FOV。
  ensureGLFov();

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
      applyCost: +lastApplyCost.toFixed(2),
      labelFont: LABEL_MEASURE_FONT,
      labels: f.bars.filter((b) => b.showLabel).map((b) => ({
        name: b.labelName ?? b.name,
        w: +measureTextWidth(b.labelName ?? b.name).toFixed(1),
        text: b.labelText,
      })),
    };
    window.__brChart = chart; // 供 QA 深挖 echarts 实例内部状态（仅 debug 路径）
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
// 播放期渲染节流：GL 场景单帧更新在中低端 GPU / 软件渲染下可达数十毫秒，
// 若每 rAF（60fps）都更新会持续积压、画面卡死甚至黑屏。这里把**渲染**上限
// 限制在 PLAY_MAX_FPS；时间轴仍按真实时间推进（p 取自 now-t0），因此动画
// 总时长不变，仅画面更新频率自适应降档。30fps 对柱状生长动画完全够流畅。
const PLAY_MAX_FPS = 30;
const PLAY_MIN_DT = 1000 / PLAY_MAX_FPS;
let lastPlayRender = 0;
// 最近一帧 setOption 实测耗时（ms），用于自适应判断是否需要降档诊断。
let lastApplyCost = 0;
function loop(now) {
  if (props.captureT != null || recording || isContextLost.value) return;
  if (!t0) { t0 = now; lastPlayRender = 0; }
  const p = Math.min((now - t0) / (Number(props.duration) || 7200), 1);
  // 节流：距上次渲染不足 PLAY_MIN_DT 时跳过本轮 GL 更新（时间照走）
  if (now - lastPlayRender >= PLAY_MIN_DT || p >= 1) {
    lastPlayRender = now;
    const s = performance.now();
    applyFrame(p);
    lastApplyCost = performance.now() - s;
  }
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
