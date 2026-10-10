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
import { toV2TemplateJSON, templateFilename, V2_UNSUPPORTED_FIELDS } from '../core/template.js';

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
    invalidateUndo();
  }
}
function setTheme(key) {
  if (THEMES[key]) { state.themeKey = key; invalidateUndo(); }
}
function setShape(key) {
  if (SHAPES.includes(key)) { state.shapeKey = key; invalidateUndo(); }
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
  invalidateUndo();
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
  invalidateUndo();
}

/** 直接设置总时长（手动锁定，不再随间隔/视图变化自动重算） */
function setDuration(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return;
  state.config.durationMs = Math.round(n);
  state.config._durationExplicit = true;
  state.durationLocked = true;
  invalidateUndo();
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
  if (k) { state.config.aspect = k; invalidateUndo(); }
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
  invalidateUndo();
}

// 用外部配置对象整体替换状态（浏览器 URL ?cfg= / 内置示例 / 文件导入）
function loadConfigObject(raw) {
  const { config, warns } = normalizeConfig(raw);
  state.config = config;
  syncKeysFromConfig();
  if (warns.length) flash('配置提示：' + warns[0]);
  return config;
}

// ═══════════════════════════════════════════════════════════
// 【v2.10.0】模板导入 / 导出 / 可撤销
// -----------------------------------------------------------
// 目标：一份 JSON 模板驱动**全部动态数据** —— 视图分类、柱体数据、元信息、
//   主题/形状/画幅/间隔/时长都在里面，导出后能原样再导入。
//
// 撤销策略（按用户选择："整体替换 + 可撤销"、"仅撤销导入，编辑后失效"）：
//   · **单层**快照 —— 只记"导入前那一刻"，不做多级历史栈。
//     理由：本工具的心智模型是"导入一份数据 → 在它上面编辑"，用户要的是
//     "刚才那次导入点错了，退回去"，而不是 VS Code 式的 undo 链；多级栈
//     会把 UI（一个 ↩ 按钮）与交互复杂度都抬高，收益不匹配。
//   · **编辑后失效** —— 任何 setter（改标题/间隔/时长/画幅/高亮/视图/主题/形状，
//     以及 applyItems/importCSV）都会调用 invalidateUndo() 清掉快照。
//     理由：否则"撤销"会把用户导入后的所有手工编辑一起抹掉，属于危险行为；
//     让按钮在编辑后自动置灰，语义就永远只有"撤销这一次导入"，无歧义。
//   · 快照必须**独立于 config 之外**单独存 viewKey/themeKey/shapeKey/durationLocked，
//     因为它们不在 config 里（见 state 的定义），只还原 config 会留下"视图已换、
//     下拉框还停在新视图"这类状态错位。
// ═══════════════════════════════════════════════════════════

const canUndoImport = ref(false);
let undoSnap = null; // { config, viewKey, themeKey, shapeKey, durationLocked }

// 深拷贝（structuredClone 优先；旧内核 / 非浏览器环境回退 JSON 往返）。
// config 是纯数据（无函数/无循环引用），两种方式等价。
function deepCopy(v) {
  if (typeof structuredClone === 'function') {
    try { return structuredClone(v); } catch { /* 回退 */ }
  }
  return JSON.parse(JSON.stringify(v));
}

/** 记录导入前状态（仅在真正要替换前调用一次） */
function snapshotForUndo() {
  undoSnap = {
    config: deepCopy(state.config),
    viewKey: state.viewKey,
    themeKey: state.themeKey,
    shapeKey: state.shapeKey,
    durationLocked: state.durationLocked,
  };
  canUndoImport.value = true;
}

/** 清除撤销点（任何编辑动作后调用 ⇒ "仅撤销导入，编辑后失效"） */
function invalidateUndo() {
  if (!undoSnap && !canUndoImport.value) return; // 无快照时零成本短路
  undoSnap = null;
  canUndoImport.value = false;
}

/** 撤销最近一次导入；无快照时返回 false（UI 已置灰，此处仅兜底） */
function undoImport() {
  if (!undoSnap) { flash('没有可撤销的导入'); return false; }
  const s = undoSnap;
  state.config = s.config;
  state.viewKey = s.viewKey;
  state.themeKey = s.themeKey;
  state.shapeKey = s.shapeKey;
  state.durationLocked = s.durationLocked;
  undoSnap = null;
  canUndoImport.value = false;
  flash('已撤销导入 ✓');
  return true;
}

/**
 * 导入一份 JSON 模板（整体替换）。
 *
 * 为什么复用 loadConfigObject 而不是另写一套：它内部就是 normalizeConfig +
 *   syncKeysFromConfig，正是"整体替换"的既有语义（?cfg= 也走这里）。v2 模板会被
 *   normalizeConfig 自动识别并适配（looksLikeV2），旧格式 JSON 也能一并吃下。
 *
 * @param {string} text JSON 文本
 * @returns {{ok: boolean, warns?: string[], error?: string, views?: number, entities?: number}}
 */
function importTemplate(text) {
  let raw;
  try {
    // 去 BOM：Windows 记事本 / Excel 另存的 UTF-8 JSON 常带 \uFEFF，JSON.parse 会直接报错
    raw = JSON.parse(String(text).replace(/^\uFEFF/, ''));
  } catch (e) {
    flash('导入失败：JSON 解析错误');
    return { ok: false, error: 'JSON 解析错误：' + (e && e.message ? e.message : String(e)) };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    flash('导入失败：模板须为 JSON 对象');
    return { ok: false, error: '模板须为 JSON 对象（当前为 ' + (Array.isArray(raw) ? '数组' : typeof raw) + '）' };
  }

  // 先规范化再落状态：规范化失败/空视图时**不覆盖现有数据**，避免一次误操作清空工作区
  const { config, warns } = normalizeConfig(raw);
  if (!config.views.length) {
    flash('导入失败：模板无有效视图');
    return { ok: false, error: '模板无有效视图，已保留当前数据', warns };
  }

  snapshotForUndo();
  state.config = config;
  syncKeysFromConfig();
  flash(`已导入模板：${config.views.length} 视图 / ${config.views[0].items.length} 项 ✓`);
  return { ok: true, warns, views: config.views.length, entities: config.views[0].items.length };
}

/**
 * 导出当前**全量配置**为 v2 JSON 模板（可直接再次导入，往返无损）。
 * @returns {{ok: boolean, filename: string, bytes: number, template: object, warns: string[]}}
 */
function exportTemplate(filename) {
  const { text, template, warns } = toV2TemplateJSON(state.config);
  const name = filename || templateFilename(state.config) + '.v2.json';
  // mime 用 application/json（downloadText 已是通用实现，无需改 csv.js）
  downloadText(text, name, 'application/json;charset=utf-8');
  const bytes = new TextEncoder().encode(text).length;
  // 有告警时提示首条（如"当前配置没有任何视图"），无则报成功 + 体积
  flash(warns.length ? '模板已导出（有提示）：' + warns[0] : `模板已导出 ✓ ${(bytes / 1024).toFixed(1)} KB`);
  return { ok: true, filename: name, bytes, template, warns };
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
  invalidateUndo();
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
    // —— v2.10.0：单模板驱动全部动态数据 ——
    importTemplate,      // 导入 JSON 模板（整体替换 + 记录撤销点）
    exportTemplate,      // 导出全量配置为 v2 JSON 模板
    undoImport,          // 撤销最近一次导入
    canUndoImport,       // ref<boolean>：有无可撤销的导入（编辑后自动失效）
    V2_UNSUPPORTED_FIELDS, // 往返中会丢失的字段清单（UI 提示用）
    flash,
  };
}
