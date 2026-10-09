<template>
  <div v-if="open" class="overlay" @click.self="close">
    <div class="box">
      <h3>数据集信息<small> · 标题 / 来源 / 备注</small></h3>
      <p class="tip">
        对应 v2 数据模板的 <code>dataset.name</code> / <code>dataset.source</code> / <code>dataset.notes[]</code>。
        修改后即时同步到舞台标题栏与导出画面（出片脚本 render.mjs 亦读取同一份字段）。
      </p>

      <div class="fields">
        <label class="fld">
          <span class="lab">标题<small>dataset.name</small></span>
          <input v-model="form.title" type="text" data-k="title" placeholder="例：会宁县乡镇基础数据对比" />
        </label>

        <label class="fld">
          <span class="lab">副标题<small>dataset.source + notes 的合并展示</small></span>
          <input v-model="form.subtitle" type="text" data-k="subtitle" placeholder="（可选）一行补充说明" />
        </label>

        <label class="fld">
          <span class="lab">来源<small>dataset.source</small></span>
          <input v-model="form.source" type="text" data-k="source" placeholder="例：会宁县人民政府官网、区划地名网" />
        </label>

        <label class="fld">
          <span class="lab">备注<small>dataset.notes[] · 每行一条</small></span>
          <textarea v-model="form.notes" data-k="notes" rows="4" placeholder="每行一条备注&#10;例：人口以 2018 年末户籍人口为主"></textarea>
        </label>
      </div>

      <div class="actions">
        <button class="ghost" @click="reset">还原</button>
        <span class="spacer"></span>
        <button class="ghost" @click="close">关闭</button>
        <button class="primary" @click="apply">应用</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { reactive, watch } from 'vue';

const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: '' },
  subtitle: { type: String, default: '' },
  source: { type: String, default: '' },
  notes: { type: Array, default: () => [] },
});
const emit = defineEmits(['update:open', 'apply']);

const form = reactive({ title: '', subtitle: '', source: '', notes: '' });

function fillFromProps() {
  form.title = props.title || '';
  form.subtitle = props.subtitle || '';
  form.source = props.source || '';
  form.notes = Array.isArray(props.notes) ? props.notes.join('\n') : '';
}

// 打开时同步一次（关闭后不覆盖，便于用户对照）
watch(() => props.open, (v) => { if (v) fillFromProps(); }, { immediate: true });
// 面板打开期间，若外部字段变化（如切换配置）也同步，避免编辑到过期值
watch(
  () => [props.title, props.subtitle, props.source, props.notes],
  () => { if (props.open) fillFromProps(); },
);

function reset() { fillFromProps(); }
function close() { emit('update:open', false); }
function apply() {
  emit('apply', {
    title: String(form.title || '').trim(),
    subtitle: String(form.subtitle || '').trim(),
    source: String(form.source || '').trim(),
    notes: String(form.notes || '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean),
  });
  emit('update:open', false);
}
</script>

<style scoped>
.overlay {
  position: fixed; inset: 0; z-index: var(--z-overlay);
  background: rgba(3, 5, 11, 0.62);
  display: flex; align-items: center; justify-content: center;
  backdrop-filter: blur(2px);
}
.box {
  width: min(640px, 92vw); max-height: 86vh; overflow: auto;
  padding: 22px 24px; background: #0b1322;
  border: 1px solid rgba(53, 208, 255, 0.35); border-radius: var(--radius-lg);
  box-shadow: var(--shadow-panel);
}
h3 { margin: 0 0 4px; color: #eaf6ff; font-size: 17px; letter-spacing: 1px; }
h3 small { color: #7fa8c9; font-weight: 400; font-size: 13px; }
.tip { margin: 0 0 16px; color: #7fa8c9; font-size: 12px; line-height: 1.65; }
.tip code {
  padding: 1px 5px; margin: 0 1px; border-radius: 4px;
  background: rgba(53, 208, 255, 0.1); color: #9fd8f5;
  font-size: 11.5px; font-family: ui-monospace, Menlo, Consolas, monospace;
}
.fields { display: flex; flex-direction: column; gap: 13px; }
.fld { display: block; }
.lab {
  display: flex; align-items: baseline; justify-content: space-between;
  margin-bottom: 5px; color: #9fc2dc; font-size: 12.5px; letter-spacing: .6px;
}
.lab small { color: #5f7f99; font-size: 11px; font-weight: 400; }
input[type="text"], textarea {
  width: 100%; padding: 8px 10px; background: #0a1424;
  border: 1px solid rgba(53, 208, 255, 0.25); border-radius: 6px;
  color: #eaf6ff; font-size: 13.5px; font-family: inherit;
  transition: border-color var(--t-fast) var(--ease), box-shadow var(--t-fast) var(--ease);
}
textarea { resize: vertical; line-height: 1.6; }
input[type="text"]:focus, textarea:focus {
  outline: none; border-color: var(--cy); box-shadow: 0 0 0 3px rgba(53, 208, 255, 0.15);
}
.actions { margin-top: 18px; display: flex; gap: 10px; align-items: center; }
.spacer { flex: 1; }
button { cursor: pointer; border-radius: var(--radius-sm); font-size: 14px; padding: 8px 16px; transition: all var(--t-fast) var(--ease); font-family: inherit; }
.ghost { border: 1px solid rgba(53, 208, 255, 0.35); background: rgba(53, 208, 255, 0.08); color: #cdeaff; }
.ghost:hover { background: rgba(53, 208, 255, 0.22); color: #fff; }
.primary { background: #35d0ff; color: #04121f; border: 1px solid #35d0ff; font-weight: 700; }
.primary:hover { filter: brightness(1.08); }
button:focus-visible { outline: 2px solid var(--cy); outline-offset: 2px; }

@media (max-width: 720px) {
  .box { padding: 16px 14px; width: 94vw; max-height: 90vh; }
  button { padding: 7px 12px; font-size: 13px; }
}
</style>
