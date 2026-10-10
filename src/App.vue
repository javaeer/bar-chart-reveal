<template>
  <div class="stage" :class="{ 'frame-on': !capture }" :style="cssVars">
    <!-- 透视网格地面（科技感"甲板"）/ 地平线辉光：跟随主题是否启用 HUD -->
    <template v-if="theme.hud">
      <div class="grid-floor" aria-hidden="true"></div>
      <div class="horizon" aria-hidden="true"></div>
      <div class="hud" aria-hidden="true">
        <span class="corner tl"></span><span class="corner tr"></span>
        <span class="corner bl"></span><span class="corner br"></span>
        <div class="scanline"></div>
      </div>
    </template>

    <!-- ★ 取景框（viewport）：画幅比例的**单一事实源**。
         以--vp-w/--vp-h 给出内接矩形尺寸（由 aspectRatio 计算），
         3D 画布只铺满它 → BarRace3D 读到的 aspect 恒等于所选比例，
         故"预览所见 = 导出所得"。出片模式（capture）下铺满整屏。

         v2.7：标题 / 当前目标等信息**移入取景框内部**，成为画面的一部分
         （导出视频同样带标题与目标卡片）。它们以 --vp-w/--vp-h 为坐标系
         绝对定位，故任何画幅比例下都按比例落在画面内，不会溢出到框外。 -->
    <!-- ★ portrait 类：由**取景框**宽高比驱动（JS 计算），而非窗口媒体查询。
         与 paintOverlay 的 portrait 判定（size.w/size.h < 1）保持同一口径，
         保证「编辑态所见 = 录制所得」—— 例如宽屏窗口里切 9:16 画幅时，
         画面内目标卡/来源的落位必须与导出视频一致（v2.7.1 修复）。 -->
    <div class="viewport" :class="{ portrait: vpPortrait }">
      <BarRace3D
        ref="chartRef"
        :items="activeView.items"
        :unit="activeView.unit"
        :fixed="activeView.fixed"
        :theme="theme"
        :shape="shapeKey"
        :reveal="config.revealRatio"
        :duration="config.durationMs"
        :capture-t="captureT"
        @active="onActive"
        @paused="onPaused"
      />

      <!-- ★ 画面内信息层（overlay）：随取景框缩放，属于"视频内容"的一部分。
           与 .stage-ui（屏幕级 UI，出片时隐藏）明确分层：
             · .vp-overlay  → 进画面（导出可见）
             · .stage-ui    → 屏幕 UI（编辑态辅助，出片隐藏） -->
      <div class="vp-overlay">
        <!-- 标题 / 副标题：左上角，宽度以取景框为单位限幅 -->
        <header>
          <div class="brand">
            <span class="dot"></span>
            <h1>{{ config.title || '3D 柱状对比' }}</h1>
          </div>
          <div v-if="config.subtitle" class="sub">{{ config.subtitle }}</div>
        </header>

        <!-- 当前视图徽标：右上角（画面内），出片时保留 -->
        <div class="metric-chip">
          <span class="k">当前视图</span>
          <span class="v">{{ activeView.label }}<i v-if="activeView.unit"> · {{ activeView.unit }}</i></span>
        </div>

        <!-- 数据来源 / 备注：左下角（画面内），有内容才渲染 -->
        <div v-if="config.source || (config.notes && config.notes.length)" class="vp-source">
          <div v-if="config.source" class="src-line">{{ config.source }}</div>
          <div v-for="(nt, i) in config.notes" :key="i" class="note-line">{{ nt }}</div>
        </div>
      </div>

      <!-- 画幅描边 + 比例标签：仅编辑态显示，出片时隐藏（不进画面） -->
      <div v-if="!capture" class="frame-ring" aria-hidden="true">
        <span class="frame-tag">{{ config.aspect }} · {{ framePx }}</span>
      </div>
    </div>

    <!-- 屏幕级 UI 层已合并到 .viewport 内的 .vp-overlay（画面内容）。
         保留此注释块说明分层：出片（capture）时画面内容照常导出，
         而 MetricBar（含并入的数据分组）/ DataTable / InfoPanel / .hint
         各自带 capture 判断并隐藏，不进画面。 -->

    <!-- v2.7.1：原右上角 DataToolbar 已并入 MetricBar 的「数据」分组，
         形成单一右侧控制栏（数据与视图一处管完），不再单独挂载。 -->
    <MetricBar
      :capture="capture"
      :view-key="viewKey"
      :theme-key="themeKey"
      :shape-key="shapeKey"
      :aspect-key="config.aspect"
      :interval-ms="config.barIntervalMs"
      :duration-ms="config.durationMs"
      :duration-locked="dsState.durationLocked"
      :paused="playPaused"
      @update:view="setView"
      @update:theme="setTheme"
      @update:shape="setShape"
      @update:aspect="setAspect"
      @update:interval="setBarInterval"
      @update:duration="setDuration"
      @replay="onReplay"
      @toggle-pause="onTogglePause"
      @open-table="tableOpen = true"
      @open-info="infoOpen = true"
    />

    <DataTable
      v-model:open="tableOpen"
      :rows="activeView.items"
      :view-label="activeView.label"
      :unit="activeView.unit"
      @apply="onApply"
    />

    <!-- 信息编辑面板：标题 / 来源 / 备注（对应 v2 模板 dataset.name / source / notes） -->
    <InfoPanel
      v-model:open="infoOpen"
      :title="config.title"
      :subtitle="config.subtitle"
      :source="config.source"
      :notes="config.notes"
      @apply="onApplyMeta"
    />

    <div class="hint" :class="{ hidden: capture }">
      拖拽旋转 · 滚轮缩放 · 空格暂停/继续 · 数据可编辑 / 可导入导出 · 比例与时长可调
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watchEffect, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import BarRace3D from './components/BarRace3D.vue';
import MetricBar from './components/MetricBar.vue';
import DataTable from './components/DataTable.vue';
import InfoPanel from './components/InfoPanel.vue';
import { useDataset } from './composables/useDataset.js';
import { decodeConfig, pixelSizeFor } from './core/config.js';
import { buildOverlayModel, paintOverlay } from './core/overlay.js';

