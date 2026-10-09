<template>
  <!-- 根节点同时保留 .ui：这是既有的"控件面板"DOM 契约（QA 脚本 / 外部样式以此选择），
       重构为分组胶囊布局后仍必须维持，避免破坏回归测试与使用者自定义样式。 -->
  <div class="dock ui" :class="{ hidden: capture }" role="toolbar" aria-label="控件面板">
    <!-- 顶部细光条：科技风细节 -->
    <span class="dock-glow" aria-hidden="true"></span>

    <!-- ① 视图分组 -->
    <div class="group" role="group" aria-label="视图切换">
      <span class="group-tag">视图</span>
      <div class="seg">
        <button
          v-for="(v, i) in viewList"
          :key="v.key"
          class="seg-btn"
          :class="{ active: v.key === viewKey }"
          :aria-pressed="v.key === viewKey"
          @click="$emit('update:view', v.key)"
        >
          <span class="dot" aria-hidden="true"></span>{{ v.short || v.label }}
        </button>
      </div>
    </div>

    <!-- ② 形状分组（几何图标） -->
    <div class="group" role="group" aria-label="形状切换">
      <span class="group-tag">形状</span>
      <div class="seg">
        <button
          v-for="s in shapeList"
          :key="s"
          class="seg-btn shape"
          :class="{ active: s === shapeKey }"
          :aria-pressed="s === shapeKey"
          @click="$emit('update:shape', s)"
          :title="shapeLabel(s)"
        >
          <span class="geo" :class="'geo-' + s" aria-hidden="true">
            <svg viewBox="0 0 16 16" fill="none">
              <template v-if="s === 'bar'">
                <!-- 方柱：瘦高矩形 + 顶面 -->
                <path d="M5.6 5.4 8 3.6 10.4 5.4 10.4 12.6 8 14.4 5.6 12.6Z" fill="currentColor" opacity=".26"/>
                <path d="M5.6 5.4 8 3.6 10.4 5.4 8 7.2Z" fill="currentColor"/>
                <path d="M5.6 5.4V12.6L8 14.4V7.2Z" fill="currentColor" opacity=".72"/>
                <path d="M10.4 5.4V12.6L8 14.4V7.2Z" fill="currentColor" opacity=".46"/>
              </template>
              <template v-else-if="s === 'cube'">
                <!-- 立方体：方一点、更粗壮 -->
                <path d="M4 5 8 2.8 12 5 12 11 8 13.2 4 11Z" fill="currentColor" opacity=".26"/>
                <path d="M4 5 8 2.8 12 5 8 7.2Z" fill="currentColor"/>
                <path d="M4 5V11L8 13.2V7.2Z" fill="currentColor" opacity=".72"/>
                <path d="M12 5V11L8 13.2V7.2Z" fill="currentColor" opacity=".46"/>
              </template>
              <template v-else-if="s === 'cylinder'">
                <!-- 圆柱：顶椭圆 + 筒身 + 底弧 -->
                <path d="M4.2 4.4v7.2c0 1 1.7 1.8 3.8 1.8s3.8-.8 3.8-1.8V4.4Z" fill="currentColor" opacity=".42"/>
                <ellipse cx="8" cy="4.4" rx="3.8" ry="1.7" fill="currentColor"/>
              </template>
              <template v-else-if="s === 'rounded'">
                <!-- 圆角柱：竖直胶囊（两端半圆） -->
                <rect x="5.2" y="3" width="5.6" height="10" rx="2.8" fill="currentColor" opacity=".55"/>
                <rect x="5.2" y="3" width="5.6" height="10" rx="2.8" stroke="currentColor" stroke-width="1.2"/>
              </template>
              <template v-else-if="s === 'sphere'">
                <!-- 球体：圆 + 左上高光 -->
                <circle cx="8" cy="8" r="5.4" fill="currentColor" opacity=".42"/>
                <circle cx="6.2" cy="6.2" r="1.7" fill="#fff" opacity=".95"/>
              </template>
            </svg>
          </span>
          <span class="lbl">{{ shapeLabel(s) }}</span>
        </button>
      </div>
    </div>

    <!-- ③ 主题分组 -->
    <div class="group" role="group" aria-label="主题切换">
      <span class="group-tag">主题</span>
      <div class="seg">
        <button
          v-for="t in themeList"
          :key="t.key"
          class="seg-btn theme"
          :class="{ active: t.key === themeKey }"
          :aria-pressed="t.key === themeKey"
          @click="$emit('update:theme', t.key)"
          :title="t.label"
        >
          <i :style="{ background: t.accent }" aria-hidden="true"></i>{{ t.label }}
        </button>
      </div>
    </div>

    <!-- ④ 操作分组 -->
    <div class="group" role="group" aria-label="操作">
      <span class="group-tag">操作</span>
      <div class="seg">
        <button class="seg-btn act replay" @click="$emit('replay')">
          <span class="ico" aria-hidden="true">↻</span>重播
        </button>
        <button class="seg-btn act" :disabled="busy" @click="exportWebM">
          <span class="ico" aria-hidden="true">⏺</span>{{ busy ? '录制中…' : '导出' }}
        </button>
      </div>
    </div>

    <transition name="fade">
      <span v-if="exp" class="exp">{{ exp }}</span>
    </transition>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { useDataset } from '../composables/useDataset.js';
