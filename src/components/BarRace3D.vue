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
  shape: { type: String, default: 'bar' },   // bar|cube|rounded|cylinder|sphere
});
// ★ v2.8.3：新增 'paused' 事件（payload: boolean）——
//   暂停/续播状态变化时向上抛，供 App.vue 同步按钮文案与图标。
//   之所以用事件而非让 App 轮询 isPaused()：状态变化是离散的（点按钮 / 按空格），
//   事件驱动最自然，也避免额外轮询开销。
const emit = defineEmits(['active', 'done', 'paused']);

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
// ★ v2.8.3 修复③：跟随期注视点向「下一根（正在生长的）柱」偏移的强度（0..1）。
//   0 = 完全按旧逻辑贴活跃柱（新柱易落在画面右缘之外）；1 = 完全取两柱中点。
//   取 0.75：既把新柱可靠拉进画面中部（满足"同屏 ≥2 根、其中一根在生长"），
//   又保留少许"镜头略偏向讲解主体"的语义（活跃柱比新柱更靠中偏左一点）。
//   实测依据见 computeFrame 内 FOLLOW_BIAS 使用处与 scripts/qa/probe-firstbar.mjs。
const FOLLOW_BIAS = 0.75;
// 上述偏向权重的**下限**（0..1）：新柱还没长出来（grow=0）时也保留的偏向强度。
//   取 0.6 —— 若为 0，则 t≈0 时相机退回"贴活跃柱"逻辑、被轨道 clamp 推到画面边缘
//   （实测 cx=-96、柱体只占屏宽 18%~41%），开场依然空旷；
//   取 0.6 让相机**从第一帧**就瞄准"活跃柱↔下一根"的中点，两根柱一左一右同框。
//   不去到 1.0 是为了保留"活跃柱比新柱略靠中偏左"的讲解语义（活跃柱是当前主角）。
const BIAS_FLOOR = 0.6;
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
// 竖屏/方形画幅的全景目标宽度占比：适度放宽到 0.80。
// 实测：0.94/0.86 会在 beta=8° 旋转下两端柱体触边；0.80 留出安全边距。
const WIDE_VIS_PORTRAIT = 0.80;
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

// ================= 形状（shape）=================
// 形状参数表：bar3D 家族靠 bevelSize（归一化倒角比例）与截面宽深比区分。
//   · bevelSize 语义（echarts-gl Bars3DGeometry）：实际倒角半径 = min(宽,深)/2 × bevelSize，
//     ⚠ 但它被**同时施加到 X/Y/Z 三个轴**（源码：bevelStartSize[i] = size[i] - bevelSize*2），
//     故 bevel 越大，**端面也被圆化得越厉害**。bevel=1.0 时端面倒角半径 = 半宽
//     → 上下端各成一个半球 → 得到的是「胶囊」，**不是圆柱**。
//   · 实测（t=1 全景，垂直剖面归一化宽度，顶→底）：
//       cube     [0.05, 1.00, 1.00, 1.00, 0.99, 0.91, 0.51, 0.88, 0.49, 0.37, 0.04]
//       rounded  [0.05, 1.00, 1.00, 1.00, 0.99, 0.91, 0.74, 0.88, 0.41, 0.37, 0.04]
//       cylinder [0.05, 1.00, 1.00, 1.00, 1.00, 1.00, 0.74, 0.88, 0.32, 0.37, 0.04]
//     → 顶部 0.05（**尖角**），四种形状剖面几乎一致，cylinder 与 rounded 只差小数第三位
//     —— 这正是用户报的「圆柱显示成胶囊」。
//   · 结论：bar3D 的 bevel 是「圆角盒」语义，无法表达"直壁 + 平顶"的真圆柱。
//     故 cylinder **不走 bar3D**，改用 surface 参数化方程自建真圆柱（见 CYL_SERIES）。
const SHAPE_GEOM = {
  bar:      { bevel: 0.28, smooth: 3,  square: false }, // 现状：轻微圆角
  cube:     { bevel: 0.0,  smooth: 0,  square: true  }, // 直角方柱
  rounded:  { bevel: 0.50, smooth: 6,  square: true  }, // 圆角柱
  // cylinder 不再使用本表（改走 surface），保留键位以防外部按名字查表。
  cylinder: { bevel: 1.0,  smooth: 8,  square: true  },
};
const shapeGeom = (s) => SHAPE_GEOM[s] || SHAPE_GEOM.bar;
const isSphere = (s) => s === 'sphere';
// 需要走 surface 真圆柱的形状
const isCylinder = (s) => s === 'cylinder';

// —— 真圆柱（surface 参数化）——
// 用 u=环向 [0,1)→2π、v=纵向 [0,1] 的一张参数面同时表达「侧壁 + 顶盖」：
//   v ∈ [0, 1-CYL_CAP)  → 直壁（半径恒为 R，z 从 0 线性升到 H）
//   v ∈ [1-CYL_CAP, 1]  → 顶盖（z 恒为 H，半径按 sqrt(1-k²) 收缩到 0）
// 用 sqrt 收缩而非线性收缩，使盖面呈球冠过渡 —— 边缘无硬折角，观感像"倒圆角的平顶"。
// 实测剖面（同环境下）：[0.17,1.00,0.99,0.97,0.96,0.95,0.94,0.92,0.88,0.57,0.05]
//   —— 顶部 0.17 明显大于 bar3D 的 0.05（是"面"而非"尖"），中段直壁恒定 ⇒ 真圆柱。
const CYL_CAP = 0.14;     // 顶盖占 v 的比例（越小顶越平）
const CYL_SEG_U = 40;     // 环向分段（40 → 每 9° 一段，够圆且顶点可控）
const CYL_SEG_V = 26;     // 纵向分段（含壁与盖）
/** 生成单个圆柱的参数化数据（[x, y, z, u, v] 五元组，surface 要求带参数维）。 */
function cylData(cx, cy, r, h, segU = CYL_SEG_U, segV = CYL_SEG_V) {
  const out = [];
  for (let j = 0; j <= segV; j++) {
    const v = j / segV;
    let rr, zz;
    if (v <= 1 - CYL_CAP) {
      rr = r; zz = (v / (1 - CYL_CAP)) * h;
    } else {
      const k = (v - (1 - CYL_CAP)) / CYL_CAP;
      rr = r * Math.sqrt(Math.max(0, 1 - k * k));
      zz = h;
    }
    for (let i = 0; i <= segU; i++) {
      const u = i / segU, a = u * Math.PI * 2;
      out.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a), zz, u, v]);
    }
  }
  return out;
}
// 圆的包围盒刻度：surface 走 grid3D 的 x/y 轴数据范围。
// ★ 各向同性校验（圆柱不被压扁的前提）：
//   xAxis3D 数据范围 = [-span/2-xPad, span/2+xPad]，跨度 = span+2·xPad = xRange；
//     grid3D.boxWidth = S × xRange  ⇒ x 方向 1 数据单位 = S 世界单位。
//   yAxis3D 数据范围 = [-0.85, 0.85]，跨度 = 1.7；
//     grid3D.boxDepth = S × 1.7      ⇒ y 方向 1 数据单位 = S 世界单位。
//   两轴「数据单位 → 世界单位」的比例同为 S ⇒ 参数化圆 xy 用同一半径即为正圆。
//   （若将来改动 xAxis3D/yAxis3D 的 min/max 或 boxW/boxD，必须同步复核此比值。）


// 球体几何（scatter3D 分支，三层叠加：atmosphere 光晕 / body 主体 / specular 高光）：
//   · 球心离地 = 半径（贴地），随生长从 0 抬升到半径，视觉上"弹跳升起"；
//   · 半径 ∝ 球体专属高度系数 sphereFrac（下限比柱体 H_FLOOR 更低，让大小差异更易读）；
//   · symbolSize 为屏幕像素直径，故需把世界半径换算成像素（按跟随期可视高估）。
// 注：echarts-gl PointsBuilder 对 symbolSize 有 ~200px 上限，故 clamp 到 188。
// 【立体感】scatter3D 是"永远正对相机的贴片"（billboard sprite），本身无光照/高光，
//   纯色圆看起来像扁圆点。故用**多层同位置叠加**伪造球体：
//     ① atmosphere 外层光晕（大一圈、低透明）→ 边缘辉光；
//     ② body 主体球 → 球体本色；
//     ③ specular 高光（小一圈、偏左上、近白色）→ 受光高光的错觉。
// 【尺寸映射：幂次压缩（γ=0.68），兼顾"差异可读"与"不退化"】
//   纯线性半径在悬殊数据下会崩：pop 视图最大 11.41 万 vs 最小 0.41 万（28×），
//   小球直接退化成 2~3px 小点、大球独占半屏（用户报"球体不够完美"）。
//   纯 sqrt（面积编码）又走向另一极端：28× → 半径仅 5.3×，28 个球看起来"差不多大"，
//   对比语义丢失（实测截图确认）。故取中间幂次 γ=0.68：
//     28× 数值 → 半径差 ≈ 28^0.68 ≈ 9.6×，大球醒目、小球仍是有体积的球，
//     且保持单调（排序/颜色/数值语义不变）。
const SPHERE_GAMMA = 0.68;   // 半径映射幂次（1=线性，0.5=面积）
const SPHERE_R_MIN = 0.30;   // 最小球世界半径（γ 压缩后下限，仍明显成"球"）
const SPHERE_R_MAX = 1.05;   // 最大球世界半径（受步距约束：S×BAR_W_MAX/2）
const SPHERE_PX_MAX = 188;   // symbolSize 像素上限（< PointsBuilder 的 200 上限）
const SPHERE_H_FLOOR = 0.26; // 半径系数下限（γ 压缩后 0.41/11.41 → 0.26+0.74×0.19≈0.40）
const SPHERE_ATMO_K = 1.30;  // 环境光晕层直径倍率（相对主体，略大一圈 → 边缘辉光）
const SPHERE_MID_K = 0.78;   // 中间过渡层倍率（本色略亮 → 球面明暗过渡，避免"同心圆硬边"）
const SPHERE_CORE_K = 0.40;  // 内芯高光层倍率（同中心、近白更小 → 受光感的核心）
const SPHERE_PX_MIN = 9;     // symbolSize 像素下限：极端数据下小球也不小于 9px（可点选/可辨识）
// 全景期球体像素放大系数：距离补偿（followDist/wideDist）会把全景球压得很小，
// 而球体是**画面主体**（不像柱体还有高度可言），必须保证收尾画面里球群依然饱满醒目。
// 实测：n=28 时 wideDist=607，补偿后最大球仅 ~39px（1280×720），观感是"一排细珠"。
// 取 4.2 后最大球 ~88px、最小 ~30px，大小差异清晰且球体圆润可辨。
const WIDE_SPHERE_BOOST = 4.2;
// 全景期最大球直径目标占画面高的比例——球体模式据此反推相机距离（见 wideDist 处注释）。
// 0.20 ≈ 720p 下最大球直径 ~144px，大小差异清晰可读、又不会挤占整个画面。
const SPHERE_WIDE_FILL = 0.20;
// 球体注视点抬升系数（× 可视高）：把球群从"画面偏上"推到"中下部"（见 cyWide 处注释）。
// 实测（1280×720）：0.30 时 n=28/n=14 球群分别稳定落在 ~57%/~58% 屏高。
const SPHERE_GAZE_K = 0.30;