// —— 从 URL 读取运行参数 ——
// 截帧出片模式：?t=<0..1>（同时隐藏 UI，渲染确定性单帧）
// 通用配置：?view=<viewKey> & theme=<themeName> & cfg=<base64url(configJSON)>
// v2.6：&aspect=16:9|9:16|1:1|4:3 & interval=<ms>
const params = new URLSearchParams(location.search);
const tParam = params.get('t');
const captureT = tParam != null && tParam !== ''
  ? Math.min(Math.max(parseFloat(tParam), 0), 1)
  : null;
const capture = captureT != null;

const ds = useDataset();
const {
  state: dsState, activeView, theme,
  setView, setTheme, setShape, setHighlight,
  setMeta, setBarInterval, setDuration, setAspect, aspectRatio,
  // ★ v2.10.0：模板导入撤销状态（仅供调试观测口读取，UI 由 MetricBar 自行消费）
  canUndoImport: dsCanUndoImport,
} = ds;
const config = computed(() => dsState.config); // reactive: { title, subtitle, source, notes, revealRatio, durationMs, barIntervalMs, aspect, views, ... }
const viewKey = computed(() => dsState.viewKey);
const themeKey = computed(() => dsState.themeKey);
const shapeKey = computed(() => dsState.shapeKey);

// —— 载入 URL 中的配置（若有），再应用 view / theme 覆盖 ——
const cfgParam = params.get('cfg');
if (cfgParam) {
  try {
    const raw = decodeConfig(cfgParam);
    if (raw) ds.loadConfigObject(raw);
  } catch (e) {
    console.warn('cfg 参数解析失败，使用默认配置：', e);
  }
}
const viewParam = params.get('view');
if (viewParam) setView(viewParam);
const themeParam = params.get('theme');
if (themeParam) setTheme(themeParam);
const shapeParam = params.get('shape');
if (shapeParam) setShape(shapeParam);
// 画幅比例：?aspect=9:16 —— 与导出共用（出片脚本据此设置视口像素）
const aspectParam = params.get('aspect');
if (aspectParam) setAspect(aspectParam);
// 每根柱子间隔：?interval=3000（ms）—— 会重算总时长
// 注：若同时给了 cfg 内的 durationMs，则 duration 显式优先；此处 interval 只覆盖间隔字段。
const intervalParam = params.get('interval');
if (intervalParam != null && intervalParam !== '') setBarInterval(Number(intervalParam));
// 高亮主角：可写实体 id（如 huishi）或显示名（如 会师镇）；传空字符串可清除全部高亮。
const hlParam = params.get('highlight');
if (hlParam != null && hlParam !== '') setHighlight(hlParam);

const tableOpen = ref(false);
const infoOpen = ref(false);
const chartRef = ref(null);
const active = ref(null);

// 把图表组件实例挂到 window，供 MetricBar 的导出功能调用 beginRecord/renderAt/endRecord
// （逐帧确定性录制，避免"点导出时动画已播完 → 只录到静止结尾帧"）
watch(chartRef, (c) => { window.__barRace = c || null; }, { immediate: true });

// ★ v2.10.0：给 QA 一个**只读**的全量状态观测口。
//   为什么需要：BarRace3D 只收 items/unit/theme 等渲染 props，**不持有完整 config**
//   （标题/来源/备注/画幅/间隔/视图清单都不在里面），因此基于 __barRace 的探针
//   测不到"导入是否真的替换了元信息与视图分类"。这里把 useDataset 的状态挂出来，
//   让 scripts/qa/verify-template.mjs 能断言端到端的替换结果。
//   安全性：只暴露 getConfig 读取函数，不暴露任何 setter；仅在 ?debug=1 时挂载，
//   正常使用（无 query）下 window.__barRaceDS 为 undefined，不扩大对外接口面。
if (params.get('debug') === '1') {
  // 返回深拷贝：避免测试侧的读取被 Vue 响应式代理"激活"而干扰依赖收集
  window.__barRaceDS = {
    getConfig: () => JSON.parse(JSON.stringify(dsState.config)),
    getUiState: () => ({
      viewKey: dsState.viewKey,
      themeKey: dsState.themeKey,
      shapeKey: dsState.shapeKey,
      durationLocked: dsState.durationLocked,
      canUndoImport: dsCanUndoImport.value === true,
    }),
  };
}