import { SHAPES, SHAPE_LABELS } from '../core/config.js';

const props = defineProps({
  capture: { type: Boolean, default: false },
  viewKey: { type: String, default: '' },
  themeKey: { type: String, default: '' },
  shapeKey: { type: String, default: 'bar' },
});
const emit = defineEmits(['update:view', 'update:theme', 'update:shape', 'replay']);

const { viewList, themeList, state } = useDataset();

const shapeList = SHAPES;
const shapeLabel = (s) => SHAPE_LABELS[s] || s;

const exp = ref('');
const busy = ref(false);

// —— 导出 WebM：确定性逐帧录制 ——
// 关键修复（对应"导出只有结尾静止帧 / 画面变形 / 标签竖排"）：
//   ✗ 旧实现：动画播完后点导出 → captureStream 只能抓到"当前静止画面" → 全程一帧。
//   ✓ 新实现：调用组件 beginRecord() 暂停实时循环，按目标帧率逐帧 renderAt(t) 渲染，
//     每渲染一帧就 track.requestFrame() 主动推帧 → 录制内容 = computeFrame(t) 全流程，
//     与浏览器播放逐帧一致，且不依赖"点的时机"。
function exportWebM() {
  if (busy.value) return;

  // —— 逐层体检，失败时给出**具体**原因（旧版笼统报"不支持"，掩盖了真实 bug）——
  const chart = window.__barRace;
  if (!chart) { exp.value = '✗ 组件未就绪'; return; }
  if (typeof chart.beginRecord !== 'function') { exp.value = '✗ 缺少录制接口'; return; }

  const cv = chart.getCanvas();
  if (!cv) { exp.value = '✗ 找不到 canvas'; return; }
  if (cv.tagName !== 'CANVAS') { exp.value = `✗ 拿到的是 ${cv.tagName}`; return; }
  if (typeof cv.captureStream !== 'function') { exp.value = '✗ captureStream 不可用'; return; }
  if (typeof window.MediaRecorder === 'undefined') { exp.value = '✗ 无 MediaRecorder'; return; }

  const fps = 30;
  const durationMs = Number(state.config && state.config.durationMs) || 9000;
  const tailMs = 400;
  const totalFrames = Math.max(2, Math.round((durationMs / 1000) * fps));

  let stream, track, manual = false;
  try {
    // 优先手动推帧（0 fps），不支持则退回自动采样——两种情况都由 renderAt(t) 驱动内容。
    stream = cv.captureStream(0);
    track = stream.getVideoTracks()[0];
    manual = !!(track && typeof track.requestFrame === 'function');
    if (!manual) { stream = cv.captureStream(fps); track = stream.getVideoTracks()[0]; }
  } catch (e) {
    exp.value = '✗ 无法取流'; return;
  }
  if (!track) { exp.value = '✗ 无视频轨道'; return; }

  let rec;
  try {
    const types = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    const mimeType = types.find((t) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || '';
    rec = new MediaRecorder(stream, mimeType ? { mimeType, videoBitsPerSecond: 8e6 } : undefined);
  } catch (e) {
    exp.value = '✗ 录制器创建失败'; return;
  }

  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  rec.onerror = (e) => { exp.value = '✗ 录制出错'; busy.value = false; chart.endRecord(); };
  rec.onstop = () => {
    const blob = new Blob(chunks, { type: 'video/webm' });
    chart.endRecord();
    // 产物体检：过小说明没真正抓到帧（典型为 WebGL buffer 空白 / 无头环境）
    if (blob.size < 4096) {
      exp.value = '⚠ 未抓到帧，请用 CLI 出片';
      busy.value = false;
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'bar-chart-reveal.webm';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
    exp.value = `✓ 已保存 ${(blob.size / 1024).toFixed(0)}KB`;
    busy.value = false;
  };

  busy.value = true;
  exp.value = '录制中…';
  chart.beginRecord();
  try { rec.start(200); } catch (e) { exp.value = '✗ 启动失败'; busy.value = false; return; }

  let frame = 0;
  // ★ 关键：renderAt(t) 只是 setOption，echarts-gl 的 WebGL 实际绘制发生在**下一个 rAF**。
  //   若渲染后立刻 requestFrame()，抓到的是尚未绘制的空白 buffer
  //   （实测：立即抓 lit=0/maxLum=54；等 1 个 rAF 后 lit=220789/maxLum=245）。
  //   因此必须"渲染 → 等一个 rAF → 再推帧"，否则导出的是纯背景空白视频。
  function step() {
    if (rec.state !== 'recording') { finish(); return; }
    const t = frame / (totalFrames - 1);
    chart.renderAt(t);
    requestAnimationFrame(() => {
      if (manual) { try { track.requestFrame(); } catch (e) { /* 忽略单帧失败 */ } }
      frame++;
      if (frame < totalFrames) setTimeout(step, Math.max(0, Math.round(1000 / fps) - 8));
      else finish();
    });
  }
  function finish() {
    setTimeout(() => { try { rec.stop(); } catch (e) { /* 已停止 */ } }, tailMs);
  }
  setTimeout(step, 60);
}
</script>

<style scoped>
/* ============================================================
   底部控件 dock —— 科技风三段分组布局
   结构：dock(外壳) > group(分组) > group-tag(标签) + seg(胶囊段) > seg-btn
   ============================================================ */
.dock {
  position: fixed; left: 50%; bottom: var(--space-5); transform: translateX(-50%);
  display: grid; grid-template-columns: auto auto; gap: 9px 18px;
  align-items: end; justify-content: center; z-index: var(--z-ui);
  max-width: 96vw; padding: 12px 18px 13px;
  background: var(--panel-bg); border: 1px solid var(--panel-border);
  backdrop-filter: blur(10px) saturate(1.15);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-soft), inset 0 1px 0 rgba(120, 220, 255, 0.06);
  /* 四角切角，科技风轮廓 */
  clip-path: polygon(14px 0, calc(100% - 14px) 0, 100% 14px, 100% 100%, 0 100%, 0 14px);
  transition: background var(--t-base) var(--ease), border-color var(--t-base) var(--ease);
}
.dock.hidden { display: none; }

/* 顶部流光细线 */
.dock-glow {
  position: absolute; left: 14px; right: 14px; top: 0; height: 1px; pointer-events: none;
  background: linear-gradient(90deg, transparent, rgba(53, 208, 255, 0.55) 30%,
              rgba(120, 240, 255, 0.85) 50%, rgba(53, 208, 255, 0.55) 70%, transparent);
  opacity: 0.9;
}

/* —— 分组 —— */
.group { display: flex; flex-direction: column; align-items: stretch; gap: 5px; min-width: 0; }
.group-tag {
  font-size: 9px; letter-spacing: 2.5px; text-transform: uppercase;
  color: var(--text-faint); user-select: none; padding-left: 14px;
}
.seg {
  display: flex; align-items: center; gap: 3px; padding: 3px;
  background: rgba(8, 24, 38, 0.6);
  border: 1px solid rgba(53, 208, 255, 0.14);
  border-radius: 999px;   /* 胶囊 */
}

/* —— 段内按钮 —— */
.seg-btn {
  cursor: pointer; border: 1px solid transparent; background: transparent;
  color: #a8cfe4; padding: 7px 13px; border-radius: 999px;
  font-size: 13px; letter-spacing: 0.6px; font-family: inherit;
  display: inline-flex; align-items: center; gap: 6px; white-space: nowrap;
  position: relative;
  transition: background var(--t-fast) var(--ease), color var(--t-fast) var(--ease),
              border-color var(--t-fast) var(--ease), transform var(--t-fast) var(--ease),
              box-shadow var(--t-fast) var(--ease);
}
.seg-btn:hover {
  background: rgba(53, 208, 255, 0.14); color: #eafbff;
  border-color: rgba(53, 208, 255, 0.32);
}
.seg-btn:active { transform: translateY(1px) scale(0.97); }
.seg-btn:focus-visible { outline: 2px solid var(--cy); outline-offset: 2px; }
.seg-btn:disabled { opacity: 0.55; cursor: progress; }

/* 选中态：青实心胶囊 + 外发光 */
.seg-btn.active {
  background: linear-gradient(180deg, #5ce0ff, #1fbfe8);
  color: #04121f; font-weight: 700; border-color: #6fe6ff;
  box-shadow: 0 0 16px rgba(53, 208, 255, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.5);
}

/* 视图按钮前的小指示点 */
.seg-btn .dot {
  width: 5px; height: 5px; border-radius: 50%; flex: none;
  background: currentColor; opacity: 0.5;
  transition: opacity var(--t-fast) var(--ease), box-shadow var(--t-fast) var(--ease);
}
.seg-btn.active .dot { opacity: 1; box-shadow: 0 0 8px #04121f; }

/* 主题色点 */
.seg-btn.theme i {
  width: 9px; height: 9px; border-radius: 50%; flex: none;
  box-shadow: 0 0 8px currentColor, inset 0 0 2px rgba(255,255,255,0.6);
}

/* 操作按钮图标 */
.seg-btn .ico { font-size: 13px; line-height: 1; }
.seg-btn.replay .ico { color: #9fe6c4; }
.seg-btn.active.replay .ico { color: inherit; }

/* —— 形状几何图标（SVG，直观区分方柱/立方/圆柱/圆角/球）—— */
.geo { width: 17px; height: 17px; flex: none; display: inline-flex; }
.geo svg { width: 100%; height: 100%; display: block; overflow: visible; }
.geo-bar, .geo-cube, .geo-cylinder, .geo-rounded, .geo-sphere { color: #9ad9f0; }
.seg-btn.active .geo { color: #04121f; }
.seg-btn.active .geo svg [fill="#fff"] { fill: #eafcff; }

/* —— 导出状态文字（grid 第二行、跨两列居中）—— */
.exp {
  grid-column: 1 / -1; color: #9fe6c4; font-size: 12px; text-align: center;
  letter-spacing: 0.3px; margin-top: -2px;
}
.fade-enter-active, .fade-leave-active { transition: opacity var(--t-fast) var(--ease); }
.fade-enter-from, .fade-leave-to { opacity: 0; }

/* —— 响应式 —— */
/* 中屏 / 竖屏（<1180px）：单列堆叠，每组一行，段内可换行——彻底避免横向溢出 */
@media (max-width: 1180px) {
  .dock {
    grid-template-columns: minmax(0, 1fr); gap: 7px;
    bottom: var(--space-4); max-width: 94vw; padding: 10px 12px 11px;
  }
  .group { align-items: stretch; }
  .group-tag { padding-left: 10px; letter-spacing: 2px; }
  .seg { flex-wrap: wrap; justify-content: center; }
  .seg-btn { padding: 6px 10px; font-size: 12.5px; }
  .exp { font-size: 11px; text-align: center; }
}
@media (max-width: 720px) {
  .dock {
    bottom: var(--space-3); padding: 8px 10px 9px; gap: 6px;
    border-radius: var(--radius-md); max-width: 95vw;
    clip-path: polygon(10px 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 0 100%, 0 10px);
  }
  .dock-glow { left: 10px; right: 10px; }
  .seg-btn { padding: 5px 8px; font-size: 11.5px; gap: 4px; letter-spacing: 0.3px; }
  .seg-btn .ico { font-size: 11px; }
  .geo { width: 14px; height: 14px; }
  .group-tag { font-size: 8px; letter-spacing: 2px; padding-left: 8px; }
  .exp { font-size: 10.5px; }
}
@media (max-width: 480px) {
  /* 窄屏：进一步压缩，去掉视图圆点、形状只留图标 */
  .dock { gap: 5px; padding: 8px 9px 9px; max-width: 96vw; }
  .group-tag { padding-left: 9px; font-size: 7.5px; letter-spacing: 1.5px; }
  .seg { padding: 2px; gap: 2px; }
  .seg-btn { padding: 4px 7px; font-size: 11px; }
  .seg-btn .dot { display: none; }        /* 省宽：去掉视图小圆点 */
  .seg-btn.shape .lbl { display: none; }  /* 形状按钮只留图标 */
  .geo { width: 16px; height: 16px; }
}
</style>
