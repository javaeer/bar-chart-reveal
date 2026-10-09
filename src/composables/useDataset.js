// 配置驱动的全局状态（Vue3 响应式）—— 支撑"多视图 / 多主题 / 任意数据集"的通用工具形态
import { reactive, ref, computed } from 'vue';
import { DEFAULT_CONFIG, normalizeConfig, SHAPES } from '../core/config.js';
import { THEMES, getTheme } from '../theme.js';
import { parseItemsCSV, toItemsCSV, downloadText } from '../utils/csv.js';

function initialConfig() {
  return normalizeConfig(DEFAULT_CONFIG).config;
}

const state = reactive({
  config: initialConfig(),
  viewKey: '',
  themeKey: 'tech',
  shapeKey: 'bar',
});

function syncKeysFromConfig() {
  const cfg = state.config;
  state.viewKey = cfg.views[0] ? cfg.views[0].key : '';
  state.themeKey = typeof cfg.theme === 'string' ? cfg.theme : (cfg.theme && cfg.theme.key) || 'tech';
  // 形状：取当前视图的 shape（无则回退顶层 defaultShape / bar）
  const v = cfg.views.find((x) => x.key === state.viewKey) || cfg.views[0];
  state.shapeKey = (v && v.shape) || cfg.defaultShape || 'bar';
}
syncKeysFromConfig();

const message = ref('');
let msgTimer = null;
function flash(text) {
  message.value = text;
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => { message.value = ''; }, 2600);
}

const viewList = computed(() => state.config.views);
const activeView = computed(
  () => state.config.views.find((v) => v.key === state.viewKey) || state.config.views[0] ||
    { key: '', label: '', short: '', unit: '', fixed: 0, items: [] },
);
const themeList = computed(() => Object.values(THEMES));
const theme = computed(() => getTheme(state.themeKey || state.config.theme));

function setView(key) {
  if (state.config.views.some((v) => v.key === key)) {
    state.viewKey = key;
    // 视图自带的 shape 优先；无则保留当前形状（用户手动切换不被重置）
    const v = state.config.views.find((x) => x.key === key);
    if (v && v.shape) state.shapeKey = v.shape;
  }
}
function setTheme(key) {
  if (THEMES[key]) state.themeKey = key;
}
function setShape(key) {
  if (SHAPES.includes(key)) state.shapeKey = key;
}

// 用外部配置对象整体替换状态（浏览器 URL ?cfg= / 内置示例 / 文件导入）
function loadConfigObject(raw) {
  const { config, warns } = normalizeConfig(raw);
  state.config = config;
  syncKeysFromConfig();
  if (warns.length) flash('配置提示：' + warns[0]);
  return config;
}

// 把编辑后的数据行写回"当前视图"
function applyItems(items) {
  const v = activeView.value;
  if (!v) return;
  const clean = (items || [])
    .map((it) => ({
      name: String(it.name || '').trim(),
      value: Number(it.value) || 0,
      highlight: it.highlight === true,
    }))
    .filter((it) => it.name);
  if (!clean.length) { flash('至少需要一项有效数据'); return; }
  v.items = clean;
  flash(`已应用 ${clean.length} 项 ✓`);
}

function importCSV(text) {
  const res = parseItemsCSV(text);
  if (res.error) { flash('导入失败：' + res.error); return false; }
  applyItems(res.items);
  return true;
}

function exportCSV(filename) {
  downloadText(toItemsCSV(activeView.value.items), filename || `${state.config.title || '数据集'}.csv`);
  flash('数据已导出 ✓');
}

function downloadTemplate(filename) {
  const sample = [
    { name: '示例项 A', value: 100, highlight: true },
    { name: '示例项 B', value: 72, highlight: false },
    { name: '示例项 C', value: 45, highlight: false },
  ];
  downloadText(toItemsCSV(sample), filename || '数据集模板.csv');
  flash('模板已下载 ✓');
}

export function useDataset() {
  return {
    state,
    message,
    viewList,
    activeView,
    themeList,
    theme,
    setView,
    setTheme,
    setShape,
    loadConfigObject,
    applyItems,
    importCSV,
    exportCSV,
    downloadTemplate,
    flash,
  };
}