// ★ 信息层数据提供者（v2.7.1 修复"录制丢失标题/信息面板"）：
//   浏览器内【导出 WebM】走 canvas.captureStream()，**只能捕获 WebGL 画布**，
//   DOM 覆盖层（标题/当前视图/当前目标/来源）不在其中 → 导出视频缺信息。
//   这里把「构造信息层数据模型」的纯函数暴露出去，由录制器把
//   ①WebGL 画布 + ②用 Canvas 2D 原生绘制的信息层 合成到同一张离屏 canvas 后再录制。
//   数据与页面 DOM 版同源（buildOverlayModel 只吃 props 快照，不读 DOM）。
// ★ 信息层单一数据模型（v2.8.0）：DOM 预览层与 Canvas 录制层共用同一个 model。
//
// 【为什么】此前 DOM 版排版在 CSS 里用 `--ov-*` 令牌（clamp(var(--vp-w)*k)）表达，
//   Canvas 版在 overlay.js:overlayMetrics() 用同组系数表达 —— 两处数值近似但**分头维护**，
//   改一处易漏另一处（v2.7.1 就曾出现"竖屏落位对不上"的漂移）。
//
// 【现在】buildOverlayModel() 是唯一几何事实源：
//   · Canvas 录制层：paintOverlay(ctx, model) 直接消费（overlay.js）
//   · DOM 预览层：下方 overlayModel 计算属性 → cssVars 注入 --ov-* 像素值 → CSS 只做落位
//   CSS 不再自带比例系数，只负责"把 m.* 的 px 摆到正确位置"，从根上消除数值漂移。
const overlayModel = computed(() => buildOverlayModel({
  config: config.value,
  view: activeView.value,
  active: active.value,
  theme: theme.value,
  size: vpSize.value,
  portrait: vpPortrait.value,
}));

// 把模型度量暴露给模板（模板里用 ovModel.m.* 绑定内联样式）
const ovModel = overlayModel;

window.__brOverlayProvider = () => {
  // 录制层与预览层同源：直接复用同一个 model（尺寸取实测取景框）
  const vp = document.querySelector('.viewport');
  const size = vp
    ? { w: Math.round(vp.clientWidth), h: Math.round(vp.clientHeight) }
    : { w: window.innerWidth, h: window.innerHeight };
  return buildOverlayModel({
    config: config.value,
    view: activeView.value,
    active: active.value,
    theme: theme.value,
    size,
    portrait: size.w / size.h < 1,
  });
};
// 调试钩子：把信息层的 Canvas 绘制函数也挂出去（仅 ?debug=1），
// 供端到端验证「录制器合成的画面确实包含信息层」——直接合成一次并采样像素。
if (typeof location !== 'undefined' && /[?&]debug=1\b/.test(location.search)) {
  window.__brPaintOverlay = paintOverlay;
}

// 主题 → CSS 变量 + 页面背景；同时把画幅比例换算为取景框尺寸（--vp-w/--vp-h）。
// 取景框算法：在 .stage 可用区域内取所选比例的**最大内接矩形**（居中）。
//   由 JS 用实测的窗口像素直接算出 wxh（而非把 min()/calc() 写进 CSS var）：
//   CSS 自定义属性参与 min()/calc() 时嵌套 var 的解析在各引擎不一致，实测页面上会
//   静默失效（回退成 100% → 取景框恒等于窗口比例）。用 JS 算像素既确定又可断言。
const CAPTURE_LONG_EDGE = 1920; // 出片长边基准（与 scripts/render.mjs 一致），仅用于展示像素标签
// 可用区域留边（编辑态）：让取景框四周留出呼吸空间。
// v2.7：控制面板移到**右侧**后，纵向已无底部 dock 占位 → 上下留边可大幅收窄，
// 取景框能更充分利用屏幕（编辑态所见更接近出片构图）。
// 横向仍需为右侧面板预留：宽屏下由 JS 按面板实测宽度避让（见 computeVpSize）。
const VP_PAD_X = 0.94; // 横向可用比例（两侧各留 3%）
const VP_PAD_Y = 0.90; // 纵向可用比例（上下各留 5%：给标题留呼吸，底部不再有 dock）

// 右侧控制面板宽度（px）：宽屏下取景框须向左避让，避免被面板压住。
// 由 DOM 实测（MetricBar 渲染后再量）→ 回退到保守估算值。
const dockRightW = ref(0);
// 底部横向 dock 的高度（窄屏/竖屏退回底部布局时）→ 纵向避让。
const dockBottomH = ref(0);
function measureDock() {
  if (typeof window === 'undefined') return;
  const el = document.querySelector('.dock');
  if (!el) { dockRightW.value = 0; dockBottomH.value = 0; return; }
  const r = el.getBoundingClientRect();
  const vw = window.innerWidth || 1;
  const vh = window.innerHeight || 1;
  // ★ 判定"右栏 vs 底栏"不能用 computedStyle 的 left/right 字符串：
  //   浏览器会把 right:auto 解析成具体像素值（实测 left="1340px"），
  //   用字符串判空会误判成"底栏"→ 纵向预留 632px → 取景框塌成 281×158（实测事故）。
  //   改用**几何判据**，与 CSS 断点解耦、任何主题/缩放都成立：
  //     · 面板右缘贴近屏幕右侧（留边 < 10% 屏宽）→ 视为右栏；
  //     · 面板下缘贴近屏幕底部（留边 < 10% 屏高）且宽度较大 → 视为底栏。
  const gapRight = vw - r.right;
  const gapBottom = vh - r.bottom;
  const nearRight = gapRight <= vw * 0.10 && r.width <= vw * 0.55;
  const nearBottom = gapBottom <= vh * 0.10 && !nearRight;
  if (nearRight) { dockRightW.value = Math.round(r.width) + 26; dockBottomH.value = 0; }
  else if (nearBottom) { dockRightW.value = 0; dockBottomH.value = Math.round(r.height) + 22; }
  else { dockRightW.value = 0; dockBottomH.value = 0; }
}

