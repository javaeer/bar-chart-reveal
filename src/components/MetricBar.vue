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

    <!-- ③ 比例分组（画幅；预览取景框与导出分辨率共用同一份定义） -->
    <div class="group" role="group" aria-label="画幅比例">
      <span class="group-tag">比例</span>
      <div class="seg">
        <button
          v-for="a in aspectOptions"
          :key="a.key"
          class="seg-btn aspect"
          :class="{ active: a.key === aspectKey }"
          :aria-pressed="a.key === aspectKey"
          @click="$emit('update:aspect', a.key)"
          :title="a.label"
        >
          <span class="aframe" :class="'af-' + a.key.replace(':', '-')" aria-hidden="true"></span>
          <span class="lbl">{{ a.key }}</span>
        </button>
      </div>
    </div>

    <!-- ④ 节奏分组：每根柱子弹出间隔（总时长按间隔自动推导） -->
    <div class="group" role="group" aria-label="播放节奏">
      <span class="group-tag">间隔</span>
      <div class="seg">
        <button
          v-for="iv in intervalOptions"
          :key="iv"
          class="seg-btn pace"
          :class="{ active: iv === intervalMs }"
          :aria-pressed="iv === intervalMs"
          @click="$emit('update:interval', iv)"
          :title="`每根柱子 ${iv / 1000}s`"
        >{{ (iv / 1000).toFixed(iv % 1000 ? 1 : 0) }}s</button>
      </div>
      <span class="pace-hint" :class="{ locked: durationLocked }">
        时长 {{ (durationMs / 1000).toFixed(1) }}s{{ durationLocked ? ' · 手动' : ' · 自动' }}
      </span>
    </div>

    <!-- ⑤ 主题分组 -->
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

    <!-- ⑥ 数据分组（v2.7.1 由右上角独立的 DataToolbar 并入）
         模板 / 导入 / 导出 / 数据表 / 信息 + 操作反馈。
         合并理由：原先「右上角数据条 + 右侧控件 dock」两个同侧浮层各自占位，
         既割裂又相互挤压；并入后形成**单一右侧控制栏**，一处管完数据与视图。
         ★ QA 契约：容器仍带 .data-ui 类（interact.mjs 以 `.data-ui button` 选择
           模板/数据表/信息），使用者的自定义样式亦不受影响。 -->
    <div class="group data-ui" role="group" aria-label="数据操作">
      <span class="group-tag">数据</span>
      <div class="seg">
        <button class="seg-btn data" @click="downloadTemplate()" title="下载 CSV 模板">
          <span class="ico" aria-hidden="true">⬇</span>模板
        </button>
        <button class="seg-btn data" @click="pickFile" title="导入 CSV">
          <span class="ico" aria-hidden="true">⬆</span>导入
        </button>
        <button class="seg-btn data" @click="exportCSV()" title="导出 CSV">
          <span class="ico" aria-hidden="true">⇩</span>导出
        </button>
        <button class="seg-btn data" @click="$emit('open-table')" title="打开数据表">
          <span class="ico" aria-hidden="true">✎</span>数据表
        </button>
        <button class="seg-btn data" @click="$emit('open-info')" title="编辑标题 / 来源 / 备注">
          <span class="ico" aria-hidden="true">ⓘ</span>信息
        </button>
      </div>
      <input ref="file" id="file" type="file" accept=".csv,text/csv" hidden @change="onFile" />
      <span class="data-msg" :class="{ show: dsMessage }">{{ dsMessage }}</span>
    </div>

    <!-- ⑦ 操作分组 -->
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
import { SHAPES, SHAPE_LABELS, ASPECTS, ASPECT_KEYS } from '../core/config.js';
import { paintOverlay } from '../core/overlay.js';

const props = defineProps({
  capture: { type: Boolean, default: false },
  viewKey: { type: String, default: '' },
  themeKey: { type: String, default: '' },
  shapeKey: { type: String, default: 'bar' },
  // v2.6：画幅比例 / 播放间隔 / 总时长
  aspectKey: { type: String, default: '16:9' },
  intervalMs: { type: Number, default: 2000 },
  durationMs: { type: Number, default: 9000 },
  durationLocked: { type: Boolean, default: false },
});
const emit = defineEmits([
  'update:view', 'update:theme', 'update:shape',
  'update:aspect', 'update:interval', 'update:duration',
  'replay', 'open-table', 'open-info',
]);

