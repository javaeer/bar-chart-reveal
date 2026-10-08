<template>
  <div class="ui" :class="{ hidden: capture }">
    <template v-for="(v, i) in viewList" :key="v.key">
      <span v-if="i > 0" class="sep-v"></span>
      <button
        :class="{ active: v.key === viewKey }"
        @click="$emit('update:view', v.key)"
      >{{ v.short || v.label }}</button>
    </template>

    <span class="sep"></span>

    <button
      v-for="t in themeList"
      :key="t.key"
      class="theme"
      :class="{ active: t.key === themeKey }"
      @click="$emit('update:theme', t.key)"
      :title="t.label"
    ><i :style="{ background: t.accent }"></i>{{ t.label }}</button>

    <span class="sep"></span>

    <button @click="$emit('replay')">↻ 重播</button>
    <button :disabled="busy" @click="exportWebM">{{ busy ? '⏺ 录制中…' : '⏺ 导出 WebM' }}</button>
    <span class="exp">{{ exp }}</span>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { useDataset } from '../composables/useDataset.js';

const props = defineProps({
  capture: { type: Boolean, default: false },
  viewKey: { type: String, default: '' },
  themeKey: { type: String, default: '' },
});
const emit = defineEmits(['update:view', 'update:theme', 'replay']);

const { viewList, themeList, state } = useDataset();

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
.ui {
  position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%);
  display: flex; gap: 8px; align-items: center; padding: 9px 13px; z-index: 5;
  max-width: 96vw; flex-wrap: wrap; justify-content: center;
  background: rgba(10, 18, 34, 0.72); border: 1px solid rgba(53, 208, 255, 0.28);
  border-radius: 14px; backdrop-filter: blur(8px); box-shadow: 0 8px 30px rgba(0, 0, 0, 0.45);
}
.ui.hidden { display: none; }
button {
  cursor: pointer; border: 1px solid rgba(53, 208, 255, 0.35);
  background: rgba(53, 208, 255, 0.08); color: #cdeaff; padding: 8px 13px;
  border-radius: 9px; font-size: 13.5px; letter-spacing: 0.8px; transition: all 0.18s ease;
  display: inline-flex; align-items: center; gap: 6px;
}
button:hover { background: rgba(53, 208, 255, 0.22); color: #fff; }
button.active { background: #35d0ff; color: #04121f; border-color: #35d0ff; font-weight: 700; }
button:disabled { opacity: 0.6; cursor: progress; }
button.theme i { width: 10px; height: 10px; border-radius: 50%; display: inline-block; box-shadow: 0 0 8px currentColor; }
.sep { width: 1px; height: 22px; background: rgba(53, 208, 255, 0.25); }
.sep-v { width: 1px; height: 16px; background: rgba(53, 208, 255, 0.16); }
.exp { color: #9fe6c4; font-size: 12.5px; min-width: 70px; text-align: center; }
</style>