const vpSize = ref({ w: 0, h: 0 });
// 取景框是否竖构图（h > w）：驱动画面内信息层的竖屏落位（.viewport.portrait）。
// ★ 必须与 overlay.js 的 portrait 判定同口径（w/h < 1），
//   否则 DOM 预览与录制合成的信息层落位会不一致（实测：宽屏窗口 + 9:16 画幅时，
//   预览把目标卡放左侧居中、录制却画在左下 —— v2.7.1 已统一为取景框口径）。
const vpPortrait = computed(() => vpSize.value.h > 0 && vpSize.value.w > 0 && vpSize.value.h > vpSize.value.w);
// 取景框在屏幕上的水平偏移（px，负值=左移）：
// 右侧有控制面板时，取景框若仍以屏幕中心居中，会与面板重叠（实测重叠 ~71px）。
// 故按"可用区中心"定位：可用区 = 屏幕左侧到面板左缘。
// 用 CSS 变量 --vp-dx 交给 .viewport 的 translate 使用。
const vpDx = ref(0);
function computeVpSize() {
  if (typeof window === 'undefined') return;
  if (capture) { vpSize.value = { w: window.innerWidth, h: window.innerHeight }; vpDx.value = 0; return; }
  const r = aspectRatio.value || 16 / 9;
  const reservedRight = dockRightW.value;   // 右栏占位（含留白）
  const reservedBottom = dockBottomH.value; // 底栏占位（含留白）
  const availW = Math.max(120, window.innerWidth * VP_PAD_X - reservedRight);
  const availH = Math.max(120, window.innerHeight * VP_PAD_Y - reservedBottom);
  // 最大内接：先按宽度试算高，超出则改按高度算宽
  let w = availW;
  let h = w / r;
  if (h > availH) { h = availH; w = h * r; }
  vpSize.value = { w: Math.round(w), h: Math.round(h) };
  // —— 水平定位：把取景框居中到"可用区"（而不是整屏），从而完全避开右栏 ——
  //   可用区右边界 = 屏幕宽 − 右栏占位；取景框中心 = 可用区中心。
  const availRight = window.innerWidth * VP_PAD_X - reservedRight;
  const vpCenterOnScreen = window.innerWidth / 2;          // 基准（transform 已居中）
  const availCenter = reservedRight > 0
    ? Math.max(w / 2 + 4, availRight / 2)                  // 可用区中心
    : vpCenterOnScreen;
  vpDx.value = Math.round(availCenter - vpCenterOnScreen);
}
computeVpSize();

let vpRaf = 0;
function onVpResize() {
  cancelAnimationFrame(vpRaf);
  vpRaf = requestAnimationFrame(() => { measureDock(); computeVpSize(); });
}
if (typeof window !== 'undefined') {
  window.addEventListener('resize', onVpResize);
  onBeforeUnmount(() => { window.removeEventListener('resize', onVpResize); cancelAnimationFrame(vpRaf); });
}
// 比例变化 → 重算取景框（并等一帧让 .viewport 拿到新尺寸后再量一次）
watch(aspectRatio, () => { measureDock(); computeVpSize(); nextTick(() => measureViewport()); });
// 挂载后实测右侧面板宽度（面板尺寸依赖字体/内容，须等 DOM 落位）
onMounted(() => {
  nextTick(() => { measureDock(); computeVpSize(); measureViewport(); });
  // 字体加载完成后面板宽度可能微变 → 再量一次（幂等）
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { measureDock(); computeVpSize(); });
});

