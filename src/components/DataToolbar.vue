<template>
  <div class="data-ui" :class="{ hidden: capture }">
    <button @click="downloadTemplate()">⬇ 模板</button>
    <button @click="pickFile">⬆ 导入</button>
    <input ref="file" id="file" type="file" accept=".csv,text/csv" hidden @change="onFile" />
    <button @click="exportCSV()">⬇ 导出</button>
    <button @click="$emit('open-table')">✎ 数据表</button>
    <span class="msg" :class="{ show: message }">{{ message }}</span>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { useDataset } from '../composables/useDataset.js';

defineProps({ capture: { type: Boolean, default: false } });
defineEmits(['open-table']);
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
  position: fixed; top: 22px; right: 24px; z-index: 5;
  display: flex; gap: 8px; align-items: center; padding: 8px 10px;
  background: rgba(10, 18, 34, 0.72); border: 1px solid rgba(53, 208, 255, 0.28);
  border-radius: 12px; backdrop-filter: blur(8px);
}
.data-ui.hidden { display: none; }
button {
  cursor: pointer; border: 1px solid rgba(53, 208, 255, 0.35);
  background: rgba(53, 208, 255, 0.08); color: #cdeaff; padding: 7px 11px;
  border-radius: 8px; font-size: 13px; letter-spacing: 0.5px; transition: all 0.18s ease;
}
button:hover { background: rgba(53, 208, 255, 0.22); color: #fff; }
.msg { color: #9fe6c4; font-size: 12px; opacity: 0; transition: opacity 0.25s ease; min-width: 0; }
.msg.show { opacity: 1; }
</style>
