<template>
  <div class="stage" :style="cssVars">
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
    />

    <header>
      <div class="brand">
        <span class="dot"></span>
        <h1>{{ config.title || '3D 柱状对比' }}</h1>
      </div>
      <div v-if="config.subtitle" class="sub">{{ config.subtitle }}</div>
    </header>

    <!-- 当前视图徽标：仅出片（capture）模式显示，避免与右上角数据工具条重叠 -->
    <div v-if="capture" class="metric-chip">
      <span class="k">当前视图</span>
      <span class="v">{{ activeView.label }}<i v-if="activeView.unit"> · {{ activeView.unit }}</i></span>
    </div>

    <!-- 跟随镜头的目标面板 -->
    <transition name="fade">
      <div v-if="!capture && active && active.shown" class="target-panel">
        <div class="tp-head"><span class="tp-dot"></span>当前目标</div>
        <div class="tp-name">{{ active.name }}</div>
        <div class="tp-val">
          {{ active.value.toFixed(activeView.fixed) }}<i>{{ activeView.unit }}</i>
        </div>
        <div class="tp-rank">排名第 <b>{{ active.rank }}</b> / {{ active.total }}</div>
        <div class="tp-bar"><i :style="{ width: (active.revealed / active.total * 100) + '%' }"></i></div>
      </div>
    </transition>

    <DataToolbar :capture="capture" @open-table="tableOpen = true" />
    <MetricBar
      :capture="capture"
      :view-key="viewKey"
      :theme-key="themeKey"
      :shape-key="shapeKey"
      @update:view="setView"
      @update:theme="setTheme"
      @update:shape="setShape"
      @replay="onReplay"
    />

    <DataTable
      v-model:open="tableOpen"
      :rows="activeView.items"
      :view-label="activeView.label"
      :unit="activeView.unit"
      @apply="onApply"
    />

    <div class="hint" :class="{ hidden: capture }">
      拖拽旋转 · 滚轮缩放 · 数据可编辑 / 可导入导出 · 配置与主题均已通用化
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watchEffect, watch } from 'vue';
import BarRace3D from './components/BarRace3D.vue';
import DataToolbar from './components/DataToolbar.vue';
import MetricBar from './components/MetricBar.vue';
import DataTable from './components/DataTable.vue';
import { useDataset } from './composables/useDataset.js';
import { decodeConfig } from './core/config.js';

// —— 从 URL 读取运行参数 ——
// 截帧出片模式：?t=<0..1>（同时隐藏 UI，渲染确定性单帧）
// 通用配置：?view=<viewKey> & theme=<themeName> & cfg=<base64url(configJSON)>
const params = new URLSearchParams(location.search);
const tParam = params.get('t');
const captureT = tParam != null && tParam !== ''
  ? Math.min(Math.max(parseFloat(tParam), 0), 1)
  : null;
const capture = captureT != null;

const ds = useDataset();
const { state: dsState, activeView, theme, setView, setTheme, setShape } = ds;
const config = computed(() => dsState.config); // reactive: { title, subtitle, revealRatio, durationMs, views, ... }
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

const tableOpen = ref(false);
const chartRef = ref(null);
const active = ref(null);

// 把图表组件实例挂到 window，供 MetricBar 的导出功能调用 beginRecord/renderAt/endRecord
// （逐帧确定性录制，避免"点导出时动画已播完 → 只录到静止结尾帧"）
watch(chartRef, (c) => { window.__barRace = c || null; }, { immediate: true });

// 主题 → CSS 变量 + 页面背景
const cssVars = computed(() => ({
  '--cy': theme.value.accent,
  '--cy-dim': hexToRgba(theme.value.accent, 0.42),
  '--ink': theme.value.ink,
}));
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
function onReplay() { chartRef.value && chartRef.value.replay(); }
function onApply(items) { ds.applyItems(items); }
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

/* —— 透视网格地面 —— */
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

/* —— 标题 —— */
header {
  position: fixed; top: var(--space-5); left: var(--space-6); color: var(--ink);
  pointer-events: none; z-index: var(--z-ui); max-width: 42vw;
}
header.hidden { display: none; }
header .brand { display: flex; align-items: center; gap: var(--space-2); }
header .dot {
  width: 9px; height: 9px; border-radius: 50%; background: var(--cy); flex: none;
  box-shadow: 0 0 12px var(--cy); animation: pulse 1.8s ease-in-out infinite;
}
@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: .35; } }
header h1 {
  margin: 0; font-size: 21px; letter-spacing: 2px; font-weight: 700;
  text-shadow: 0 0 20px var(--cy-dim);
}
header .sub {
  margin-top: 7px; padding-left: 18px; font-size: 12px; color: var(--text-muted);
  letter-spacing: 1px; line-height: 1.5;
}