const cssVars = computed(() => {
  // 信息层排版度量：**直接取自 overlay.js 的 overlayMetrics()**（与 Canvas 录制层同源）。
  // CSS 端不再自带 clamp 系数，只消费这里的 px —— 改比例只需改 overlay.js 一处。
  const m = ovModel.value.m;
  return {
    '--cy': theme.value.accent,
    '--cy-dim': hexToRgba(theme.value.accent, 0.42),
    '--ink': theme.value.ink,
    '--vp-w': `${vpSize.value.w}px`,
    '--vp-h': `${vpSize.value.h}px`,
    // 取景框水平偏移：右侧有控制面板时左移，居中到"可用区"，避免与面板重叠
    '--vp-dx': `${vpDx.value}px`,
    // 取景框内可用宽度（减两侧画面留白）：供标题 / 来源等限宽，避免窄画幅下文字溢出画面。
    // v2.7 起画面内信息直接以 % 限宽（相对 .viewport），此变量作为上限兜底。
    '--ui-avail': `${Math.max(80, vpSize.value.w - 80)}px`,
    // —— 信息层排版度量（唯一事实源 = overlay.js:overlayMetrics）——
    '--ov-pad-x': `${m.padX}px`,
    '--ov-pad-y': `${m.padY}px`,
    '--ov-title': `${m.title}px`,
    '--ov-sub': `${m.sub}px`,
    '--ov-sub-indent': `${m.subIndent}px`,
    // ★ v2.8.3：「当前目标」卡已移除，但下列 --ov-* 仍继续注入——
    //   overlayMetrics() 是"CSS 与 Canvas 的共用契约"（qa:geometry 断言
    //   变量值 == 度量函数输出、且字段集合完整），保留注入即保持契约可验证；
    //   无 DOM 消费者时它们只是未被引用的自定义属性，零副作用。
    '--ov-name': `${m.name}px`,
    '--ov-val': `${m.val}px`,
    '--ov-panel-w': `${m.panelW}px`,
    '--ov-panel-pad-y': `${m.panelPadY}px`,
    '--ov-panel-pad-x': `${m.panelPadX}px`,
    '--ov-bar-gap': `${m.barGapS}px`,
    '--ov-chip-k': `${m.chipK}px`,
    '--ov-chip-v': `${m.chipV}px`,
    '--ov-chip-pad-y': `${m.chipPadY}px`,
    '--ov-chip-pad-kx': `${m.chipPadKX}px`,
    '--ov-chip-pad-vx': `${m.chipPadVX}px`,
    '--ov-rank': `${m.rank}px`,
    '--ov-rank-b': `${m.rankB}px`,
    '--ov-unit': `${m.unit}px`,
    '--ov-src': `${m.src}px`,
    '--ov-dot': `${m.dot}px`,
    '--ov-gap-s': `${m.gapS}px`,
  };
});

// 展示用像素标签（长边 1920 下该比例对应的导出分辨率）
const framePx = computed(() => {
  const { width, height } = pixelSizeFor(config.value.aspect, CAPTURE_LONG_EDGE);
  return `${width}×${height}`;
});

// 把取景框尺寸落到 :root 之外无需额外处理：--vp-w/--vp-h 由 cssVars 直接给出。
// 出片模式（capture）下 computeVpSize 已返回整屏尺寸，故取景框自然铺满、无边距。
watchEffect(() => {
  if (!capture) document.body.style.background = theme.value.pageBg;
});