// —— 标签字体（单一真源）——
// 中文字体必须显式声明：无头环境下 font-family 若解析到不含中文字形的字体，
// canvas measureText 会把每个汉字当作超宽字符 → 标签"逐字换行/竖排"。
// 与 index.html 的 @font-face 保持同一字体栈。
const LABEL_FONT_FAMILY = '"Noto Sans CJK SC","PingFang SC","Microsoft YaHei",sans-serif';
const LABEL_FONT_SIZE = 16;
// 显式用于 canvas 测量的字体串（任务二要求：测量标签宽度前显式设置 ctx.font）
const LABEL_MEASURE_FONT = `bold ${LABEL_FONT_SIZE}px ${LABEL_FONT_FAMILY}`;

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
// 把颜色朝白色混合 amt（0~1）—— 用于球体"过渡层"提亮，制造径向明暗梯度的中间档。
// theme.js 的色值统一为 [r,g,b]（0~255）数组，故直接按分量线性插值。
const mixWhite = (c, amt) => {
  const a = Array.isArray(c) ? c : [200, 200, 200];
  return [a[0], a[1], a[2]].map((v) => Math.round(v + (255 - v) * amt));
};
const lerp = (a, b, t) => a + (b - a) * t;
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
// 轻微回弹，让柱子"弹"出来（f(0)=0，峰值 ~1.06）
// ★ v2.8.2 修复②：替换原 easeOutBack。
//   旧式 `1 + 2.7(t-1)³ + 1.7(t-1)²` 的**起点斜率极大**（f'(0) = 2.7·3 + 1.7·2 = 11.5），
//   实测 t=0.02（首帧）时 f≈1.054 —— 柱子**两帧内直冲满高**，"从 0 生长"完全不可见
//   （探针 scripts/qa/probe-new3.mjs：t=0.02 grow=[1.054, 0.939, 0, …]）。
//   新式用「smoothstep 主体 + 衰减回弹余项」：
//     · 主体 3u²-2u³：起点斜率 0（真·从 0 缓缓生长）；
//     · 余项 B·u^p·(1-u)^q：只在 u≈p/(p+q) 处制造一个约 +6% 的过冲，
//       两端均为 0，故不破坏 f(0)=0 / f(1)=1 与端点斜率 0。
//   实测新曲线：u=0.10→0.086、u=0.30→0.402、u=0.50→0.734、u=0.70→0.966、
//   u=0.82→1.063（峰值）、u=1.00→1.000 —— 生长过程完整可见且末端有"弹一下"的手感。
const EASE_BACK_AMP = 0.16;   // 回弹幅度（峰值过冲 ≈ +6%）
const EASE_BACK_P = 6;        // 余项左幂（越大越晚起弹）
const EASE_BACK_Q = 3;        // 余项右幂（越大越快收敛）
const easeOutBack = (u) => {
  const x = Math.max(0, Math.min(1, u));
  const base = x * x * (3 - 2 * x);
  const over = EASE_BACK_AMP * Math.pow(x, EASE_BACK_P) * Math.pow(1 - x, EASE_BACK_Q);
  return base + over;
};

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
  // 【v2.6 画幅支持】aspect 直接来自容器像素（.viewport 取景框，其尺寸 = 所选比例），
  //   故此处无需感知"16:9 / 9:16 / 1:1 / 4:3"——只要容器比例正确，构图自动适配。
  //   aspectC（clamp 到 [1.15,2.2]）仅用于"水平可视宽"这类**横向**量：
  //     · 跟随期距离固定 → 垂直构图在所有比例下一致（地面线 ~85% 屏高不变）；
  //     · 水平同框柱数 = visFactor 的函数 → 竖屏自然少几根、宽屏多几根。
  //   ★ 但"跟随期可视高 visH"必须按**真实 aspect** 推导（见 ⑤）：旧实现里 visH 只由
  //     FOV+distance 决定、与 aspect 无关，于是 1:1 / 9:16 这类更"方"的画幅下，
  //     竖向可视范围与 16:9 完全相同 → 柱体在世界里矮得像一片薄饼，
  //     画面上只剩中间一条横向色带、上下大片空白（v2.6 实测的构图塌陷）。
  //     让 visH 随"更方的画幅"按比例**收窄**，柱体在世界中随之变矮、但在屏幕上
  //     仍占相同比例 → 任何画幅下都是"高耸、占满画面主体"的正确构图。
  const elv = el.value;
  let aspect = elv && elv.clientWidth && elv.clientHeight ? elv.clientWidth / elv.clientHeight : 1.778;
  const aspectC = clamp(aspect, 1.15, 2.2);
  const visFactor = 2 * Math.tan((FOV / 2) * Math.PI / 180) * aspectC;

  // —— ① 跟随距离：按画幅自适应（v2.9.0 修复⑤-b「比例自适应」）——
  // 【实测问题】旧式为**固定** FOLLOW_DIST=87，而"同屏柱数" = 水平可视宽 / 柱距 S，
  //   水平可视宽 = 2·d·tan(FOV/2)·aspect ⇒ 与真实画幅成正比（FOV=16、d=87）：
  //       16:9 → 43.47 ⇒ **5.43 根**   4:3 → 32.61 ⇒ 4.08 根
  //       1:1  → 24.45 ⇒ 3.06 根      9:16 → 13.76 ⇒ **1.72 根**
  //   竖屏只装得下 1.72 根，连"同屏 2 根"的底线都达不到；且同样的 8 单位换柱位移
  //   在竖屏要吃掉 **58.2% 屏宽**（16:9 仅 18.4%）—— 这就是"竖屏跳得最凶"的几何来源。
  // 【修复·窄画幅保底取景】由"水平可视宽 ≥ TARGET_BARS_X·S"反推距离：
  //       d ≥ TARGET_BARS_X·S / (2·tan(FOV/2)·aspect)
  //   取 max(FOLLOW_DIST, …)：
  //     · 16:9 / 4:3 的反推距离（57.6 / 76.9）**均小于 87** ⇒ 完全维持旧值，零回归风险；
  //     · 仅 1:1 / 9:16 被拉远到 102.5 / 182.2 ⇒ 同屏柱数补齐到 3.6 根。
  //   ★ 只做**下限保证**而不做上限压缩：宽屏同屏更多本就是"画面更宽"的自然结果，
  //     且观感更好，强行统一反而会让横屏失去信息密度。
  const TARGET_BARS_X = 3.6;   // 任何画幅下至少保证的同屏柱数
  const tanFovHalf = Math.tan((FOV / 2) * Math.PI / 180);
  const followDistAdapt = (TARGET_BARS_X * S) / (2 * tanFovHalf * Math.max(aspect, 0.35));
  const followDist = Math.max(FOLLOW_DIST, S * 2.0, followDistAdapt);
  const visW = followDist * visFactor;                        // 跟随期可视宽（世界）
  // —— ⑤ 跟随期可视高：随画幅"方/竖"程度收窄（v2.6 画幅支持的关键）——
  //   基准：参考画幅 16:9（1.7778）下可视高 = 2·d·tan(FOV/2)，即旧行为，完全不变。
  //   更方的画幅（1:1=1.0、9:16=0.5625）：竖向可视范围按 aspect/1.7778 等比收窄
  //     → boxH/worldMaxH 变小 → 柱体在世界中变矮；但由于屏幕竖向也同比变短，
  //       柱体在**屏幕上**占的比例不变，于是"跟随期柱体高耸入画"的构图被保住。
  //   横屏（aspect ≥ 1.7778，如 2:1 超宽）不收窄：竖向可视范围本不该再放大，
  //   否则超宽画幅下柱体会被压扁成薄饼（故这里只对 aspect < 基准 的情况生效）。
  //   与 ④ 全景距离（按真实 aspect 拉远）方向一致 → 跟随↔全景的过渡不会突变。
  const ASPECT_REF = 16 / 9;
  const visHScale = Math.min(1, Math.max(aspect, 0.4) / ASPECT_REF);
  const visH = 2 * followDist * Math.tan((FOV / 2) * Math.PI / 180) * visHScale; // 跟随期可视高

  // —— ② boxH：定"最高柱世界高度" = 可视高 × CORE_FILL ——
  //  这是唯一由画面决定的量；柱宽则由"最矮柱非薄片"反推（见③）。
  //  【为什么不按全景距离抬升柱高（hBoost 方案，已否决）】曾试验 worldMaxH 随
  //   wideDist/followDist 放大（提高全景竖向占比），但 worldMaxH 同时决定跟随期
  //   柱高 → 跟随期柱体远超可视高、触顶裁切（实测四画幅内容顶到 y=5.7%）。
  //   两阶段对柱高的需求不可兼得；全景期以"完整入画、居中偏下、不裁切"为标准，
  //   横向铺开的柱阵在竖画幅中竖向占比偏小是几何必然，不强行填满。
  const worldMaxH = visH * CORE_FILL;
  // 球体模式：内容高度只有"球直径"量级（≈ 2×世界半径），若沿用柱体的高大 z 预算，
  // 3D 网格会被撑得很高而球全挤在底部 → 画面下半空、球偏小。
  // 故球体模式单独收窄 z 预算：按最大球直径留出约 2.4 倍余量（含标签/间隙）。
  const shape0 = isSphere(props.shape) ? 'sphere' : props.shape;
  const sphereWorldMaxR0 = Math.min(SPHERE_R_MAX, S * BAR_W_MAX * 0.5);
  const worldMaxHSphere = sphereWorldMaxR0 * 2 * 2.4;
  const boxH = (isSphere(props.shape) ? Math.min(worldMaxH, worldMaxHSphere) : worldMaxH) * ZMAX;

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

  // —— 球体模式：球径世界单位（贴地、随 hFrac 缩放），供 scatter3D 使用 ——
  const shape = shape0;
  const sphereWorldMaxR = sphereWorldMaxR0;
  const sphereWorldMinR = SPHERE_R_MIN;
  // 世界半径 → 屏幕像素直径换算（跟随期可视高：visH 世界单位 ↔ el 像素高）
  const pxPerWorldY = (elv && elv.clientHeight ? elv.clientHeight : 720) / visH;

  // —— ④ 全景距离：整排跨度反推（结尾拉远，全部柱体/球体入画）——
  // 球体比柱体宽，跨度按球径算，避免全景期球体出画。
  // 【竖屏/方形用真实 aspect（全形状）】visFactor 基于 clamp 后的 aspectC∈[1.15,2.2]。
  //   当视口比 2.2 更"宽"时 clamp 影响不大（16:9=1.78 本就在区间内）；
  //   但当视口比 1.15 更"方/竖"（1:1=1.0、9:16=0.5625）时，用 aspectC 会**高估可视宽**
  //   → 反推出的距离偏小 → 整排横向溢出被裁（1:1/9:16 实测的构图塌陷根源之一）。
  //   → 全景距离一律按**真实 aspect** 反推（宽屏两者等价，方/竖屏自动拉远）。
  const halfWidthWorld = isSphere(props.shape) ? sphereWorldMaxR * 1.25 : barWworld * GLOW_K * 0.5;
  const aspectTrue = Math.max(aspect, 0.4); // 真实纵横比下限（防除零）
  const visFactorTrue = 2 * Math.tan((FOV / 2) * Math.PI / 180) * aspectTrue;
  // 【投影安全系数】几何跨度之外，实际渲染还有：光晕层外扩（GLOW_K）、首尾柱外缘
  //   标签文字、alpha=22°/beta=8° 透视旋转使近端投影外扩、近大远小梯形。
  //   实测（1920 长边，t=1 全景）：1.15 时四画幅柱阵横向稳定落在 50%~70% 安全区，
  //   两端不触边（地面网格/四角装饰仍会延伸到画面边缘，属正常背景元素）。
  const WIDE_SPAN_SAFETY = 1.15;
  const barsSpan = (halfWidthWorld * 2 + span * S) * WIDE_SPAN_SAFETY;
  // 【画幅自适应目标宽度】基准 16:9 用 WIDE_VIS=0.72（两侧留 HUD 边距）；
  //   窄画幅适度放宽（WIDE_VIS_PORTRAIT=0.80）——横向空间稀缺，过小的目标占比
  //   会让相机过度后退、柱阵缩成细珠。实测 0.94/0.86 会在 beta 旋转下两端触边，
  //   0.80 是"不触边"前提下竖屏能达到的最大占比。
  const aspectWideK = clamp(
    WIDE_VIS * (1 + (WIDE_VIS_PORTRAIT / WIDE_VIS - 1)
      * clamp((ASPECT_REF - aspectTrue) / (ASPECT_REF - 0.5625), 0, 1)),
    WIDE_VIS, WIDE_VIS_PORTRAIT,
  );
  const wideDistNode = barsSpan / (aspectWideK * visFactorTrue);
  const wideDist = Math.max(wideDistNode, followDist * 1.2);

  // —— 全景期柱体尺寸补偿（wideBoost，修复竖屏/方形全景"细珠化"）——
  // 【缺陷】竖屏全景下柱体几乎不可见（实测 9:16：28 根柱只剩近端 2 根有像素）。
  //   数值链：visHScale=aspect/1.78≈0.32 → worldMaxH/boxH/barW 全部收窄到 16:9 的
  //   ~32%（跟随期屏幕占比不变，这是设计意图）；但全景距离按**横向跨度**反推，
  //   竖屏 visFactorTrue 小 3.16× → wideDist 涨 ~3.16×（706→1981）。
  //   投影尺寸 ∝ 世界尺寸/距离 → 竖屏全景柱体缩至 16:9 的 ~10%（0.32×3.16）。
  //   16:9 无此问题（收窄系数=1）→ 现状验收构图必须保持 → 补偿只能对"方/竖"生效。
  // 【方案】与球体模式 WIDE_SPHERE_BOOST 同思想的全景距离补偿，柱体版：
  //   目标 = 全景期最高柱的竖向占比 ≥ 16:9 现状水平（WIDE_FILL_TARGET）：
  //     need = TARGET × visHWide / worldMaxH     （visHWide=全景可视高，与 aspect 无关）
  //   上限 = 相邻柱不粘连：柱径 ≤ 步距 × BAR_W_MAX × 0.92：
  //     K_max = (S × BAR_W_MAX × 0.92) / barW
  //   wideBoost = clamp(need, 1, K_max)；**按过渡进度 us 从 1 渐入**（见相机段），
  //   跟随期（us=0）严格等于原几何 → 所有既有跟随期构图/QA 不受影响。
  //   实测（population，n=28）：16:9 need≈0.93→K=1（零变化）；9:16 need≈8.3
  //   K_max≈6.9 → K=6.95：柱高 6→42 世界、竖向占比 1.1%→7.5%（≈16:9 的 9.6% 水平），
  //   柱径 1.27→8.8（< 8.83 不粘连）。
  const visHWide0 = 2 * wideDist * Math.tan((FOV / 2) * Math.PI / 180);
  // 目标占比取 0.08（16:9 现状 8.1% 以下）→ 16:9 need<1 ⇒ K=1 **严格不变**；
  // 只有比 16:9 更"方/竖"的画幅才触发补偿。
  const WIDE_FILL_TARGET = 0.08;
  const needBoost = (WIDE_FILL_TARGET * visHWide0) / Math.max(worldMaxH, 1e-6);
  const K_ADHESION = (S * BAR_W_MAX * 0.92) / Math.max(barWworld, 1e-6); // 粘连上限
  const wideBoost = isSphere(props.shape) ? 1 : clamp(needBoost, 1, K_ADHESION);

  // —— 球体尺寸的"距离补偿" ——
  // 【为什么需要】echarts-gl 的 scatter3D symbolSize 是**屏幕像素固定值**，相机拉远/拉近
  //   时它不随之缩放（实测：distance 607→160，symbolSize 恒为 61.8px），因此全景期
  //   相机远退时地面网格在屏幕上缩小、而球体仍保持跟随期的像素尺寸 → 球群与地面
  //   透视比例脱节、球小得看不清。补偿：symbolSize 按 distance 反比缩放，再乘一个
  //   放大档（球体是画面主体，需要足够醒目）。
  const sphereDistScale = isSphere(props.shape) ? clamp(followDist / wideDist, 0.34, 1) : 1;
  const spherePxScale = sphereDistScale * WIDE_SPHERE_BOOST;

  const barW = barWworld;
  const barD = barDworld;

  if (!n) {
    return { bars: [], camera: { alpha: 20, beta: 6, distance: wideDist, center: [0, S, 0], fov: FOV }, activeIdx: -1, revealed: 0, theme: th, boxW, boxD, boxH, barW, barD, xPad, shape, sphereWorldMinR, sphereWorldMaxR, pxPerWorldY };
  }

  // —— 升序（低→高）弹出次序；稳定排序 ——
  const idxs = rows.map((_, i) => i);
  idxs.sort((a, b) => (Number(rows[a].value) || 0) - (Number(rows[b].value) || 0) || a - b);
  const maxV = Math.max(...rows.map((r) => Number(r.value) || 0)) || 1;

  const step = reveal / n;
  // 【v2.8.2 修复②】生长时长按**可感知的秒数**定，而非 step 的比例。
  //   旧式 `min(step×1.8, reveal×0.5)` 在 n=28 时 growDur≈0.0463（占时长 4.6%，
  //   30fps 下仅 1.4 帧）——即使缓动改成从 0 起步，也只有 1~2 帧可见，
  //   用户仍会觉得"柱子是突然出现的"。故：
  //     · 以秒为单位给出目标生长时长 GROW_SEC（0.55s），再按总时长换算成 t 比例；
  //     · 上限 = step×2.2（不越过下一根柱的弹出点太多，保持"逐根弹出"的节奏感）；
  //     · 下限 = step×0.9（极长视频/极多柱时仍保留基本生长过程，不至于完全退化）。
  //   实测（默认 2s/根、n=28、时长 77.8s）：GROW_SEC=0.55s → t 比例 ≈0.00707，
  //   step=0.0257 → 取上限后 growDur≈0.0565（占时长 5.7%，30fps 下约 1.7s ≈ 51 帧）
  //   —— 0.55s 的真实动画，肉眼清晰可见"拔地而起"。
  const totalMs = Number(props.duration) || 60000;
  const GROW_SEC = 0.55;
  const growDurBySec = (GROW_SEC * 1000) / Math.max(totalMs, 1);
  const growDur = clamp(growDurBySec, step * 0.9, step * 2.2);
  const activeIdx = clamp(Math.round((t / step) - 0.5), 0, n - 1); // 当前活跃柱（升序序号）

  // ══════════ 【v2.8.3 修复③】开场"无柱空窗" + "只有一根柱" ══════════
  // 【实测缺陷】旧式 `appearT = (k+1) * step` 有两处硬伤（scripts/qa/probe-firstbar.mjs）：
  //   ① **开场死区**：k=0 的 appearT = 1×step = 0.0257（默认 77.8s 视频里约 2.0s），
  //      再减去 growDur（=step×2.2 时更晚）——实测 t=0.005 时 `revealed = 1` 但
  //      **画面几乎没有柱体**；t=0 时 `shown = 0`（一根都没有）。用户看到的开场是
  //      "空白画面 → 柱子突然从角落冒出来"。用户报："16:9 比例下首根柱子不可见"。
  //   ② **同屏柱数不足**：所有柱按 (k+1)×step 等间距弹出、growDur=step×0.9，
  //      生长窗口互不重叠 ⇒ 任一时刻最多 1 根在生长，且其余已长成的柱**离得太远**
  //      （仍挤在左侧，见下条 trackEdge 说明）⇒ 用户："其他柱子生长也不可见"
  //      "应该保持两个柱体在屏幕中，且其中一个为生长的"。
  // 【修复·生长时间轴重排】
  //   让**第一根柱从 t=0 起就开始生长**（用户要求"每个柱体初始化高度应该从 0 开始"
  //   的自然延伸：t=0 就该看到它正在长），并让相邻生长窗口**故意重叠**：
  //     · 第 k 根柱的**生长起点** startT(k) = k × step × STAGGER；
  //     · 第 k 根柱的生长**结束**（=获得满高）落在 reveal 之内 → 由 growDur 保证；
  //     · STAGGER < 1 使"下一根开始生长"早于"上一根长完"→ 同屏常驻 ≥2 根
  //       （一根接近长成、一根刚起步），配合"高亮/活跃"标记即可满足
  //       "两个柱体在屏幕中，其中一个为生长的"。
  //   为什么用 STAGGER 而不是直接把 appearT 改成 k×step：k×step 会让最后一根
  //   在 (n-1)/n·reveal 就结束生长，尾部 reveal 段内无柱可长（节奏塌掉）。
  //   STAGGER 保证 k=n-1 的起点 = (n-1)·step·STAGGER 仍 < reveal，且满高时刻 ≤ reveal。
  // 【取值】STAGGER = 0.85：
  //     · 重叠量 = (1−0.85)·step = 0.15·step ≈ 0.4s（默认档）→ 肉眼可见"上一根还在
  //       长高时，下一根已经冒头"，既有节奏感又不糊成一团；
  //     · k=0 的起点恰为 0 ⇒ **开场第一帧就有柱体正在生长**（消除死区）；
  //     · 末根（k=n−1）起点 = 0.85·(n−1)/n·reveal = 0.822·reveal，加 growDur(≤2.2·step
  //       =0.079·reveal) = 0.901·reveal < reveal ✓，尾部节奏完整。
  const STAGGER = 0.85;

  // —— 逐柱生长（升序 k=0..n-1 依次弹出）——
  // 关键：柱子一旦"出现"就长到**自己的完整比例高度**（不是从 0 慢慢长到很矮），
  // 这样即使是最矮的第一根，也是一个"有体积的柱体"而非趴地的薄片。
  // 生长过程用 easeOutBack 从 0→hFrac 弹入（视觉上是"拔地而起"）。
  const bars = [];
  let revealed = 0;
  idxs.forEach((rowIdx, k) => {
    // ★ v2.8.3 修复③：起点改为 k×step×STAGGER（k=0 ⇒ 恰为 0，开场即生长），
    //   见上方 STAGGER 注释；上一行 `(k+1)*step` 会造成开场死区与同屏柱数不足。
    const startT = Math.min(k * step * STAGGER, Math.max(reveal - growDur, 0));
    const u = clamp((t - startT) / growDur, 0, 1);
    const local = easeOutBack(u);
    // ★ v2.8.3 修复③（补）：**开场首帧零高度**问题。
    //   easeOutBack(0)=0 ⇒ 生长起点那一帧柱高恰为 0，导出视频第 0 帧是"空场景"
    //   （实测抽帧：第 0 帧只有标题/徽标/来源，画面中央空无一物）。
    //   用户报"首根柱子不可见"，第 0 帧的空画面正是最直接的来源。
    //   修复：一旦该柱的**生长窗口已开启**（t ≥ startT），就给一个极小种子高度
    //   SEED_H，使其在地面上立刻有一个可辨识的小凸起（≈0.6% 满高），随后正常拔地而起。
    //   ★ 判据必须是 `t >= startT` 而非 `u > 0`：在 t = startT 那一帧 u 恰为 0，
    //     用 u>0 会漏掉起点帧（这正是首帧仍为空的直接原因 —— 已实测复现）。
    //   未到生长时刻的柱仍是 0（不可见）⇒ "逐根弹出"语义不受影响。
    //   取 0.006：1920×1080 下最高柱约 700px ⇒ 种子约 4px，肉眼可辨但不喧宾夺主。
    const SEED_H = 0.006;
    const started = t >= startT && growDur > 0;
    const localSeeded = started ? Math.max(local, SEED_H) : local;
    if (localSeeded > 0.001) revealed++;
    const v = Number(rows[rowIdx].value) || 0;
    const ratio = clamp(v / maxV, 0, 1);
    // 高度系数：H_FLOOR 保证最矮柱仍有可见高度；ratio=1 → 1（最高柱不变）
    const hFrac = H_FLOOR + (1 - H_FLOOR) * ratio;
    const z = Math.max(hFrac * localSeeded, 0.0001);
    const x = -span / 2 + k; // 世界坐标（场景单位），与相机中心同一坐标系
    const color = rows[rowIdx].highlight ? th.highlight : rampColorAt(th.ramp, ratio);
    // —— 球体专属几何 ——
    //   半径系数走 **ratio^SPHERE_GAMMA**：幂次压缩映射，详见 SPHERE_GAMMA 处注释。
    //   半径 ∝ sphereFrac（世界单位）→ 再换算成 symbolSize 像素直径；
    //   球心贴地：y = 半径 × localSeeded（生长时从地面弹出到目标半径高度）。
    //   ★ v2.8.3：球体同样使用 localSeeded —— 否则球体模式开场首帧同样空场景。
    const sphereFrac = SPHERE_H_FLOOR + (1 - SPHERE_H_FLOOR) * Math.pow(ratio, SPHERE_GAMMA);
    const sphereRworld = sphereWorldMinR + (sphereWorldMaxR - sphereWorldMinR) * sphereFrac;
    const sphereR = sphereRworld * localSeeded;           // 生长中的当前半径
    const sphereY = sphereR;                              // 球心离地 = 半径（贴地）
    const symbolSize = clamp(sphereRworld * 2 * pxPerWorldY * spherePxScale * localSeeded, 0, SPHERE_PX_MAX);
    // 像素下限：极端悬殊数据下最小球仍 ≥ SPHERE_PX_MIN（否则退化为噪点）。仅对已出现(local>0)生效。
    const symbolSizeFinal = localSeeded > 0.001 ? Math.max(symbolSize, SPHERE_PX_MIN * spherePxScale) : symbolSize;
    bars.push({
      name: rows[rowIdx].name,
      worldX: x,
      value: [x, 0, z],
      sphereValue: [x, 0, sphereY], // scatter3D 坐标：[x, 深度(0), 高度] —— 高度同样落在 zAxis3D，与 bar3D 同轴
      sphereR,
      symbolSize: symbolSizeFinal,
      real: v,
      ratio,
      hFrac,
      rank: n - k, // 升序第 k → 名次 n-k（1 为最大）
      // ★ v2.8.3：shown/grow 统一用 u（原始生长进度，未加种子）判定 ——
      //   grow 是"生长进度"语义量（0=未开始，1=已长成），加种子会污染
      //   FOLLOW_BIAS 的权重与 QA 断言（"0<grow<1 表示正在生长"）。
      //   shown 用 u>0：只要开始生长就算"已出现"，与种子高度无关（种子只改视觉，
      //   不改"是否已出现"的语义）。
      shown: localSeeded > 0.001,
      grow: u,
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
  // 【v2.8.1 修复③ · 相位冻结（freeze）——"尾部蹦跶"的真凶】
  //   实测（population，1280×720，步长 0.001）：cx 在 t≤0.720 恒为 93.871（**速度 0**，
  //   跟随期早已驻停），t=0.721 一帧跳 +6.13，随后一路**反向冲到 107.49**，再在 t≈0.86
  //   快速回落至 0。整体呈"先冲高再回落"的过冲 → 观感即"尾部蹦跶不停"。
  //   根因不在缓动，而在**起点不是常量**：
  //     过渡式 cx = lerp(cxFollowFinal, 0, us)，而 `cxFollowFinal` 由 cxFollow 求得，
  //     后者依赖 activeIdx 与 fracIn —— 二者**都随 t 继续变化**。
  //     于是 t>reveal 时 cxFollowFinal 仍在 93.871→107.49 增长，
  //     与 us(0→1) 的收缩方向**相反叠加**，产生过冲与后续回落（数值见上）。
  //   ★ 修复：把"跟随凝视点"的求值时间**冻结在 reveal**（tGaze = min(t, reveal)）。
  //     这样过渡期起点 = 常量 cxFollowFinal(reveal)，cx = lerp(C, 0, us) 严格单调、
  //     速度 = C·us'，两端速度都=0（smoothstep），且无过冲。
  const tGaze = Math.min(t, reveal);
  // ══════════ 【v2.9.0 修复⑤】连续注视点 —— 根治"每次换柱整屏硬跳" ══════════
  // 【实测根因】（scripts/qa/probe-cx.mjs，n=28 / 900 档采样，三画幅结果完全一致）：
  //   |Δcx| > 0.5 的硬跳 **143 处**；单次最大 |Δcx| = **6.00** 世界单位 ≈ 0.75×柱距(S=8)。
  //   其中 27 处与 activeIdx 切换同刻（= n−1，即每根柱一次），另有 116 处"额外跳"。
  //   ★ 两类跳变同源：注视点是 **离散柱序号** 的函数。
  //     · 旧式 activeIdxGaze = floor(t/step) 每 +1，curBar / nextBar / mid / w
  //       全部**整体右移一根** ⇒ 注视点必然硬切一个"柱距量级"的台阶；
  //       fracIn 只在单个 step 内部插值，**跨不过 step 边界**。
  //     · 额外跳来自 cxFollowRaw（活跃柱 ±2 窗口内 shown 柱的均值）：
  //       每有新柱 shown 翻转，均值集合跳变 ⇒ 又是一次台阶。
  //   ★ 为什么"所有比例都跳、且竖屏最惨"：单次台阶恒为 8 世界单位，
  //     但**占屏比 = 8 / 水平可视宽**，而水平可视宽 ∝ 真实 aspect（FOV=16 / d=87）：
  //         16:9 → 可视宽 43.47 ⇒ 5.43 根同屏 ⇒ 每跳 **18.4%** 屏宽
  //         4:3  → 32.61 ⇒ 4.08 根 ⇒ 24.5%
  //         1:1  → 24.45 ⇒ 3.06 根 ⇒ 32.7%
  //         9:16 → 13.76 ⇒ 1.72 根 ⇒ **58.2%** 屏宽   ← 近乎"整屏瞬移"
  //     这就是用户"所有比例中均会如视频所示跳动"的定量解释：不是某个比例的特例，
  //     而是**离散注视点 × 画幅越窄放大越狠**的必然结果。
  // 【修复·把注视点改成"时间的连续线性函数"，彻底不依赖离散序号】
  //   以连续游标 pCont = t/step ∈ [0, n−1] 取代柱序号：
  //       gaze = (−span/2 + pCont + LEAD) × S
  //   · **线性于 t** ⇒ 任意相邻帧 Δcx 恒定且极小（全程 ~207 单位 / ~625 档 ≈ 0.33），
  //     不存在任何台阶（位置 C⁰ 连续；速度仅末端 lead 收敛处有一处折点）。
  //   · LEAD = 0.5 ⇒ 注视点恒落在"相邻两柱中点"，天然满足 v2.8.3 的构图要求
  //     「同屏 ≥2 根、且其中一个正在生长」——t=0 即居中于 bar0/bar1。
  //   · 末端 taper：pCont → n−1 时 lead 用 smoothstep 平滑归零，注视点收束到
  //     最后一根柱中心，既不越过队尾（否则结尾右侧露空），速度也无突变。
  //   · 冻结性保持：仍用 tGaze = min(t, reveal) ⇒ t>reveal 后为常量，
  //     v2.8.1「尾部单调、无过冲」的结论不被破坏。
  // ★ 游标必须跟 **出生前沿**，而不是 t/step：
  //   第 k 根柱诞生于 t = k·step·STAGGER ⇒ 前沿 = t/(step·STAGGER)，
  //   比 t/step 快 1/STAGGER = 1.176×。若用 t/step 做游标，镜头会落后于
  //   "已长出来的柱阵"，实测开场柱阵被挤到画面左侧
  //   （bbox 中心仅 22%~24%，低于 QA 要求的 25% 中央带）。
  const pCont = clamp(tGaze / (step * STAGGER), 0, Math.max(n - 1, 0)); // 连续出生前沿
  const LEAD = -0.5;         // 注视点落在前沿**之后**半根 ⇒ 最新两根柱的中点
  const TAIL_TAPER = 1.0;    // 末端多少根柱的范围内把 lead 收敛到 0
  const tailLeft = clamp((Math.max(n - 1, 0) - pCont) / TAIL_TAPER, 0, 1);
  const taper = tailLeft * tailLeft * (3 - 2 * tailLeft);      // smoothstep（端点导数为 0）
  const qGaze = clamp(pCont + LEAD * taper, 0, Math.max(n - 1, 0));
  const cxFollow = (-span / 2 + qGaze) * S;

  // ★ v2.9.0：离散的「活跃柱 ±2 窗口均值」「grow 加权偏向中点」两级偏置**全部删除**。
  //   它们都以离散柱序号为自变量，是 143 处硬跳的直接来源；连续性已由上方
  //   「连续游标 + LEAD=0.5」在同一式内直接保证（注视点天然 = 相邻两柱中点），
  //   无需再用 grow 做权重去"渐入"——也就不会再有"权重跳变"这类额外台阶。
  const cxFollowTarget = cxFollow;

  // —— 水平轨道边界（防注视点冲出柱阵两端）——
  // 【旧行为】注视点限制在 [±(数据半宽 − 半窗×0.65)]：队首/队尾的柱停在画面
  //   ~18% / ~74% 处，中段跟随不变。此设计解决了"跟随到最后一根时右侧空半屏"。
  // 【v2.8.3 修复③：inset 过大导致"首柱不可见"】见下方 TRACK_INSET 处的完整推导与实测。
  // 【最终式·inset 再收】0.65（旧）→ 0.55（上一版）→ **0.20**（本版）。
  //   全程实测（scripts/qa/probe-firstbar.mjs + probe-follow-px.mjs）表明
  //   0.55 仍把相机挡在 -96：此时开场唯一/最左的柱被推到屏宽 18%~41%，
  //   左 18% 与右 60% 都是空的 —— 用户"首柱不可见"的观感依旧。
  //   几何上要"两柱（-108、-100）同框居中"，注视点须能到两柱中点 -104，
  //   即 trackEdge ≥ 104；而 halfVisW≈21.7 ⇒ inset ≤ (108−104)/21.7 ≈ 0.18。
  //   取 0.20（略保守，留一点余量避免端点柱贴边）。
  //   ★ 代价与权衡：端点处画面会露出一小段无柱区（约半窗的 20%，≈0.5 个柱距），
  //     但换来的是**开场与结尾的柱体都靠近画面中部、且两柱同框**——
  //     这正是用户明确要求的构图（"保持两个柱体在屏幕中，且其中一个为生长的"）。
  //     中段跟随（clamp 不触发区间）完全不受影响，与既有 QA 结论一致。
  const halfVisW = visW / 2;
  const TRACK_INSET = 0.20;
  const trackEdge = Math.max(0, (span / 2) * S - halfVisW * TRACK_INSET);
  const cxFollowFinal = clamp(cxFollowTarget, -trackEdge, trackEdge);

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
  const worldH = (boxH / ZMAX) * wideBoost; // ★ 全景终点柱高已含 wideBoost（cyWide 是 us=1 的目标值）
  const CY_GROUND = -1.2;   // 跟随期注视点：地面线下方一点（实测标定值）
  const K_GAZE_WIDE = 0.62; // 全景期注视点系数
  // 球体内容矮（≈ 最大球直径），沿用"地面线在 85% 屏高"的长柱构图会把球顶到画面上部、
  // 下半留白。球体模式改把注视点抬到球群上方，使球群落在画面中下部（~58% 屏高）：
  //   · 球群世界中心 ≈ sphereWorldMaxR（球心离地=半径，最大球直径竖向中心即半径处）；
  //   · 但相机注视点抬升量须随**可视高**（visHWide）换算——n 大时相机远、可视高很大，
  //     固定世界增量根本无法把球群推下来（实测 n=28 时 cy 需 ≈26 才居中，而 n=14 只需 ≈10）。
  //   · 故：cy = 球群中心 + 可视高的一个固定比例（SPHERE_GAZE_K），对任意 n 自动适配。
  //     实测（1280×720）：SPHERE_GAZE_K=0.30 时 n=28/n=14 球群分别稳定落在 ~57%/~58% 屏高。
  const visHWide = 2 * wideDist * Math.tan((FOV / 2) * Math.PI / 180);
  // 全景期**水平**可视宽（世界单位）：与 visHWide（=可视高）的关系由画幅比决定。
  //   visHWide 是"竖直"可视高（2·d·tan(fov/2)，与 aspect 无关）；
  //   水平可视宽 = visHWide × aspectTrue。避让量按水平方向推导时用它。
  const visHWideX = visHWide * aspectTrue;
  const sphereContentMid = sphereWorldMaxR;
  // 【竖屏收窄 gaze】竖屏 aspect 小 → wideDist 大 → visHWide 大，同一系数会把球群推得过低
  //   （实测 900×1200 球群贴底）。故系数按 aspect 归一：宽屏用 SPHERE_GAZE_K，竖屏等比减小
  //   （用真实 aspect 与基准 1.78 的比值，clamp 到 [0.35,1]），保持"球群略低于画面中线"。
  const gazeK = SPHERE_GAZE_K * clamp(aspect / 1.78, 0.35, 1);
  const cyFollow = isSphere(props.shape) ? sphereContentMid + visH * gazeK : CY_GROUND;
  // 【柱体全景注视点：随可视高换算，而非固定 = worldH × 0.62】
  //   旧实现 cyWide = worldH × K_GAZE_WIDE（worldH 与相机距离无关）。这在 16:9 下恰好把
  //   柱阵放在画面中下部；但当画幅更"方/竖"时，wideDist 变大 → 可视高 visHWide 变大，
  //   同一个 cy 只能把柱阵顶到画面上半部，下方留下大片空白（1:1 / 9:16 实测即如此，
  //   与球体模式当年遇到的问题同源）。
  //   → 改用与可视高成比例的表达：让柱体视觉中心（世界高度 worldH/2）落在画面中线附近。
  //     相机注视点 = 柱体中心 + 可视高 × k；取 k = 0 时柱体中心恰在中线，
  //     略取正值把柱阵再下压一点（保留地平线在下的透视感，且给顶部标签留位）。
  //     该式与相机距离解耦 → 任何画幅、任何 n 都自动居中。
  //     配合 hBoost（世界柱高随相机拉远同步抬升），全景期柱阵在四画幅下
  //     竖向占比稳定落在 40%~70% 区间，不再出现"细带浮空"。
  const K_WIDE_GAZE_H = -0.06; // 柱阵视觉中心相对画面中线的下移量（可视高比例）
  const cyWide = isSphere(props.shape)
    ? sphereContentMid + visHWide * gazeK
    : worldH * 0.5 + visHWide * K_WIDE_GAZE_H;

  // ══════════ 【v2.8.3 修复①】信息层安全区避让 ══════════
  // 【原始问题实测】信息层（标题 / 当前目标面板 / 来源备注）与柱体的重叠率：
  //     16:9  目标 21.5% · 来源  0.0%
  //     4:3   目标 11.3% · 来源 33.6%
  //     1:1   目标 24.0% · 来源 53.8%
  //     9:16  目标 70.8% · 来源 81.1%   ← 近乎完全穿透，用户报"多数比例遮挡柱体严重"
  //   占比来源（scripts/qa/probe-layout.mjs，相对取景框的百分比包围盒）：
  //     横屏：目标面板 x=3%~20% y=39%~61%；来源 x=3%~27% y=89%~96%
  //     竖屏：目标面板 x=5.5%~68% y=57%~81%；来源 x=38.5%~94.5% y=80%~96%
  //   → 其中最凶的元凶是**当前目标面板**：竖屏下宽达取景框 62.7%、纵跨 57%~81%，
  //     横跨中线，使"左中/左下/右下"三块同时被占，柱阵无处可躲。
  // 【最终方案·两段式】
  //   ① 结构性消除（本版执行）：用户指令「干脆移除当前目标卡」。
  //      移除后信息层只剩 标题（左上）/ 视图徽标（右上）/ 来源备注（横屏左下、竖屏右下）
  //      —— 三块**全部贴边**，画面中央与两侧主体完全让给柱阵。
  //      这是比"挪构图去躲面板"更彻底的解法：不再是"柱阵绕开面板"，
  //      而是"面板退到边缘"。
  //   ② 构图微调（保留，仅竖屏）：竖屏下来源备注移到右下、标题压在左上、副标题限 2 行，
  //      纵向仍占用底部 ~15% 带。为保险起见，竖屏全景期把柱阵注视点**略抬**
  //      （cyWideSafe），使柱阵视觉主体落在"中上带"，与贴边的信息层零重叠。
  //      横屏不做任何位移 —— 贴边信息层与居中柱阵本就重叠极小（16:9 来源 0.0%），
  //      且既有 16:9 验收断言依赖 cx→0 的居中构图。
  //
  //   ★ 方向语义备忘（垂直）：cy 是"相机注视点高度"。cy **越大** → 相机看向更高处 →
  //     世界中的柱阵在画面上**越往下**（实测 cy ∈ [-80,60] 扫描：cy=-80→柱体 26%~39%，
  //     cy=+60→48%~63%）。故要让柱阵在画面上移，必须让 cy **减小**。
  //   ★★ 量纲陷阱：`viewControl.center` 会被 echarts-gl 钳制在 **box 尺寸范围内**
  //     （此处 boxHeight≈24 世界单位 ⇒ 有效范围约 ±12）。曾按 visHWide（竖屏≈556）
  //     推导避让量 −83，远超 box → 被静默钳到 −12，与未避让几乎等效。
  //     → 让位量必须用 **boxH 的比例**表达。
  const vpPortrait = aspect < 1; // 与 DOM 侧 .viewport.portrait / overlay.js 同口径（取景框 w/h < 1）
  const cxAvoidWorld = 0;        // 横/竖屏均不做水平位移（信息层已贴边）
  // 竖屏：注视点抬高 0.5×boxH → 实测柱体落在画面 26%~39% 纵带（信息层在 57% 以下），零重叠。
  const cyAvoidWorld = vpPortrait ? -boxH * 0.5 : 0;
  const cyWideSafe = cyWide + cyAvoidWorld;

  // 俯仰：跟随期近平视（柱体立面完整、棱线竖直）；全景期略俯视（顶面进深感）。
  const alphaFollow = ALPHA_FOLLOW;

  // —— 跟随 → 全景 的过渡（C¹ 连续，杜绝"尾部蹦跶"）——
  // 【缺陷复盘 · 用户报"3.视频尾部是过渡存在问题，尤其展示全局的过程蹦跶不停"】
  //   实测（population，1280×720，t 步长 0.001；探针 scripts/qa/probe-tail2.mjs）：
  //     t ≤ 0.720  cx = 93.871 **恒定**（跟随期早已驻停，速度为 0）
  //     t = 0.721  cx 一帧 **跳 +6.1309**        ← 阶跃（Δ² 峰值 8.06）
  //     t ∈ (0.72, 0.86)  cx 继续**反向增长到 107.49**（远离目标 0）
  //     t ∈ (0.86, 1.00)  cx 才快速回落到 0
  //   → 整体是"猛一跳 + 先冲高再回落"的过冲，视觉上就是镜头在全局展示阶段"蹦跶不停"。
  //   ★ 两个叠加的根因（缺一不可，只修一个仍会抖）：
  //     ① 起点跨分支不一致：跟随期用 `cxFollowFinal`（clamp 进轨道 = 93.871），
  //        过渡期却从 `lerp(cxFollow, 0, u)` 用**未 clamp 的 cxFollow** 出发
  //        （同帧 cxFollow ≈ 100.01）⇒ t 过 reveal 首帧硬切 +6.13。
  //     ② **起点仍在随时间漂移**：`cxFollowFinal` 由 activeIdx / fracIn 求得，
  //        二者都随 t 变化；t>reveal 时它继续从 93.871 涨到 107.49。
  //        于是 `lerp(cxFollowFinal, 0, us)` 里"被插值量增大"与"us 收缩"方向相反
  //        ⇒ 过冲。仅把①统一为 cxFollowFinal **不足以**消除抖动（漂移仍在）。
  //   ★ 修复：
  //     ① 两端同源 → 统一用 `cxFollowFinal`；
  //     ② 起点冻结 → 凝视点求值改用 tGaze = min(t, reveal)（见上方 tGaze 处），
  //        使 `t>reveal` 时 cxFollowFinal ≡ C（常量）⇒ cx = lerp(C, 0, us) 严格单调、
  //        无过冲，速度 = C·us'，两端均为 0（smoothstep 的端点导数性质）。
  const inTail = t > reveal;
  const u = inTail ? clamp((t - reveal) / (1 - reveal), 0, 1) : 0;
  // smoothstep：S(u)=3u²-2u³，S(0)=0、S'(0)=0、S(1)=1、S'(1)=0 —— 两端零速度。
  const us = u * u * (3 - 2 * u);
  // alpha/beta/distance/cy 的过渡无历史包袱（跟随期本为常量），沿用 easeInOut 亦可，
  // 但为与 cx 同步（同一 u、同一观感曲线）统一改用 smoothstep。
  let alpha = inTail ? lerp(alphaFollow, ALPHA_WIDE, us) : alphaFollow;
  let beta = inTail ? lerp(4, 8, us) : 4;
  let distance = inTail ? lerp(followDist, wideDist, us) : followDist;
  // ★ 起点 = 跟随期终点（同一 cxFollowFinal，且已冻结在 reveal ⇒ 常量），
  //   不再混用未 clamp 的 cxFollow，也不再有"起点自身漂移"导致的过冲。
  // ★ 终点 = 避让后的全景目标（cxAvoidWorld / cyWideSafe），而非硬编码的 0。
  //   （let 声明：下方 ?cam= 调试钩子需要就地覆写这三个/两个量做离线标定。）
  let cx = inTail ? lerp(cxFollowFinal, cxAvoidWorld, us) : cxFollowFinal;
  let cy = inTail ? lerp(cyFollow, cyWideSafe, us) : cyFollow;

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

  // ★ 全景期柱体尺寸补偿的**渐进应用**：跟随期 us=0 → 几何与原版完全一致；
  //   过渡期随 us 从 1 → wideBoost 平滑放大（与相机拉远同步，观感即"拉远时柱阵
  //   迎面生长"的电影感补偿）；全景期 us=1 → 完整补偿。宽屏 wideBoost=1 全程无变化。
  const boostK = lerp(1, wideBoost, us);
  return {
    bars,
    camera: { alpha, beta, distance, center: [cx, cy, 0], fov: FOV },
    activeIdx,
    revealed,
    theme: th,
    boxW, boxD,
    boxH: boxH * boostK,
    barW: barW * boostK,
    barD: barD * boostK,
    xPad,
    shape, sphereWorldMinR, sphereWorldMaxR, pxPerWorldY,
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
let lastBuiltShape = null; // 上次构建所用的形状（变化时需强制全量重建，见 applyFrame）
function initChart() {
  if (!el.value) return;
  if (chart) {
    try { chart.dispose(); } catch { /* 已失效实例，忽略 */ }
    chart = null;
  }
  sceneBuilt = false; // 新实例必须重新全量构建
  lastBuiltShape = null;
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
  const geom = shapeGeom(f.shape);
  const sphere = isSphere(f.shape);

  // —— 逐项 data 构造（bar3D / scatter3D 共用）——
  // merge 逐帧更新时，上一帧 item 的 label 不会自动清除，必须**每帧显式**
  // 声明 show 与内容，否则"上一帧有标签、这一帧不该有"的柱子会残留旧标签。
  // 常量字符串 formatter：echarts-gl 只认常量配置（函数式会被静默忽略，
  // 且空文本会中断整个标签循环）——逐项开关 show 即可，安全且无重叠。
  // 注：scatter3D 的 label 走同一 LabelsBuilder，限制一致。
  const mkItem = (b) => {
    const it = {
      name: b.name,
      value: sphere ? b.sphereValue : b.value,
      itemStyle: { color: rgbStr(b.color), opacity: 1 },
      label: b.showLabel ? { show: true, formatter: b.labelText } : { show: false },
    };
    if (sphere) it.symbolSize = b.symbolSize; // scatter3D：逐项像素直径
    return it;
  };

  // —— 系列：按形状选择 bar3D 家族 或 scatter3D 家族（球体为多层叠加） ——
  // 两者可共存于同一 grid3D；此处二选一渲染。
  let glowSeries, mainSeries, midSeries, specSeries = null;
  // 圆柱模式：逐柱一个 surface 系列，挂在 mainSeries 之外单独持有
  let cylSeriesHolder = null;
  const labelStyle = {
    show: false,
    position: 'top',
    distance: sphere ? 6 : 0.6, // scatter3D 的 label distance 为像素量级
    // ★ opacity: 1 必须显式声明：LabelsBuilder 计算标签文字透明度时
    //   按 [label.opacity, itemStyle.opacity, 1] 取第一个非空值 ——
    //   圆柱模式的标签承载系列数据项 opacity=0（隐形符号），
    //   若此处不显式给 1，标签会随之透明（实测标签"消失"的根因）。
    opacity: 1,
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
  };

  if (sphere) {
    // —— 球体：scatter3D 四层同心叠加（伪立体）——
    // scatter3D 的符号是恒正对相机的贴片，无光照 → 单层只是扁圆点。四层同中心叠加，
    // 形成"外圈暗辉光 → 本色球体 → 略亮过渡 → 中心近白高光"的径向明暗梯度：
    //   ① glow  环境光晕：大一圈、低透明、同色（lighter）→ 边缘"透光"辉光；
    //   ② main  主体球：本色实心 → 球体本体（提供清晰边界）；
    //   ③ mid   过渡层  ：0.78×、本色微提亮 → 抹掉 main/spec 之间的硬边，让明暗连续；
    //   ④ spec  高光芯  ：0.40×、近白 → 受光高光，是"球体感"的视觉核心。
    // 生长动画：各层 symbolSize 同步由 0→目标（见 computeFrame 的 local 因子）。
    // 【为什么不用偏移高光】perspective + billboard 贴片下，靠世界坐标偏移把高光放到
    //   球面特定位置极不稳定（X 步距=1.0 世界单位、球半径≈1.0，偏移稍大就飞出球外，
    //   实测出现"灰点悬浮在球上方"）。改走"同心明暗"——几何与球体完全锁定，
    //   任何视角/缩放都稳，明暗过渡天然模拟球面受光。
    const shownBars = f.bars.filter((b) => b.shown);
    const sz = (b, k) => Math.max(b.symbolSize * k, 2);
    glowSeries = {
      type: 'scatter3D',
      name: 'glow',
      symbol: 'circle',
      silent: true,
      label: { show: false },
      blendMode: 'lighter', // 叠加发光
      itemStyle: { opacity: 0.16 },
      data: shownBars.map((b) => ({
        value: b.sphereValue,
        symbolSize: Math.min(b.symbolSize * SPHERE_ATMO_K, SPHERE_PX_MAX + 20),
        itemStyle: { color: rgbStr(b.color), opacity: 0.16 },
      })),
    };
    mainSeries = {
      type: 'scatter3D',
      name: 'main',
      symbol: 'circle',
      data: shownBars.map(mkItem),
      label: labelStyle,
      itemStyle: { opacity: 1 },
      emphasis: { itemStyle: { opacity: 1 } },
    };
    midSeries = {
      type: 'scatter3D',
      name: 'mid',
      symbol: 'circle',
      silent: true,
      label: { show: false },
      blendMode: 'lighter',
      data: shownBars.map((b) => ({
        value: b.sphereValue, // 与主体同心同高
        symbolSize: sz(b, SPHERE_MID_K),
        itemStyle: { color: rgbStr(mixWhite(b.color, 0.22)), opacity: 0.34 },
      })),
    };
    specSeries = {
      type: 'scatter3D',
      name: 'spec',
      symbol: 'circle',
      silent: true,
      label: { show: false },
      blendMode: 'lighter',
      data: shownBars.map((b) => ({
        value: b.sphereValue, // 与主体同心同高
        symbolSize: sz(b, SPHERE_CORE_K),
        itemStyle: { color: '#f2ffff', opacity: 0.42 },
      })),
    };
  } else if (isCylinder(f.shape)) {
    // —— 真圆柱：surface 参数化（每根柱子一个 surface 系列）——
    // 【为什么不用 bar3D】见 SHAPE_GEOM 处注释：bar3D 的 bevel 会同时圆化端面，
    //   bevel=1.0 得到的是胶囊而非圆柱（垂直剖面实测证实：top=0.05 尖角）。
    // 【为什么一个圆柱一个系列】surface 的 data 是**一张连通网格**，无法在一张网格里
    //   容纳多个互不相连的圆柱；故逐柱生成独立系列。
    //   echarts-gl 可承受（每系列顶点 = (segU+1)(segV+1) ≈ 41×27 ≈ 1107）。
    const shownBars = f.bars.filter((b) => b.shown);
    // ★ 单位换算（surface 与 bar3D 的坐标系尺度不同，这是本实现最容易错的地方）：
    //   · bar3D 的 barSize 直接是**世界单位**（bar3D 内部按 grid3D 的世界盒换算）；
    //   · surface 的 data 是**数据坐标**，经 xAxis3D/yAxis3D 的 [min,max] 映射到世界盒。
    //   x 轴：数据跨度 xRange → 世界 boxW = S × xRange ⇒ 1 数据单位 = S 世界单位。
    //   y 轴：数据跨度 1.7   → 世界 boxD = S × 1.7    ⇒ 1 数据单位 = S 世界单位。
    //   故「世界柱宽 barW」换算到数据单位须 **除以 S**；漏除会放大 S=8 倍
    //   （实测漏除时圆柱直径是方柱的 8 倍，画面只剩 6 根巨大柱）。
    const cylRdata = f.barW / 2 / S;          // 半径（数据单位）← 世界半径 / S
    const xDataOf = (b) => b.worldX;          // b.worldX = -span/2 + k，本身就是 xAxis3D 数据坐标（直接用）
    // 柱高：zAxis3D 的 [min,max] = [0, ZMAX]，boxH = worldMaxH × ZMAX
    //   ⇒ 1 数据单位(z) = boxH / ZMAX 世界单位。故「世界高度」换算到 z 数据须 × ZMAX / boxH。
    const zDataOf = (b) => Math.max((b.value ? b.value[2] : 0), 0.0001); // z 本身已是数据单位
    cylSeriesHolder = shownBars.map((b, k) => ({
      type: 'surface',
      name: `cyl_${k}`,
      shading: 'lambert',
      wireframe: { show: false },
      silent: true,
      itemStyle: { color: rgbStr(b.color), opacity: 1 },
      data: cylData(xDataOf(b), 0, cylRdata, zDataOf(b)),
      parametric: true,
      // 占位参数：真实几何在 data 里；但 parametric:true 时 surface 会校验这三个函数，
      // 缺失会走 equation 分支报错，故给恒等函数占位。
      parametricEquation: {
        u: { min: 0, max: 1, step: 1 },
        v: { min: 0, max: 1, step: 1 },
        x: (a) => a, y: (a) => a, z: (a) => a,
      },
    }));
    // 标签承载：surface 不支持逐项标签。用 scatter3D（symbolSize≈0 的隐形点）
    // 挂标签 —— scatter3D 与 bar3D 共用 LabelsBuilder（球体模式已验证该路径），
    // 数据点 = [x, 0, z]（与 bar3D 同坐标系，label position:top 恰好落在柱顶上方）。
    // ★ 不用透明的 bar3D 承载：实测 bar3D itemStyle.opacity:0 时其标签同样不渲染
    //   （标签随柱体网格构建），而 scatter3D 的 label 与符号无关、独立绘制。
    mainSeries = {
      type: 'scatter3D',
      name: 'labelCarrier',
      symbol: 'circle',
      symbolSize: 1,
      silent: true,
      itemStyle: { opacity: 0 },
      data: shownBars.map((b) => ({
        name: b.name,
        value: b.value,
        itemStyle: { opacity: 0 },
        label: b.showLabel ? { show: true, formatter: b.labelText } : { show: false },
      })),
      label: labelStyle,
    };
    glowSeries = null;
  } else {
    // —— bar3D 家族：bar / cube / rounded（bevel + 截面按形状参数化） ——
    const base = {
      type: 'bar3D',
      shading: 'lambert',
      bevelSize: geom.bevel,
      bevelSmoothness: geom.smooth,
    };
    // cube 用正方形截面（宽=深），圆润形状更协调
    const barD = geom.square ? f.barW : f.barD;
    glowSeries = {
      ...base,
      name: 'glow',
      barSize: [f.barW * GLOW_K, barD * GLOW_K],
      silent: true,
      label: { show: false },
      data: f.bars.filter((b) => b.shown).map((b) => ({
        value: b.value,
        itemStyle: { color: rgbStr(b.color), opacity: 0.2 },
      })),
    };
    mainSeries = {
      ...base,
      name: 'main',
      barSize: [f.barW, barD],
      data: f.bars.filter((b) => b.shown).map(mkItem),
      label: labelStyle,
      emphasis: { itemStyle: { opacity: 1 } },
      itemStyle: { opacity: 1 },
    };
  }

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
        // 【maxDistance 必须覆盖全景请求距离，否则被静默钳制】
        //   旧实现 boxW*4：16:9 全景请求 ~308 < 457 ✓ 不触发；但竖屏（9:16）全景
        //   需按真实 aspect 反推距离 ~830+ ≫ 457 → 被钳到 457 → 可视宽 < 柱阵跨度
        //   → 柱阵左右两端直接出画（v2.6 竖屏构图塌陷的真正根因，相机回读实测证实：
        //   请求 834.5，GL 实际 457.7 = boxW*4）。故取"原上限与请求距离的较大者"，
        //   既不破坏既有交互缩放上限，又保证程序化全景取景总能生效。
        maxDistance: Math.max(f.boxW * 4, f.camera.distance * 1.25),
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
    series: cylSeriesHolder
      // 圆柱模式：surface 系列 + 透明的标签承载系列
      ? [...cylSeriesHolder, mainSeries]
      : (specSeries
        ? [glowSeries, mainSeries, midSeries, specSeries]
        : [glowSeries, mainSeries]),
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
  // 【形状切换需全量重建】series 的 type 会随形状在 bar3D ↔ scatter3D 之间变化，
  // merge 增量更新无法跨类型复用旧的 GL 网格（会残留/错位）。故形状变化时强制
  // notMerge 重建一次，之后恢复逐帧 merge。
  if (f.shape !== lastBuiltShape) sceneBuilt = false;
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
  lastBuiltShape = f.shape;
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
      shape: f.shape,
      activeIdx: f.activeIdx,
      camera: { alpha: f.camera.alpha, beta: f.camera.beta, distance: +f.camera.distance.toFixed(2), center: f.camera.center.map((v) => +v.toFixed(2)) },
      bars: f.bars.map((b) => ({ x: +(b.value[0]).toFixed(2), z: +(b.value[2]).toFixed(3), ratio: +b.ratio.toFixed(3), shown: b.shown, rank: b.rank, symbolSize: b.symbolSize != null ? +b.symbolSize.toFixed(1) : undefined })),
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
// ★ v2.8.3 新增：**用户暂停**标记（与 recording 严格区分）。
//   · recording 是「导出录制」内部状态 —— 由 beginRecord/endRecord 控制，
//     期间时间轴由外部 renderAt(t) 驱动，且必须在 endRecord 后恢复自动播放；
//   · paused  是「用户交互」状态 —— 由暂停按钮 / 空格键切换，
//     期间冻结时间轴（循环不再推进 p），保留在暂停那一刻的画面。
//   两者互不干扰：导出时若正处于暂停态，beginRecord 会先解除暂停（见其实现），
//   导出结束由 endRecord 恢复自动播放；而 paused 状态在导出前后一致地保持"用户意图"。
//   之所以不合并为一个标记：录制结束后必须自动续播（导出流程的既有契约，
//   verify-playback 依赖），而用户暂停后**必须保持停住** —— 语义相反，不能共用。
let paused = false;
// 播放期渲染节流：GL 场景单帧更新在中低端 GPU / 软件渲染下可达数十毫秒，
// 若每 rAF（60fps）都更新会持续积压、画面卡死甚至黑屏。这里把**渲染**上限
// 限制在 PLAY_MAX_FPS；时间轴仍按真实时间推进（p 取自 now-t0），因此动画
// 总时长不变，仅画面更新频率自适应降档。30fps 对柱状生长动画完全够流畅。
const PLAY_MAX_FPS = 30;
const PLAY_MIN_DT = 1000 / PLAY_MAX_FPS;
let lastPlayRender = 0;
// 最近一帧 setOption 实测耗时（ms），用于自适应判断是否需要降档诊断。
let lastApplyCost = 0;
// ★ v2.8.3：暂停/续播时间账本。
//   直接复用 t0 并不可行 —— t0 是"起始时刻"，暂停 5s 后继续会让 (now-t0) 多出 5s，
//   画面直接跳到后面。故暂停时记录已播时长 pausedAtMs，续播时把 t0 反推回去：
//     t0 = now - pausedAtMs   ⇒   (now - t0) 恰等于暂停前的已播时长，无缝衔接。
let pausedAtMs = 0;
function loop(now) {
  if (props.captureT != null || recording || isContextLost.value) return;
  // 用户暂停：不再排下一帧（循环真正停止，避免空转），时间轴冻结在 pausedAtMs。
  // 续播由 resume() 重新 requestAnimationFrame(loop) 启动。
  if (paused) { rafId = null; return; }
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
  paused = false; // ★ 重播 = 从头播 → 必然解除暂停
  pausedAtMs = 0;
  // 上下文丢失期间不启动循环，待恢复事件触发后再由 restored 回调续播
  if (props.captureT != null || recording || isContextLost.value) return;
  rafId = requestAnimationFrame(loop);
}

// ★ v2.8.3 新增：暂停 / 续播（供底部「暂停」按钮与空格键调用）
//   pause()  —— 冻结时间轴，保留当前帧（不重绘，画面纹丝不动）。
//   resume() —— 从冻结的进度无缝续播（反推 t0，见 pausedAtMs 注释）。
//   返回布尔值表示"操作后是否处于暂停态"，方便调用方同步按钮文案。
function pause() {
  if (props.captureT != null || recording) return false; // 出片/录制链路不受交互暂停影响
  if (paused) return true;                                // 幂等
  paused = true;
  // 已播时长：t0 为 0（尚未开播）时取 0，否则取真实经过时间
  pausedAtMs = t0 ? Math.max(0, performance.now() - t0) : 0;
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  emit('paused', true);
  return true;
}
function resume() {
  if (!paused) return false; // 未暂停则无需处理
  paused = false;
  if (props.captureT != null || recording || isContextLost.value) { emit('paused', false); return false; }
  // ★ 无缝续播的关键：把起始时刻反推，使 (now - t0) == 暂停前已播时长。
  //   t0 置 0 会让下一帧走 `if (!t0) { t0 = now; }` 分支 → 进度归零重播（错误）。
  t0 = performance.now() - pausedAtMs;
  lastPlayRender = 0; // 立即渲染一帧，避免续播后第一帧被节流吞掉
  if (rafId) cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(loop);
  emit('paused', false);
  return false;
}
function togglePause() { return paused ? resume() : pause(); }
// 播放进度（0..1）查询：供 QA 断言"暂停期间进度不再推进"。
function getProgress() { return lastRenderedT; }
function isPaused() { return paused; }

// —— 导出接口：确定性逐帧渲染 ——
// beginRecord()：暂停实时循环并回到 t=0；renderAt(t)：渲染指定进度；endRecord()：恢复。
function beginRecord() {
  // ★ v2.8.3：进入导出录制前，先解除"用户暂停"。
  //   否则录制期间 paused=true 会让 loop() 直接 return（见 loop 首行），
  //   导致 endRecord()→play() 之后画面仍不播（录制后"卡住"）。
  //   导出本就是"从头完整录一遍"，与用户暂停意图无关，故此处清标记是安全的。
  //   注：endRecord 会走 play()，其内部也会重置 paused/pausedAtMs（双保险）。
  paused = false;
  pausedAtMs = 0;
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

// ================= 容器尺寸监听（画幅比例的真正驱动源）=================
// ★ 关键修复（画幅比例失效的根因）：
//   取景框 .viewport 的尺寸由 --vp-w/--vp-h 驱动，切换画幅比例（16:9→9:16 …）
//   只改这两个变量 → **窗口尺寸完全不变** → 仅监听 window.resize 的 chart.resize()
//   永远不会触发 → ECharts 画布停留在旧像素尺寸。
//   实测（1440×900 窗口，切四种比例）：.viewport 正确变成 456×810 / 810×810 /
//   1080×810，但 .bar-race canvas 恒为 1354×761（=首次布局尺寸，比取景框还宽）
//   → 画面被按错误比例渲染 → 「预览所见 ≠ 出片所得」。
//   改用 ResizeObserver 监听**容器自身的盒尺寸**：无论尺寸变化来自窗口还是画幅切换，
//   都能触发 resize，且与 ECharts 文档推荐做法一致。
let ro = null;
function onContainerResize() {
  if (isContextLost.value) return;
  if (!chart) return;
  chart.resize();
  // ★ resize 后必须**用新尺寸重算并重绘当前帧**：
  //   computeFrame 读的是容器实时 clientWidth/Height（→ aspect），而 chart.resize()
  //   只改画布像素尺寸、不重算场景。若此刻动画已停（如出片截帧 t=1、或暂停态），
  //   不主动补一帧的话，画面会停留在"旧 aspect 的场景 + 新尺寸的画布"的错配状态。
  //   播放中则无妨（下一帧自然用新尺寸），此处统一补帧保证任何状态下都立即生效。
  applyFrame(lastRenderedT);
}
onMounted(async () => {
  await nextTick();
  initChart();
  render();
  window.addEventListener('resize', resize);
  // 容器尺寸变化（含画幅比例切换）→ 同步 ECharts 画布尺寸
  if (el.value && typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(onContainerResize);
    ro.observe(el.value);
  }
});
onBeforeUnmount(() => {
  window.removeEventListener('resize', resize);
  if (ro) { ro.disconnect(); ro = null; }
  detachContextWatchers();
  if (rafId) cancelAnimationFrame(rafId);
  chart && chart.dispose();
  chart = null;
});

watch(() => props.captureT, () => render());
watch(() => [props.items, props.theme, props.unit, props.fixed, props.reveal, props.duration, props.shape], () => render(), { deep: true });

defineExpose({
  replay: play, render, computeFrame, beginRecord, renderAt, endRecord, getCanvas,
  // ★ v2.8.3：暂停 / 续播（底部按钮 + 空格键调用；仅影响预览播放，不参与导出确定性链路）
  pause, resume, togglePause, isPaused, getProgress,
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
