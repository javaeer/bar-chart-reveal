<template>
  <div v-if="open" class="overlay" @click.self="close">
    <div class="box">
      <h3>数据编辑<small v-if="viewLabel"> · {{ viewLabel }}</small></h3>
      <p class="tip">
        直接修改单元格；勾选「重点」的项将以主题高亮色突出（如会师镇）。
        点「应用并重建」即时刷新 3D 视图。也可先「⬇ 模板」下载空表，在 Excel 填好后再「⬆ 导入」。
      </p>

      <div class="scroll">
        <table>
          <thead>
            <tr>
              <th>名称</th>
              <th>数值<small v-if="unit">（{{ unit }}）</small></th>
              <th class="c">重点</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="tbl-body">
            <tr v-for="(r, i) in editable" :key="i">
              <td><input v-model="r.name" type="text" data-k="name" /></td>
              <td><input v-model.number="r.value" type="number" step="any" data-k="value" /></td>
              <td class="c"><input v-model="r.highlight" type="checkbox" data-k="highlight" /></td>
              <td><button class="del" :disabled="editable.length <= 1" @click="remove(i)" title="删除该行">✕</button></td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="actions">
        <button class="ghost" @click="addRow">+ 添加行</button>
        <span class="spacer"></span>
        <button class="ghost" @click="close">关闭</button>
        <button class="primary" @click="apply">应用并重建</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue';

const props = defineProps({
  open: { type: Boolean, default: false },
  rows: { type: Array, default: () => [] },
  viewLabel: { type: String, default: '' },
  unit: { type: String, default: '' },
});
const emit = defineEmits(['update:open', 'apply']);

const editable = ref([]);
const clone = (rows) => (rows || []).map((r) => ({ name: r.name, value: r.value, highlight: r.highlight === true }));

watch(() => props.open, (v) => {
  if (v) editable.value = clone(props.rows);
}, { immediate: true });

function addRow() {
  editable.value.push({ name: '新项目', value: 0, highlight: false });
}
function remove(i) {
  if (editable.value.length <= 1) return;
  editable.value.splice(i, 1);
}
function close() {
  emit('update:open', false);
}
function apply() {
  const rows = editable.value
    .map((r) => ({ ...r, name: String(r.name || '').trim() }))
    .filter((r) => r.name);
  if (!rows.length) return;
  emit('apply', rows);
  emit('update:open', false);
}
</script>

<style scoped>
.overlay {
  position: fixed; inset: 0; z-index: 30;
  background: rgba(3, 5, 11, 0.62);
  display: flex; align-items: center; justify-content: center;
}
.box {
  width: min(720px, 92vw); max-height: 84vh; overflow: auto;
  padding: 22px 24px; background: #0b1322;
  border: 1px solid rgba(53, 208, 255, 0.35); border-radius: 16px;
  box-shadow: 0 18px 60px rgba(0, 0, 0, 0.6);
}
h3 { margin: 0 0 4px; color: #eaf6ff; font-size: 17px; letter-spacing: 1px; }
h3 small { color: #7fa8c9; font-weight: 400; font-size: 13px; }
.tip { margin: 0 0 14px; color: #7fa8c9; font-size: 12px; line-height: 1.6; }
.scroll { max-height: 52vh; overflow: auto; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th, td { padding: 6px 8px; border-bottom: 1px solid rgba(53, 208, 255, 0.14); color: #cfe6ff; text-align: left; }
th { color: #8fb6d6; font-weight: 600; }
th small { color: #6f92b0; font-weight: 400; }
td input[type="text"], td input[type="number"] {
  width: 100%; padding: 5px 7px; background: #0a1424;
  border: 1px solid rgba(53, 208, 255, 0.25); border-radius: 6px;
  color: #eaf6ff; font-size: 13px;
}
td.c { text-align: center; }
.del { background: transparent; border: none; color: #ff6b8a; cursor: pointer; font-size: 15px; }
.del:disabled { color: #44506a; cursor: not-allowed; }
.actions { margin-top: 16px; display: flex; gap: 10px; align-items: center; }
.spacer { flex: 1; }
button { cursor: pointer; border-radius: 9px; font-size: 14px; padding: 8px 16px; transition: all 0.18s ease; }
.ghost { border: 1px solid rgba(53, 208, 255, 0.35); background: rgba(53, 208, 255, 0.08); color: #cdeaff; }
.ghost:hover { background: rgba(53, 208, 255, 0.22); color: #fff; }
.primary { background: #35d0ff; color: #04121f; border: 1px solid #35d0ff; font-weight: 700; }
.primary:hover { filter: brightness(1.08); }
</style>
