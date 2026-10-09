<template>
  <div class="data-ui" :class="{ hidden: capture }">
    <button @click="downloadTemplate()" title="下载 CSV 模板"><span class="ico">⬇</span><span class="label">模板</span></button>
    <button @click="pickFile" title="导入 CSV"><span class="ico">⬆</span><span class="label">导入</span></button>
    <input ref="file" id="file" type="file" accept=".csv,text/csv" hidden @change="onFile" />
    <button @click="exportCSV()" title="导出 CSV"><span class="ico">⬇</span><span class="label">导出</span></button>
    <button @click="$emit('open-table')" title="打开数据表"><span class="ico">✎</span><span class="label">数据表</span></button>
    <button @click="$emit('open-info')" title="编辑标题 / 来源 / 备注"><span class="ico">ⓘ</span><span class="label">信息</span></button>
    <span class="msg" :class="{ show: message }">{{ message }}</span>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { useDataset } from '../composables/useDataset.js';

defineProps({ capture: { type: Boolean, default: false } });
defineEmits(['open-table', 'open-info']);
const { downloadTemplate, exportCSV, importCSV, message } = useDataset();

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
</script>

<style scoped>
.data-ui {
  position: fixed; top: 22px; right: 24px; z-index: var(--z-ui);
  display: flex; gap: var(--space-2); align-items: center; padding: 8px 10px;
  background: var(--panel-bg); border: 1px solid var(--panel-border);
  border-radius: var(--radius-md); backdrop-filter: blur(8px);
  box-shadow: var(--shadow-soft);
  transition: background var(--t-base) var(--ease), border-color var(--t-base) var(--ease);
}
.data-ui.hidden { display: none; }
button {
  cursor: pointer; border: 1px solid rgba(53, 208, 255, 0.35);
  background: rgba(53, 208, 255, 0.08); color: #cdeaff; padding: 7px 11px;
  border-radius: var(--radius-sm); font-size: 13px; letter-spacing: 0.5px;
  transition: background var(--t-fast) var(--ease), color var(--t-fast) var(--ease),
              border-color var(--t-fast) var(--ease), transform var(--t-fast) var(--ease);
  font-family: inherit;
  display: inline-flex; align-items: center; gap: 5px;
}
button .ico { font-size: 13px; line-height: 1; }
button:hover { background: rgba(53, 208, 255, 0.22); color: #fff; border-color: rgba(53, 208, 255, 0.6); }
button:active { transform: translateY(1px) scale(0.98); }
button:focus-visible { outline: 2px solid var(--cy); outline-offset: 2px; }
.msg { color: #9fe6c4; font-size: 12px; opacity: 0; transition: opacity var(--t-base) var(--ease); min-width: 0; }
.msg.show { opacity: 1; }

@media (max-width: 1024px) {
  .data-ui { top: var(--space-4); right: var(--space-5); padding: 7px 9px; gap: 6px; }
  button { padding: 6px 9px; font-size: 12.5px; }
}
@media (max-width: 720px) {
  /* 窄屏：数据工具条移到右上、竖排为紧凑条，与底部 dock 分离 */
  .data-ui { top: var(--space-3); right: var(--space-3); padding: 5px 7px; gap: 4px; }
  button { padding: 5px 8px; font-size: 11.5px; }
  button .label { display: none; }  /* 极窄只留图标 */
  .msg { font-size: 11px; }
}
</style>