function hexToRgba(hex, a) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return `rgba(53,232,255,${a})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function onActive(a) { active.value = a; }
function onReplay() {
  // 重播 = 从头播放 → 必然解除暂停。组件内部 play() 已重置 paused，
  // 这里同步 UI 状态，避免按钮仍显示"继续"。
  playPaused.value = false;
  chartRef.value && chartRef.value.replay();
}
function onApply(items) { ds.applyItems(items); }
function onApplyMeta(meta) { setMeta(meta); ds.flash('信息已更新 ✓'); }

// ══════════ ★ v2.8.3：暂停 / 继续播放 ══════════
// 【分层】真正的播放控制住在 BarRace3D（它独占 rAF 时间轴），
//   这里只做两件事：①把用户意图转发下去；②接住组件抛回的 'paused' 事件、
//   驱动 MetricBar 按钮文案。App 不自行推断暂停状态（避免与组件内部真值漂移）。
// 【出片隔离】capture 模式（?t=…）下按钮不渲染，键盘快捷键也被 onTogglePause 拦截 ——
//   暂停纯属"预览播放"的交互能力，绝不能污染确定性出片链路。
const playPaused = ref(false);
function onTogglePause() {
  // 出片/截帧模式不响应（该模式下无 rAF 播放，暂停无意义且可能影响出片）
  if (capture) return;
  const c = chartRef.value;
  if (!c || typeof c.togglePause !== 'function') return;
  const nowPaused = c.togglePause(); // 返回切换后的暂停态（true=已暂停）
  playPaused.value = !!nowPaused;
}
// 组件内部因上下文丢失/恢复、重播等改变了暂停态时，同步回来（单一真值在组件侧）
function onPaused(p) { playPaused.value = !!p; }
// 空格键快捷键：空格是"播放/暂停"的行业惯例（视频播放器通用）。
// 排除三类场景，避免误触：
//   ① 焦点在输入框/文本域/下拉/可编辑元素上时 → 空格属于"输入空格字符"；
//   ② 焦点在按钮上时 → 空格会触发按钮点击，交给按钮自身处理（否则会双触发）；
//   ③ 带修饰键（Ctrl/Alt/Meta）→ 属浏览器/系统快捷键，不抢。
function onKeydown(e) {
  if (e.code !== 'Space' && e.key !== ' ') return;
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  const el = e.target;
  const tag = el && el.tagName ? el.tagName.toLowerCase() : '';
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
  if (el && el.isContentEditable) return;
  if (tag === 'button' || (el && el.closest && el.closest('button'))) return;
  e.preventDefault();
  onTogglePause();
}
if (typeof window !== 'undefined' && !capture) {
  window.addEventListener('keydown', onKeydown);
  onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));
}

// 惰性调试钩子：仅当 URL 含 debug=1 时暴露"规范化后的配置/视图清单"（供端到端验证
// 断言 v2 模板是否被正确识别与适配）。生产 / 出片路径完全不写入全局状态。
if (typeof location !== 'undefined' && /[?&]debug=1\b/.test(location.search)) {
  window.__brConfig = {
    title: config.value.title,
    subtitle: config.value.subtitle,
    source: config.value.source,
    notes: config.value.notes,
    aspect: config.value.aspect,
    durationMs: config.value.durationMs,
    barIntervalMs: config.value.barIntervalMs,
    views: config.value.views.map((v) => ({
      key: v.key, label: v.label, unit: v.unit, shape: v.shape,
      items: v.items.length,
      highlighted: v.items.filter((i) => i.highlight).map((i) => i.name),
    })),
  };
}

// 惰性调试钩子：报告取景框实际渲染尺寸与比例（供端到端验证"预览比例 == 导出比例"）
function measureViewport() {
  const vp = document.querySelector('.viewport');
  if (!vp) return;
  const r = vp.getBoundingClientRect();
  window.__brViewport = {
    width: Math.round(r.width),
    height: Math.round(r.height),
    ratio: r.height ? +(r.width / r.height).toFixed(4) : 0,
    aspect: config.value.aspect,
  };
}
if (typeof location !== 'undefined' && /[?&]debug=1\b/.test(location.search)) {
  onMounted(() => {
    measureViewport();
    // 取景框有 width/height 过渡 → 等过渡结束再量一次（供 QA 读取稳定值）
    watch(vpSize, () => { measureViewport(); nextTick(measureViewport); }, { deep: true });
    setTimeout(measureViewport, 700);
    window.addEventListener('resize', measureViewport);
    onBeforeUnmount(() => window.removeEventListener('resize', measureViewport));
  });
}
</script>

<style>
/* ============================================================
   设计令牌（Design Tokens）
   所有颜色/圆角/间距/阴影/层级在此集中定义；主题运行时覆盖
   --cy / --cy-dim / --ink（见 App.vue 的 cssVars）。组件样式只引用变量，
   不再散落硬编码值 → 换主题时视觉一致、可预测。
   ============================================================ */
:root {
  /* 主题色（运行时由 cssVars 覆盖） */
  --cy: #35e8ff;
  --cy-dim: rgba(53, 232, 255, 0.42);
  --ink: #eaf9ff;

  /* 面板与描边 */
  --panel-bg: rgba(10, 18, 34, 0.72);
  --panel-bg-strong: linear-gradient(160deg, rgba(9, 26, 48, 0.88), rgba(5, 12, 24, 0.82));
  --panel-border: rgba(53, 208, 255, 0.28);
  --panel-border-strong: var(--cy-dim);

  /* 文本层次 */
  --text-muted: #7f9fb8;
  --text-dim: #7fa5bf;
  --text-faint: #4f7288;

  /* 圆角 */
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;

  /* 间距节奏（4 的倍数） */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 40px;

  /* 阴影 */
  --shadow-soft: 0 8px 30px rgba(0, 0, 0, 0.45);
  --shadow-panel: 0 18px 60px rgba(0, 0, 0, 0.6);
  --glow: 0 0 34px var(--cy-dim);

  /* 层级 */
  --z-bg: 1;
  --z-canvas: 2;
  --z-deco: 3;   /* 网格地面 / 地平线 */
  --z-hud: 4;    /* 四角 / 扫描线 */
  --z-ui: 5;     /* 标题 / 面板 / 工具条 */
  --z-overlay: 30;

  /* 动效时长 */
  --t-fast: 0.16s;
  --t-base: 0.24s;
  --t-slow: 0.36s;
  --ease: cubic-bezier(0.4, 0, 0.2, 1);
}

* { box-sizing: border-box; }
html, body, #app { margin: 0; height: 100%; }
body {
  overflow: hidden;
  background: radial-gradient(120% 110% at 50% 8%, #0b1a30 0%, #060c18 52%, #02040a 100%);
  font-family: "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
}
.stage { position: relative; width: 100vw; height: 100vh; overflow: hidden; }

/* ============================================================
   取景框（viewport）—— 画幅比例的单一事实源
   · 编辑态：按所选比例取"最大内接矩形"居中（尺寸由 --vp-w/--vp-h 给出），
     3D 画布只铺满它 → BarRace3D 读到的 aspect 恒等于所选比例；
   · 出片态（.stage 无 .frame-on）：由 JS 把 --vp-w/--vp-h 设为 100vw/100vh，
     铺满整屏，与 ?t= 截帧导出像素一一对应。
   ★ 关键：预览与导出共用同一套比例定义，故"所见即所得"。
   ============================================================ */
.viewport {
  position: absolute; top: 50%; left: 50%;
  /* ★ --vp-dx：把取景框居中到"可用区"而非整屏 —— 右侧控制面板占位时整体左移，
     保证取景框与面板永不重叠（实测不加偏移会重叠 ~71px）。
     位移量由 JS 依面板实测宽度算出（见 computeVpSize）。 */
  transform: translate(calc(-50% + var(--vp-dx, 0px)), -50%);
  width: var(--vp-w, 100vw); height: var(--vp-h, 100vh);
  overflow: hidden; z-index: var(--z-canvas);
  /* 不加 width/height 过渡：尺寸变化需立即生效，否则 3D 画布会读到过渡中途的
     aspect（瞬时比例错误），且 QA 测量也会落在动画中间值上。 */
}
/* ============================================================
   画面内信息层（vp-overlay）—— v2.7 新增
   标题 / 副标题 / 当前视图 / 当前目标 / 来源备注 均置于取景框**内部**，
   成为"视频内容"的一部分（导出可见）。
   · 坐标系 = 取景框（.viewport 为 position:absolute 定位上下文）；
   · 尺寸用相对取景框的百分比 + 少量 px 安全边距；
   · 关键：字号/间距不随屏幕变化而脱离画面 —— CSS 里改用 cqw（容器查询单位）
     会让宽高两向不一致，故这里统一用**取景框像素的百分比**换算，
     并对极小/极大取景框做 clamp 兜底。
   ============================================================ */
.vp-overlay {
  position: absolute; inset: 0; z-index: var(--z-ui);
  pointer-events: none;
  /* 作为取景框内的定位上下文：子项 top/left 相对取景框边缘 */
}

/* 取景框描边 + 比例/分辨率标签（仅编辑态；出片时 .frame-on 不存在 → 自动隐藏） */
.frame-ring {
  position: absolute; inset: 0; pointer-events: none; z-index: 6;
  border: 1px solid rgba(53, 208, 255, .22);
  box-shadow: inset 0 0 60px rgba(0, 0, 0, .35);
}
.frame-ring::before,
.frame-ring::after {
  content: ''; position: absolute; width: 22px; height: 22px;
  border: 2px solid var(--cy-dim);
}
.frame-ring::before { top: 0; left: 0; border-right: 0; border-bottom: 0; }
.frame-ring::after { bottom: 0; right: 0; border-left: 0; border-top: 0; }
.frame-tag {
  position: absolute; bottom: 8px; left: 50%; transform: translateX(-50%);
  padding: 3px 9px; font-size: 10px; letter-spacing: 1.4px;
  color: var(--cy); background: rgba(6, 14, 26, .72);
  border: 1px solid var(--panel-border); border-radius: 0;
  font-variant-numeric: tabular-nums; white-space: nowrap;
}

/* —— 透视网格地面 ——
   注：网格 / 地平线 / HUD 仍是"舞台级"装饰，铺满 .stage（不只取景框），
   因为它们表达的是"科技感氛围"而非画面内容；出片模式下 .stage 即取景框。 */
.grid-floor {
  position: absolute; left: -25%; right: -25%; bottom: -6%; height: 52%;
  background-image:
    linear-gradient(to right, var(--cy-dim) 1px, transparent 1px),
    linear-gradient(to bottom, var(--cy-dim) 1px, transparent 1px);
  background-size: 74px 74px;
  transform: perspective(560px) rotateX(72deg);
  transform-origin: bottom center;
  -webkit-mask-image: linear-gradient(to top, rgba(0,0,0,.9), transparent 78%);
  mask-image: linear-gradient(to top, rgba(0,0,0,.9), transparent 78%);
  opacity: .55;
  pointer-events: none;
  z-index: var(--z-deco); /* 覆盖在 3D 画布之上，作为前景"甲板" */
}
.horizon {
  position: absolute; left: 0; right: 0; bottom: 44%; height: 1px;
  background: linear-gradient(90deg, transparent, var(--cy-dim) 22%, var(--cy) 50%, var(--cy-dim) 78%, transparent);
  box-shadow: 0 0 22px var(--cy-dim);
  opacity: .5;
  pointer-events: none; z-index: var(--z-deco);
}

/* —— HUD：四角 + 扫描线 —— */
.hud { position: absolute; inset: 0; pointer-events: none; z-index: var(--z-hud); }
.corner {
  position: absolute; width: 42px; height: 42px;
  border: 2px solid var(--cy-dim); opacity: .8;
  transition: opacity var(--t-slow) var(--ease);
}
.corner.tl { top: var(--space-4); left: var(--space-4); border-right: 0; border-bottom: 0; }
.corner.tr { top: var(--space-4); right: var(--space-4); border-left: 0; border-bottom: 0; }
.corner.bl { bottom: var(--space-4); left: var(--space-4); border-right: 0; border-top: 0; }
.corner.br { bottom: var(--space-4); right: var(--space-4); border-left: 0; border-top: 0; }
.scanline {
  position: absolute; left: 0; right: 0; height: 34%;
  background: linear-gradient(to bottom, transparent, var(--cy-dim), transparent);
  opacity: .22;
  animation: scan 7s linear infinite;
}
@keyframes scan { 0% { top: -34%; } 100% { top: 100%; } }
@media (prefers-reduced-motion: reduce) {
  .scanline, header .dot { animation: none; }
}

/* ============================================================
   画面内信息排版（相对取景框定位）
   ★ v2.8.0：比例系数**不再写在这里**。全部 --ov-* 由 JS 从
     overlay.js:overlayMetrics() 注入（见 cssVars），与 Canvas 录制层同源。
     本区块 CSS 只负责"把已有的 px 摆到正确位置 + 处理落位/换行/层级"。
   ============================================================ */
/* 注：--ov-pad-x/y、--ov-title、--ov-sub、--ov-name、--ov-val、--ov-panel-w
   （以及 _ov-chip-k/v、--ov-rank/_b、--ov-unit、--ov-src、--ov-dot、--ov-gap-s）
   定义位置：App.vue <script> 的 cssVars 计算属性。 */

/* —— 标题（画面左上）—— */
header {
  position: absolute; top: var(--ov-pad-y); left: var(--ov-pad-x);
  color: var(--ink); pointer-events: none; z-index: var(--z-ui);
  /* 限宽：为右上角徽标与右侧内容留出空间，窄画幅下最多 62% 取景框宽 */
  max-width: min(62%, var(--ui-avail, 62%));
}
header.hidden { display: none; }
header .brand { display: flex; align-items: center; gap: var(--space-2); }
header .dot {
  width: var(--ov-dot);
  height: var(--ov-dot);
  border-radius: 50%; background: var(--cy); flex: none;
  box-shadow: 0 0 12px var(--cy); animation: pulse 1.8s ease-in-out infinite;
}
@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: .35; } }
header h1 {
  margin: 0; font-size: var(--ov-title); letter-spacing: 2px; font-weight: 700;
  text-shadow: 0 0 20px var(--cy-dim); line-height: 1.22;
}
header .sub {
  margin-top: var(--ov-gap-s);
  padding-left: var(--ov-sub-indent);
  font-size: var(--ov-sub); color: var(--text-muted);
  letter-spacing: 1px; line-height: 1.5;
}

/* —— 视图徽标（画面右上角，随取景框缩放）—— */
.metric-chip {
  position: absolute; top: var(--ov-pad-y); right: var(--ov-pad-x); z-index: var(--z-ui);
  display: flex; align-items: stretch; overflow: hidden;
  border: 1px solid var(--panel-border-strong); background: var(--panel-bg);
  backdrop-filter: blur(4px); pointer-events: none;
  clip-path: polygon(10px 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%, 0 10px);
}
.metric-chip.hidden { display: none; }
.metric-chip .k {
  padding: var(--ov-chip-pad-y) var(--ov-chip-pad-kx);
  font-size: var(--ov-chip-k);
  letter-spacing: 2px; color: #8fb6cf; background: var(--cy-dim);
}
.metric-chip .v {
  padding: var(--ov-chip-pad-y) var(--ov-chip-pad-vx);
  font-size: var(--ov-chip-v);
  font-weight: 700; letter-spacing: 1.2px; color: var(--cy);
  text-shadow: 0 0 14px var(--cy-dim);
}
.metric-chip .v i { font-style: normal; font-weight: 600; color: #8fb6cf; }

/* —— 数据来源 / 备注（画面左下角，随取景框缩放）—— */
.vp-source {
  position: absolute; left: var(--ov-pad-x); bottom: var(--ov-pad-y); z-index: var(--z-ui);
  max-width: min(58%, var(--ui-avail, 58%));
  font-size: var(--ov-src);
  line-height: 1.55; letter-spacing: .6px; color: var(--text-faint);
  pointer-events: none;
}
.vp-source .src-line { color: var(--text-dim); }
.vp-source .note-line { opacity: .85; }

/* 操作提示：右侧已停靠控制面板 → 提示移至**左上**（标题在取景框内，二者不冲突） */
.hint {
  position: fixed; left: 22px; bottom: 22px; color: var(--text-faint); font-size: 12px;
  letter-spacing: .5px; z-index: var(--z-ui); max-width: 40vw; text-align: left; line-height: 1.6;
}
.hint.hidden { display: none; }

/* ============================================================
   响应式适配（v2.7）
   画面内信息（header / 徽标 / 目标面板 / 来源）**不再按屏幕断点重排**：
   它们随取景框（--vp-w/--vp-h）等比缩放，任何屏幕/画幅下布局关系一致
   —— 这也保证"改窗口不会改变视频观感"。
   这里只处理两件事：
     · 取景框自身在屏幕上的留边（给右侧控制面板让位）；
     · 极窄画幅下画面内信息的大小/密度微调（避免拥挤）。
   ============================================================ */

/* —— 竖构图画幅（9:16 / 1:1 等）：标题限宽，避免纵向拥挤 ——
   ★ v2.7.1：由窗口媒体查询改为 .viewport.portrait 类（取景框自身宽高比驱动）。
     原媒体查询按**窗口**方向判定，宽屏窗口里切 9:16 画幅时不会命中，
     而 Canvas 录制层（overlay.js）按**取景框**判定 → 两层落位不一致，
     预览与出片观感对不上。现在两层同口径（取景框 h>w）。
   ★ v2.8.3：移除「当前目标」卡后，竖屏空间大幅释放（实测原本该卡占 57%~82% 纵带、
     且宽达取景框 62.7%，是"遮挡柱体严重"的结构性根因）。现竖屏只需约束标题与来源。
     副标题限 2 行：长备注性文字不应吃掉画面顶部。 */
.viewport.portrait header { max-width: 74%; }
.viewport.portrait header .sub {
  max-width: 100%;
  display: -webkit-box; -webkit-box-orient: vertical;
  -webkit-line-clamp: 2; line-clamp: 2;
  overflow: hidden;
}
/* 来源与备注：竖构图下移到右下角（避免与左下标题区冲突） */
.viewport.portrait .vp-source {
  left: auto; right: var(--ov-pad-x); bottom: var(--ov-pad-y);
  text-align: right; max-width: 56%;
  display: -webkit-box; -webkit-box-orient: vertical;
  -webkit-line-clamp: 3; line-clamp: 3;
  overflow: hidden;
}

/* —— 极窄屏幕（手机竖屏）：取景框纵向铺满，信息层继续等比（无需断点重排）—— */
@media (max-width: 560px) {
  header .sub { white-space: normal; overflow: hidden; text-overflow: clip; }
  /* 底部为横向 dock（约 130px 高）时，画面内信息不受影响（它们在取景框内） */
}
</style>