const {
  viewList, themeList, state,
  downloadTemplate, exportCSV, importCSV, message: dsMessage,
} = useDataset();

// —— 数据分组（原 DataToolbar 的职责，v2.7.1 并入本面板）——
const file = ref(null);
function pickFile() { file.value && file.value.click(); }
function onFile(e) {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = () => importCSV(String(reader.result));
  reader.readAsText(f, 'utf-8');
  e.target.value = '';
}

const shapeList = SHAPES;
const shapeLabel = (s) => SHAPE_LABELS[s] || s;

// 比例选项（含 label，供 title 提示）
const aspectOptions = ASPECT_KEYS.map((k) => ({ key: k, label: ASPECTS[k].label }));
// 间隔快捷档位（ms）：2s 为默认推荐值，与「每根柱子弹出间隔」语义一一对应
const intervalOptions = [1000, 1500, 2000, 3000, 5000];

const exp = ref('');
const busy = ref(false);

// —— 导出 WebM：确定性逐帧录制（v2.7.1 起**合成信息层**）——
// 关键修复：
//   ① 【导出只有结尾静止帧】旧实现抓实时画面 → 动画播完再点就只录到结尾。
//      → 改为 beginRecord() 暂停实时循环，逐帧 renderAt(t) + track.requestFrame()。
//   ② 【导出的视频没有标题/信息面板】(v2.7.1 修复)
//      canvas.captureStream() **只能捕获 WebGL 画布**，DOM 覆盖层（标题/当前视图/
//      当前目标/来源备注）不在其中（实测标题区域在 canvas 里的亮像素为 0）。
//      → 每帧把「WebGL 画布」+「Canvas 2D 原生绘制的信息层」(paintOverlay) 合成到
//        一张**离屏合成 canvas**，再从该 canvas 取流录制；信息层数据来自
//        window.__brOverlayProvider()（与页面 DOM 版同源）。
function exportWebM() {
  if (busy.value) return;

  // —— 逐层体检，失败时给出**具体**原因（旧版笼统报"不支持"，掩盖了真实 bug）——
  const chart = window.__barRace;
  if (!chart) { exp.value = '✗ 组件未就绪'; return; }
  if (typeof chart.beginRecord !== 'function') { exp.value = '✗ 缺少录制接口'; return; }

  const cv = chart.getCanvas();
  if (!cv) { exp.value = '✗ 找不到 canvas'; return; }
  if (cv.tagName !== 'CANVAS') { exp.value = `✗ 拿到的是 ${cv.tagName}`; return; }
  if (typeof window.MediaRecorder === 'undefined') { exp.value = '✗ 无 MediaRecorder'; return; }

  // —— 合成画布：与 WebGL 画布同尺寸（= 取景框像素 = 导出画面）——
  const comp = document.createElement('canvas');
  comp.width = cv.width || 1920;
  comp.height = cv.height || 1080;
  const cctx = comp.getContext('2d');
  if (!cctx) { exp.value = '✗ 无 2D 上下文'; return; }
  if (typeof comp.captureStream !== 'function') { exp.value = '✗ captureStream 不可用'; return; }

  // 每帧把 3D 画布 + 信息层画到合成画布上
  const provider = (typeof window.__brOverlayProvider === 'function') ? window.__brOverlayProvider : null;
  function paintComposite() {
    cctx.clearRect(0, 0, comp.width, comp.height);
    cctx.drawImage(cv, 0, 0, comp.width, comp.height);
    if (provider) {
      try {
        const model = provider();
        // 信息层模型以「取景框像素」为坐标；合成画布即取景框 → 直接 1:1 绘制
        paintOverlay(cctx, model);
      } catch (e) { /* 信息层绘制失败不应中断录制 */ }
    }
  }

  const fps = 30;
  const durationMs = Number(state.config && state.config.durationMs) || 9000;
  const tailMs = 400;
  const totalFrames = Math.max(2, Math.round((durationMs / 1000) * fps));

  let stream, track, manual = false;
  try {
    // 优先手动推帧（0 fps），不支持则退回自动采样——两种情况都由 renderAt(t) 驱动内容。
    stream = comp.captureStream(0);
    track = stream.getVideoTracks()[0];
    manual = !!(track && typeof track.requestFrame === 'function');
    if (!manual) { stream = comp.captureStream(fps); track = stream.getVideoTracks()[0]; }
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
  //   若渲染后立刻合成/推帧，抓到的是尚未绘制的空白 buffer
  //   （实测：立即抓 lit=0/maxLum=54；等 1 个 rAF 后 lit=220789/maxLum=245）。
  //   因此必须"渲染 → 等一个 rAF → 合成并推帧"，否则导出的是纯背景空白视频。
  function step() {
    if (rec.state !== 'recording') { finish(); return; }
    const t = frame / (totalFrames - 1);
    chart.renderAt(t);
    requestAnimationFrame(() => {
      paintComposite();                     // 3D 画布 + 信息层 → 合成画布
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
   右侧控件 dock —— 科技风分组侧栏（v2.7：由底部居中改为右侧停靠）
   结构：dock(外壳) > group(分组) > group-tag(标签) + seg(胶囊段) > seg-btn
   ★ 为什么移到右侧：
     · 出片画幅（9:16 / 1:1 等）纵向占满时，底部 dock 会横跨取景框下沿、
       遮挡画面；右侧竖排面板与"画面主体居中"的构图互补，不再压画面。
     · v2.7.1 起把原右上角的「数据工具条」也并入本面板（数据分组），
       全站只保留**这一块**右侧控制栏 —— 数据与视图一处管完，
       不再有两个同侧浮层各自占位、相互挤压。
   ★ 布局仍是"自适应"：宽屏为固定右栏竖排；窄屏 / 竖屏（无足够横向余量）
     自动退回到底部横向流式（flex-wrap），保证任何尺寸下都不遮挡、不溢出。
   ============================================================ */
.dock {
  position: fixed; right: var(--space-5); top: 50%; transform: translateY(-50%);
  /* ★ 竖排分组：每个分组独占一行，分组内 seg 胶囊横排。
     ★ 关键：宽度必须**固定**（而非 max-content）。
       若用 max-content，面板宽度 = 最宽分组（主题：色点+中文名）的固有宽度，
       在 1600px 屏上会膨胀到 ~470px，把取景框挤成 569×320 —— 实测事故。
       固定宽度 + 组内 seg 自动换行（flex-wrap），面板宽度恒为设计值。 */
  display: flex; flex-direction: column;
  gap: 11px; align-items: stretch;
  z-index: var(--z-ui);
  width: 236px;
  max-height: calc(100vh - var(--space-6));
  overflow-y: auto; overflow-x: hidden;
  /* 自定义细滚动条（面板过高时可滚动，不破坏科技风） */
  scrollbar-width: thin; scrollbar-color: var(--cy-dim) transparent;
  padding: 15px 14px 16px;
  background: var(--panel-bg); border: 1px solid var(--panel-border);
  backdrop-filter: blur(10px) saturate(1.15);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-soft), inset 0 1px 0 rgba(120, 220, 255, 0.06);
  /* 左侧切角，科技风轮廓（朝向画面一侧） */
  clip-path: polygon(14px 0, 100% 0, 100% 100%, 0 100%, 0 14px);
  transition: background var(--t-base) var(--ease), border-color var(--t-base) var(--ease);
}
.dock.hidden { display: none; }
.dock::-webkit-scrollbar { width: 6px; }
.dock::-webkit-scrollbar-thumb { background: var(--cy-dim); border-radius: 3px; }
.dock::-webkit-scrollbar-track { background: transparent; }

/* 顶部流光细线 */
.dock-glow {
  position: absolute; left: 14px; right: 14px; top: 0; height: 1px; pointer-events: none;
  background: linear-gradient(90deg, transparent, rgba(53, 208, 255, 0.55) 30%,
              rgba(120, 240, 255, 0.85) 50%, rgba(53, 208, 255, 0.55) 70%, transparent);
  opacity: 0.9;
}

/* —— 分组 —— */
/* 侧栏内分组占满一行；标签与内容左对齐，形成整齐的"标签 + 胶囊"两段式 */
.group { display: flex; flex-direction: column; align-items: stretch; gap: 5px; min-width: 0; }
.group-tag {
  font-size: 9px; letter-spacing: 2.5px; text-transform: uppercase;
  color: var(--text-faint); user-select: none; padding-left: 12px;
}
/* 侧栏（窄面板）中 seg 胶囊必须允许换行：固定宽度下若强制单行会横向溢出被裁。
   配合下方「侧栏专有」的 seg-btn 内边距压缩，保证每行尽量多放按钮。 */
.seg {
  display: flex; align-items: center; gap: 3px; padding: 3px;
  flex-wrap: wrap;
  background: rgba(8, 24, 38, 0.6);
  border: 1px solid rgba(53, 208, 255, 0.14);
  border-radius: 14px;   /* 多行时圆角不宜过大（胶囊圆角会让折行显得怪） */
}

/* —— 段内按钮 —— */
.seg-btn {
  cursor: pointer; border: 1px solid transparent; background: transparent;
  color: #a8cfe4; padding: 7px 13px; border-radius: 999px;
  font-size: 13px; letter-spacing: 0.6px; font-family: inherit;
  display: inline-flex; align-items: center; gap: 6px; white-space: nowrap;
  position: relative; max-width: 100%;
  transition: background var(--t-fast) var(--ease), color var(--t-fast) var(--ease),
              border-color var(--t-fast) var(--ease), transform var(--t-fast) var(--ease),
              box-shadow var(--t-fast) var(--ease);
}
/* 右侧侧栏（固定 236px 宽）专有：压缩内边距与字号，保证每个 seg 少折行。
   仅在"右栏"生效（宽屏横屏）；窄屏退回底部横向布局时用下方媒体查询恢复。 */
@media (min-width: 861px) and (orientation: landscape) {
  .seg-btn { padding: 5px 9px; font-size: 12px; gap: 4px; letter-spacing: 0.2px; }
  .seg { gap: 2px; padding: 2px; justify-content: flex-start; }
  .seg-btn .ico { font-size: 12px; }
  .geo { width: 15px; height: 15px; }
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

/* —— 操作按钮图标 —— */
.seg-btn .ico { font-size: 13px; line-height: 1; }
.seg-btn.replay .ico { color: #9fe6c4; }
.seg-btn.active.replay .ico { color: inherit; }

/* —— 数据分组（v2.7.1 由右上 DataToolbar 并入的 .group.data-ui）——
   并入后 .data-ui 不再是独立浮层，仅作为「数据分组」的语义钩子（QA / 自定义样式），
   故这里把 .data-ui 的定位与外壳样式显式交还给 .dock 的分组样式（去固定定位）。 */
.group.data-ui { position: static; }
.seg-btn.data .ico { font-size: 12px; color: #9ad9f0; }
.seg-btn.data:hover .ico { color: #eafbff; }
.data-msg {
  font-size: 10px; letter-spacing: .6px; color: #9fe6c4;
  padding-left: 12px; opacity: 0; transition: opacity var(--t-base) var(--ease);
}
.data-msg.show { opacity: 1; }

/* —— 形状几何图标（SVG，直观区分方柱/立方/圆柱/圆角/球）—— */
.geo { width: 17px; height: 17px; flex: none; display: inline-flex; }
.geo svg { width: 100%; height: 100%; display: block; overflow: visible; }
.geo-bar, .geo-cube, .geo-cylinder, .geo-rounded, .geo-sphere { color: #9ad9f0; }
.seg-btn.active .geo { color: #04121f; }
.seg-btn.active .geo svg [fill="#fff"] { fill: #eafcff; }

/* —— 画幅比例图标：按各比例绘制等比小窗，直观表达 16:9 / 9:16 / 1:1 / 4:3 ——
   用 aspect-ratio 属性直接由"比例"生成外观，避免四套硬编码宽高。 */
.aframe {
  display: block; flex: none; height: 14px;
  border: 1.5px solid currentColor; border-radius: 2px; opacity: .9;
}
.af-16-9 { aspect-ratio: 16 / 9; }
.af-9-16 { aspect-ratio: 9 / 16; height: 17px; }
.af-1-1 { aspect-ratio: 1; }
.af-4-3 { aspect-ratio: 4 / 3; }
.seg-btn.aspect { padding: 6px 11px; }
.seg-btn.aspect .lbl { font-variant-numeric: tabular-nums; letter-spacing: .3px; }

/* —— 间隔分组：档位 + 时长读数（自动/手动）—— */
.seg-btn.pace { padding: 7px 10px; font-variant-numeric: tabular-nums; letter-spacing: 0; min-width: 44px; justify-content: center; }
.pace-hint {
  font-size: 10px; letter-spacing: .8px; color: #6f9cba;
  padding-left: 12px; white-space: nowrap; font-variant-numeric: tabular-nums;
}
.pace-hint.locked { color: #ffcf7a; } /* 手动锁定时以暖色提示，避免与"自动"混淆 */
/* 侧栏（竖排）下时长读数占满一行、与胶囊左对齐，避免被胶囊挤到面板边缘 */
@media (min-width: 861px) and (orientation: landscape) {
  .pace-hint { padding-left: 12px; }
}

/* —— 导出状态文字（竖排侧栏下独占一行、居中）—— */
.exp {
  flex-basis: 100%; color: #9fe6c4; font-size: 12px; text-align: center;
  letter-spacing: 0.3px; margin-top: -2px;
}
.fade-enter-active, .fade-leave-active { transition: opacity var(--t-fast) var(--ease); }
.fade-enter-from, .fade-leave-to { opacity: 0; }

/* ============================================================
   响应式：右侧竖排 → 空间不足时退回底部横排
   · 有足够横向余量（宽屏）：固定右栏竖排（与右上数据工具条同侧）。
   · 中等屏：右栏收窄、字号微调。
   · 窄屏 / 竖屏（横向余量不足，右栏会压住取景框）：改为底部横向流式，
     与原 v2.6 一致 —— 保证任何尺寸下都不遮挡主体、不溢出。
   ============================================================ */

/* —— 中等屏：右栏收窄 —— */
@media (max-width: 1180px) {
  .dock { right: var(--space-4); padding: 12px 12px 13px; gap: 9px; max-width: 56vw; }
  .group-tag { padding-left: 10px; letter-spacing: 2px; }
  .seg-btn { padding: 6px 10px; font-size: 12.5px; }
  .exp { font-size: 11px; }
}

/* —— 窄屏 / 竖屏：退回底部横向流式（与 v2.6 观感一致）—— */
@media (max-width: 860px), (orientation: portrait) {
  .dock {
    right: auto; left: 50%; top: auto; bottom: var(--space-4);
    transform: translateX(-50%);
    flex-direction: row; flex-wrap: wrap;
    gap: 8px 16px; align-items: flex-end; justify-content: center;
    width: max-content; max-width: 96vw; max-height: none;
    padding: 12px 18px 13px;
    border-radius: var(--radius-lg);
    clip-path: polygon(14px 0, calc(100% - 14px) 0, 100% 14px, 100% 100%, 0 100%, 0 14px);
  }
  .group-tag { padding-left: 14px; }
  .seg { flex-wrap: nowrap; }
}

@media (max-width: 720px) {
  .dock {
    bottom: var(--space-3); padding: 8px 10px 9px; gap: 6px 10px;
    border-radius: var(--radius-md); max-width: 95vw;
    clip-path: polygon(10px 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 0 100%, 0 10px);
  }
  .dock-glow { left: 10px; right: 10px; }
  .seg-btn { padding: 5px 8px; font-size: 11.5px; gap: 4px; letter-spacing: 0.3px; }
  .seg-btn .ico { font-size: 11px; }
  .geo { width: 14px; height: 14px; }
  .aframe { height: 12px; }
  .af-9-16 { height: 15px; }
  .group-tag { font-size: 8px; letter-spacing: 2px; padding-left: 8px; }
  .pace-hint { font-size: 9px; padding-left: 9px; }
  .data-msg { font-size: 9px; padding-left: 9px; }
  .exp { font-size: 10.5px; }
}
@media (max-width: 480px) {
  /* 窄屏：进一步压缩，去掉视图圆点、形状只留图标 */
  .dock { gap: 5px 9px; padding: 8px 9px 9px; max-width: 96vw; }
  .group-tag { padding-left: 9px; font-size: 7.5px; letter-spacing: 1.5px; }
  .seg { padding: 2px; gap: 2px; }
  .seg-btn { padding: 4px 7px; font-size: 11px; }
  .seg-btn .dot { display: none; }        /* 省宽：去掉视图小圆点 */
  .seg-btn.shape .lbl { display: none; }  /* 形状按钮只留图标 */
  .seg-btn.aspect .lbl { display: none; } /* 比例只留等比小窗图标 */
  .geo { width: 16px; height: 16px; }
  .dock .pace-hint { display: none; }     /* 极窄省略时长读数 */
}
</style>
