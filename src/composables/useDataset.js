// 配置驱动的全局状态（Vue3 响应式）—— 支撑"多视图 / 多主题 / 任意数据集"的通用工具形态
import { reactive, ref, computed } from 'vue';
import {
  DEFAULT_CONFIG,
  normalizeConfig,
  SHAPES,
  deriveDuration,
  intervalFromDuration,
  ratioOf,
  ASPECT_KEYS,
  normalizeAspect,
} from '../core/config.js';
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
  // v2.6：时长是否由用户显式锁定。
  //   false（默认）→ 时长随「柱体数量 × 每根间隔 / 揭示占比」自动推导；
  //   true         → 用户手动改过时长，保持锁定（切换视图不再重算）。
  durationLocked: false,
});

function syncKeysFromConfig() {
  const cfg = state.config;
  state.viewKey = cfg.views[0] ? cfg.views[0].key : '';
  state.themeKey = typeof cfg.theme === 'string' ? cfg.theme : (cfg.theme && cfg.theme.key) || 'tech';
  // 形状：取当前视图的 shape（无则回退顶层 defaultShape / bar）
  const v = cfg.views.find((x) => x.key === state.viewKey) || cfg.views[0];
  state.shapeKey = (v && v.shape) || cfg.defaultShape || 'bar';
  // 配置里显式带 durationMs（规范化时留下的内部标记）→ 视为用户已锁定时长
  state.durationLocked = cfg._durationExplicit === true;
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
    // 时长未锁定时，切换视图 → 按新视图柱体数量重算总时长
    if (!state.durationLocked) autoDuration();
  }
}
function setTheme(key) {
  if (THEMES[key]) state.themeKey = key;
}
function setShape(key) {
  if (SHAPES.includes(key)) state.shapeKey = key;
}

// —— 视频规格：标题/来源/备注、播放间隔、画幅比例 ——

/**
 * 编辑数据集元信息（标题 / 来源 / 备注）。
 * 备注支持字符串（按行拆分）或数组；三者均即时反映到舞台 HUD 与导出画面。
 */
function setMeta(patch = {}) {
  const c = state.config;
  if (typeof patch.title === 'string') c.title = patch.title;
  if (typeof patch.subtitle === 'string') c.subtitle = patch.subtitle;
  if (typeof patch.source === 'string') c.source = patch.source;
  if (patch.notes != null) {
    if (Array.isArray(patch.notes)) c.notes = patch.notes.map((s) => String(s).trim()).filter(Boolean);
    else c.notes = String(patch.notes).split('\n').map((s) => s.trim()).filter(Boolean);
  }
  return c;
}

/**
 * 设置「每根柱子弹出间隔」。改间隔即视为要重新自动推导总时长
 * （若此前手动锁定时长，则先解锁——因为两者语义冲突）。
 */
function setBarInterval(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return;
  state.config.barIntervalMs = Math.round(n);
  state.durationLocked = false;
  autoDuration();
}

/** 直接设置总时长（手动锁定，不再随间隔/视图变化自动重算） */
function setDuration(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return;
  state.config.durationMs = Math.round(n);
  state.config._durationExplicit = true;
  state.durationLocked = true;
}

/**
 * 按当前配置推导总时长（不改变 interval，只重算 duration）。
 * 柱体数量取「所有视图中的最大项数」，保证任何一屏都播得完。
 */
function autoDuration() {
  const maxItems = state.config.views.reduce((m, v) => Math.max(m, (v.items || []).length), 0) || 1;
  state.config.durationMs = deriveDuration(maxItems, state.config.barIntervalMs, state.config.revealRatio);
  state.config._durationExplicit = false;
  return state.config.durationMs;
}

/** 反向：由当前总时长算出等效「每根间隔」（信息面板展示用） */
const effectiveInterval = computed(() => {
  const maxItems = state.config.views.reduce((m, v) => Math.max(m, (v.items || []).length), 0) || 1;
  if (!state.durationLocked) return state.config.barIntervalMs;
  return intervalFromDuration(state.config.durationMs, maxItems, state.config.revealRatio);
});

/** 设置画幅比例（预览取景框与导出分辨率共用） */
function setAspect(key) {
  const k = normalizeAspect(key);
  if (k) state.config.aspect = k;
}

const aspectList = computed(() => ASPECT_KEYS.map((k) => ({ key: k, ratio: ratioOf(k) })));

/** 当前画幅的宽高比数值（供 .viewport 计算内接矩形） */
const aspectRatio = computed(() => ratioOf(state.config.aspect));

// —— 高亮主角切换（URL ?highlight= / 运行时）——
// 内部统一用 items[].highlight 布尔（旧格式同字段），故这里遍历全部视图重算：
//   命中者置 true、其余全部置 false（高亮是"唯一主角"语义，不允许残留多个）。
// 匹配规则：优先按模板 entity.id（适配器写入的非契约字段 _id），其次按显示名 name——
//   两者在适配链路上稳定对应，任一命中即可，便于用户既写 'huishi' 也写 '会师镇'。
// 传空值（'' / null）→ 清除全部高亮。
function setHighlight(idOrName) {
  const target = String(idOrName == null ? '' : idOrName).trim();
  let hit = 0;
  state.config.views.forEach((v) => {
    (v.items || []).forEach((it) => {
      const matched = !!target && (it._id === target || it.name === target);
      if (matched) hit++;
      it.highlight = matched;
    });
  });
  if (target && !hit) flash(`未找到高亮对象：${target}`);
  else if (target) flash(`已高亮：${target} ✓`);
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
  // 保留旧行的 _id（按名称对照）：DataTable 编辑的是 name/value/highlight 三个契约字段，
  // _id 是 v2 模板的实体标识，编辑后不应丢失，否则 ?highlight= 按 id 匹配会失效。
  const idByName = new Map();
  (v.items || []).forEach((it) => { if (it._id) idByName.set(it.name, it._id); });
  const clean = (items || [])
    .map((it) => {
      const name = String(it.name || '').trim();
      const row = { name, value: Number(it.value) || 0, highlight: it.highlight === true };
      const keepId = it._id || idByName.get(name);
      if (keepId) row._id = keepId;
      return row;
    })
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
    setHighlight,
    setMeta,
    setBarInterval,
    setDuration,
    autoDuration,
    effectiveInterval,
    setAspect,
    aspectList,
    aspectRatio,
    loadConfigObject,
    applyItems,
    importCSV,
    exportCSV,
    downloadTemplate,
    flash,
  };
}