/* —— 视图徽标 —— */
.metric-chip {
  position: fixed; top: 30px; right: 42px; z-index: var(--z-ui);
  display: flex; align-items: stretch; overflow: hidden;
  border: 1px solid var(--panel-border-strong); background: var(--panel-bg);
  backdrop-filter: blur(4px);
  clip-path: polygon(10px 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%, 0 10px);
  pointer-events: none;
}
.metric-chip.hidden { display: none; }
.metric-chip .k {
  padding: 7px var(--space-3); font-size: 11px; letter-spacing: 2px; color: #8fb6cf;
  background: var(--cy-dim);
}
.metric-chip .v {
  padding: 7px var(--space-4); font-size: 14px; font-weight: 700; letter-spacing: 1.2px; color: var(--cy);
  text-shadow: 0 0 14px var(--cy-dim);
}
.metric-chip .v i { font-style: normal; font-weight: 600; color: #8fb6cf; }

/* —— 跟随目标面板 —— */
.target-panel {
  position: fixed; left: var(--space-6); top: 50%; transform: translateY(-50%); z-index: var(--z-ui);
  min-width: 216px; padding: 15px 18px 16px;
  border: 1px solid var(--panel-border-strong); background: var(--panel-bg-strong);
  backdrop-filter: blur(6px); pointer-events: none;
  clip-path: polygon(0 0, calc(100% - 14px) 0, 100% 14px, 100% 100%, 14px 100%, 0 calc(100% - 14px));
  box-shadow: var(--glow), inset 0 0 22px rgba(53, 232, 255, .05);
}
.tp-head { display: flex; align-items: center; gap: 7px; font-size: 11px; letter-spacing: 2.5px; color: #79a6c4; }
.tp-dot { width: 6px; height: 6px; background: var(--cy); box-shadow: 0 0 9px var(--cy); }
.tp-name { margin-top: var(--space-2); font-size: 25px; font-weight: 700; letter-spacing: 2px; color: var(--ink); text-shadow: 0 0 18px var(--cy-dim); }
.tp-val {
  margin-top: 5px; font-size: 30px; font-weight: 800; letter-spacing: 1px; color: var(--cy);
  text-shadow: 0 0 20px var(--cy-dim); font-variant-numeric: tabular-nums;
}
.tp-val i { font-size: 14px; font-style: normal; margin-left: 5px; color: #7fb6d1; font-weight: 600; }
.tp-rank { margin-top: var(--space-2); font-size: 12px; letter-spacing: 1.4px; color: var(--text-dim); }
.tp-rank b { color: var(--ink); font-size: 15px; }
.tp-bar { margin-top: 10px; height: 3px; background: var(--cy-dim); opacity: .9; overflow: hidden; border-radius: 2px; }
.tp-bar i { display: block; height: 100%; background: var(--cy); box-shadow: 0 0 12px var(--cy); transition: width var(--t-base) ease-out; }
.fade-enter-active, .fade-leave-active { transition: opacity var(--t-base) var(--ease), transform var(--t-base) var(--ease); }
.fade-enter-from, .fade-leave-to { opacity: 0; transform: translateY(-50%) translateX(-8px); }

.hint {
  position: fixed; right: 26px; bottom: 30px; color: var(--text-faint); font-size: 12px;
  letter-spacing: .5px; z-index: var(--z-ui); max-width: 46vw; text-align: right; line-height: 1.6;
}
.hint.hidden { display: none; }

/* ============================================================
   响应式适配
   目标：窄屏 / 竖屏下标题、徽标、工具条、面板互不重叠遮挡。
   ============================================================ */

/* —— 中等屏（紧凑笔记本 / 横屏平板）—— */
@media (max-width: 1024px) {
  header { left: var(--space-5); top: var(--space-4); max-width: 50vw; }
  header h1 { font-size: 18px; }
  header .sub { font-size: 11px; }
  .target-panel { left: var(--space-5); min-width: 190px; padding: 13px 15px 14px; }
  .tp-name { font-size: 21px; }
  .tp-val { font-size: 25px; }
  .metric-chip { top: var(--space-4); right: var(--space-5); }
}

/* —— 窄屏（手机横屏 / 小窗）—— */
@media (max-width: 720px) {
  /* 标题让位给工具条：压缩为更小字号、限制行宽 */
  header { top: var(--space-3); left: var(--space-4); max-width: 60vw; }
  header h1 { font-size: 15px; letter-spacing: 1px; }
  header .sub { font-size: 10px; padding-left: 0; margin-top: var(--space-1); }
  header .dot { width: 7px; height: 7px; }

  /* 目标面板：从垂直居中改为贴右上（避免遮挡画面中央的柱群） */
  .target-panel {
    left: auto; right: var(--space-4); top: 74px; transform: none;
    min-width: 150px; padding: 10px 12px 11px;
  }
  .tp-name { font-size: 17px; margin-top: var(--space-1); }
  .tp-val { font-size: 20px; }
  .tp-head { font-size: 10px; }
  .fade-enter-from, .fade-leave-to { opacity: 0; transform: translateX(8px); }

  /* 徽标：截帧模式仍居中；否则与标题错开 */
  .metric-chip { top: var(--space-3); right: var(--space-4); }
  .metric-chip .v { font-size: 13px; padding: 6px 12px; }
  .metric-chip .k { font-size: 10px; padding: 6px 9px; }

  .hint { display: none; } /* 小屏隐藏操作提示，减少噪点 */
}

/* —— 竖屏：标题上移、面板下沉，给画面中央让位 —— */
@media (orientation: portrait) {
  header h1 { letter-spacing: 1px; }
  .target-panel { top: auto; bottom: 92px; transform: none; }
  .fade-enter-from, .fade-leave-to { opacity: 0; transform: translateY(8px); }
}

/* —— 手机竖屏（窄+竖向）：标题独占一行，徽标挪到标题下方，避免重叠 —— */
@media (max-width: 560px) and (orientation: portrait) {
  header { max-width: calc(100vw - var(--space-4) * 2); }
  header .sub { white-space: normal; overflow: hidden; text-overflow: clip; }
  /* 底部 dock 为 2×2 网格（约 130px 高），目标面板与徽标须抬高让位 */
  .target-panel { bottom: 168px; left: var(--space-4); right: var(--space-4); min-width: 0; }
  .metric-chip {
    top: auto; left: var(--space-4); right: auto; bottom: 140px;
  }
  .metric-chip .v { font-size: 12px; padding: 6px 10px; }
  .metric-chip .k { font-size: 10px; padding: 6px 8px; }
}
</style>
