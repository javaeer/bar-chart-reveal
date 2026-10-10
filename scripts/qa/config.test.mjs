// 纯逻辑单元测试：normalizeConfig 的数据健壮性（任务三）
// 用法：node scripts/qa/config.test.mjs
// 无外部依赖，不需要浏览器 / 字体 / GL——直接以 Node 运行。
// ★ v2.10.0：失败时以退出码 1 收尾（见文件末尾），否则 CI / qa:all 会把红色当绿色。
import { readFileSync } from 'node:fs';
import { normalizeConfig, truncateName, SHAPES, normalizeShape } from '../../src/core/config.js';
import { looksLikeV2, adaptV2 } from '../../src/core/adapt.js';
import { toV2Template, toV2TemplateJSON, slugify, withDefined, V2_UNSUPPORTED_FIELDS } from '../../src/core/template.js';
import { buildOverlayModel, overlayMetrics } from '../../src/core/overlay.js';
import {
  ASPECTS, ASPECT_KEYS, DEFAULT_ASPECT, normalizeAspect, ratioOf, pixelSizeFor,
  deriveDuration, intervalFromDuration, DEFAULT_BAR_INTERVAL_MS, INTERVAL_MIN, INTERVAL_MAX,
} from '../../src/core/video.js';

let pass = 0, fail = 0;
const results = [];
function ok(name, cond, detail) {
  results.push({ name, pass: !!cond, detail });
  if (cond) { pass++; console.log(`✅ ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; console.log(`❌ ${name}${detail ? ' — ' + detail : ''}`); }
}

// ───────────────────────────────────────────────────────────
// 1) 畸形 items：null / 数组 / 原始值 / 缺 name / 非数字 / 负数 / 重复
// ───────────────────────────────────────────────────────────
const malformed = {
  title: '畸形配置测试',
  revealRatio: 0.72,
  durationMs: 5000,
  views: [
    {
      key: 'v1',
      label: '视图一',
      unit: '个',
      fixed: 0,
      items: [
        null,                                     // ① 非对象
        undefined,                                // ① 非对象
        [1, 2, 3],                                // ① 数组
        'just a string',                          // ① 原始值
        42,                                       // ① 原始值
        {},                                       // ② 缺 name
        { name: '   ' },                          // ② name 全空白
        { name: 123, value: 5 },                  // ② name 非字符串
        { name: '正常项', value: 100 },            // ✅ 正常
        { name: '非数字', value: 'abc' },           // ③ value 非数字 → 归零
        { name: 'NaN', value: NaN },              // ③ value NaN → 归零
        { name: 'Infinity', value: Infinity },    // ③ value Infinity → 归零
        { name: '缺失value' },                     // ③ value undefined → 归零
        { name: '负数项', value: -42 },            // ④ 负数 → 取绝对值
        { name: '正常项', value: 999 },            // ⑤ 重名 → 跳过
        { name: '高亮项', value: 7, highlight: true }, // ✅ 正常 + 高亮
      ],
    },
  ],
};

const { config: c1, warns: w1 } = normalizeConfig(malformed);
const items1 = c1.views[0].items;

ok('畸形配置：视图未被整体丢弃', c1.views.length === 1, `views=${c1.views.length}`);
ok('畸形配置：非法条目已剔除（剩余 7 条）', items1.length === 7, `items=${items1.length}`);
ok('畸形配置：不含 null/数组/原始值',
  items1.every((it) => it && typeof it === 'object' && typeof it.name === 'string'),
  items1.map((i) => i.name).join(','));
ok('畸形配置：名称为空的条目已跳过',
  !items1.some((it) => !it.name || !it.name.trim()), items1.map((i) => i.name).join(','));
ok('畸形配置：非数字 value 已归零',
  items1.find((i) => i.name === '非数字')?.value === 0 &&
  items1.find((i) => i.name === 'NaN')?.value === 0 &&
  items1.find((i) => i.name === 'Infinity')?.value === 0 &&
  items1.find((i) => i.name === '缺失value')?.value === 0,
  items1.filter((i) => ['非数字', 'NaN', 'Infinity', '缺失value'].includes(i.name))
    .map((i) => `${i.name}=${i.value}`).join(' '));
ok('畸形配置：负数已取绝对值',
  items1.find((i) => i.name === '负数项')?.value === 42,
  `负数项=${items1.find((i) => i.name === '负数项')?.value}`);
ok('畸形配置：重名条目已去重',
  items1.filter((i) => i.name === '正常项').length === 1,
  `正常项出现 ${items1.filter((i) => i.name === '正常项').length} 次`);
ok('畸形配置：highlight 正确布尔化',
  items1.find((i) => i.name === '高亮项')?.highlight === true &&
  items1.find((i) => i.name === '正常项')?.highlight === false,
  `高亮项=${items1.find((i) => i.name === '高亮项')?.highlight}`);
ok('畸形配置：所有 value 均为有限非负数',
  items1.every((i) => Number.isFinite(i.value) && i.value >= 0),
  items1.map((i) => `${i.name}=${i.value}`).join(' '));

// 告警内容断言
ok('告警：包含"不是对象"提示', w1.some((w) => w.includes('不是对象')), '');
ok('告警：包含"缺少有效 name"提示', w1.some((w) => w.includes('缺少有效 name')), '');
ok('告警：包含"value 非法"提示', w1.some((w) => w.includes('value 非法')), '');
ok('告警：包含"负数"提示', w1.some((w) => w.includes('负数')), '');
ok('告警：包含"重复"提示', w1.some((w) => w.includes('重复')), '');
ok('告警：条目数合理（≥8 条）', w1.length >= 8, `warns=${w1.length}`);

// ───────────────────────────────────────────────────────────
// 2) 超长名称截断（任务二）
// ───────────────────────────────────────────────────────────
const longName = '这是一个非常非常长的乡镇名称应当被截断';
const trunc = {
  views: [{
    key: 't', label: 'T', unit: '', fixed: 0,
    items: [
      { name: longName, value: 1 },
      { name: '短名', value: 2 },
      { name: '十二个汉字刚刚好好', value: 3 },       // 恰好 9 字，不截断
      { name: '😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀', value: 4 }, // emoji 码点截断
    ],
  }],
};
const { config: c2, warns: w2 } = normalizeConfig(trunc);
const items2 = c2.views[0].items;
ok('截断：超长名称已截断为 13 字符（12 字 + …）',
  items2[0].name.length === 13 && items2[0].name.endsWith('…'),
  `"${items2[0].name}" (len=${items2[0].name.length})`);
ok('截断：短名称保持不变', items2[1].name === '短名', items2[1].name);
ok('截断：恰好上限的名称不截断', items2[2].name === '十二个汉字刚刚好好', items2[2].name);
ok('截断：emoji 按码点截断不产生乱码',
  Array.from(items2[3].name).length === 13 && items2[3].name.endsWith('…'),
  `"${items2[3].name}"`);
ok('截断：触发告警', w2.some((w) => w.includes('名称过长')), w2.join(' | '));

// truncateName 纯函数边界
ok('truncateName：null → 空串', truncateName(null) === '', JSON.stringify(truncateName(null)));
ok('truncateName：非字符串 → 空串', truncateName(123) === '', JSON.stringify(truncateName(123)));
ok('truncateName：首尾空白已裁剪', truncateName('  甲  ') === '甲', truncateName('  甲  '));
ok('truncateName：自定义上限', truncateName('ABCDEFGHIJ', 3) === 'ABC…', truncateName('ABCDEFGHIJ', 3));

// ───────────────────────────────────────────────────────────
// 3) 顶层与 views 的兜底（不抛异常）
// ───────────────────────────────────────────────────────────
const { config: c3, warns: w3 } = normalizeConfig(null);
ok('兜底：null 配置不抛异常且返回空 views', Array.isArray(c3.views) && c3.views.length === 0, '');
ok('兜底：null 配置有告警', w3.length > 0, w3.join(' | '));

const { config: c4 } = normalizeConfig({ views: 'not-an-array' });
ok('兜底：views 非数组 → 空 views', c4.views.length === 0, '');

const { config: c5 } = normalizeConfig({ views: [{ items: [] }] });
ok('兜底：items 为空的视图被丢弃', c5.views.length === 0, '');

const { config: c6 } = normalizeConfig({ revealRatio: 'xx', durationMs: -5, views: [] });
ok('兜底：revealRatio 非法 → 回退 0.72', c6.revealRatio === 0.72, String(c6.revealRatio));
// v2.6：durationMs 非法 → 不再硬回退 7200，而是交由 barIntervalMs 推导
//   （views 为空 → 柱体数量按 1 计；默认间隔 2000 / 0.72 ≈ 2778ms）
ok(
  '兜底：durationMs 非法 → 由间隔推导（views 空时 ≈ 2778ms）',
  c6.durationMs === Math.round(2000 / 0.72),
  String(c6.durationMs),
);

// 极端：正常配置不被误伤（补齐 revealRatio / durationMs，避免触发"缺失即告警"逻辑）
const { config: c7, warns: w7 } = normalizeConfig({
  revealRatio: 0.7,
  durationMs: 6000,
  views: [{ key: 'a', label: 'A', unit: 'u', fixed: 2, items: [{ name: '甲', value: 1 }, { name: '乙', value: 2 }] }],
});
ok('正常配置：零告警通过', w7.length === 0, w7.join(' | '));
ok('正常配置：条目完整保留', c7.views[0].items.length === 2, '');

// ───────────────────────────────────────────────────────────
// 4) 形状（shape）规范化
// ───────────────────────────────────────────────────────────
ok('SHAPES：共 5 种形状', Array.isArray(SHAPES) && SHAPES.length === 5, SHAPES.join(','));
ok('SHAPES：包含 bar/cube/cylinder/rounded/sphere',
  ['bar', 'cube', 'cylinder', 'rounded', 'sphere'].every((s) => SHAPES.includes(s)), SHAPES.join(','));

ok('normalizeShape：合法值原样返回', normalizeShape('cylinder') === 'cylinder', String(normalizeShape('cylinder')));
ok('normalizeShape：大小写不敏感', normalizeShape('SPHERE') === 'sphere', String(normalizeShape('SPHERE')));
ok('normalizeShape：首尾空白裁剪', normalizeShape('  cube  ') === 'cube', String(normalizeShape('  cube  ')));
ok('normalizeShape：非法值 → null', normalizeShape('pyramid') === null, String(normalizeShape('pyramid')));
ok('normalizeShape：非字符串 → null',
  normalizeShape(123) === null && normalizeShape(null) === null && normalizeShape(undefined) === null && normalizeShape({}) === null, '');

// 缺省：未指定 shape / defaultShape → 均为 'bar'，且不产生告警
const { config: c8, warns: w8 } = normalizeConfig({
  revealRatio: 0.7, durationMs: 6000,
  views: [{ key: 'a', label: 'A', unit: 'u', fixed: 0, items: [{ name: '甲', value: 1 }, { name: '乙', value: 2 }] }],
});
ok('shape 缺省：顶层 defaultShape → bar', c8.defaultShape === 'bar', String(c8.defaultShape));
ok('shape 缺省：视图 shape → 继承 bar', c8.views[0].shape === 'bar', String(c8.views[0].shape));
ok('shape 缺省：不产生告警', w8.length === 0, w8.join(' | '));

// 顶层默认 + 视图覆盖
const { config: c9, warns: w9 } = normalizeConfig({
  revealRatio: 0.7, durationMs: 6000, defaultShape: 'sphere',
  views: [
    { key: 'a', label: 'A', unit: 'u', fixed: 0, shape: 'cylinder', items: [{ name: '甲', value: 1 }] },
    { key: 'b', label: 'B', unit: 'u', fixed: 0, items: [{ name: '乙', value: 2 }] },
  ],
});
ok('shape：视图覆盖顶层默认', c9.views[0].shape === 'cylinder', String(c9.views[0].shape));
ok('shape：未指定视图继承顶层默认', c9.views[1].shape === 'sphere', String(c9.views[1].shape));

// 非法值：回退 + 告警（顶层与视图各一）
const { config: c10, warns: w10 } = normalizeConfig({
  revealRatio: 0.7, durationMs: 6000, defaultShape: 'pyramid',
  views: [{ key: 'a', label: 'A', unit: 'u', fixed: 0, shape: 'hexagon', items: [{ name: '甲', value: 1 }] }],
});
ok('shape 非法：顶层回退 bar', c10.defaultShape === 'bar', String(c10.defaultShape));
ok('shape 非法：视图回退 bar', c10.views[0].shape === 'bar', String(c10.views[0].shape));
ok('shape 非法：顶层与视图各产生一条告警',
  w10.filter((w) => /shape/i.test(w)).length === 2, w10.filter((w) => /shape/i.test(w)).join(' | '));

// ═══════════════════════════════════════════════════════════
// 6) v2 数据模板（schemaVersion / dataset / entity / metrics[] / entities[]）
//    —— 双格式自动识别 + v2→内部格式适配
// ═══════════════════════════════════════════════════════════

// 6.1 判别：有 metrics 无 views → v2；纯 views → 旧格式；两者都有 → 以 views 为准
ok('判别：有 metrics[] 无 views[] → v2', looksLikeV2({ metrics: [], entities: [] }) === true, '');
ok('判别：schemaVersion 存在 → v2', looksLikeV2({ schemaVersion: '1.0' }) === true, '');
ok('判别：纯 views[] → 旧格式', looksLikeV2({ views: [{ items: [] }] }) === false, '');
ok('判别：views[] + metrics[] 同时存在 → 以 views 为准（旧格式）',
  looksLikeV2({ views: [{ items: [] }], metrics: [{ key: 'a' }] }) === false, '');
ok('判别：null / 非对象 → 旧格式（交由旧分支兜底）',
  looksLikeV2(null) === false && looksLikeV2('x') === false && looksLikeV2(123) === false, '');

// 6.2 dataset.name → title；source + notes[] → subtitle（拼接顺序与分隔符）
const v2Basic = {
  schemaVersion: '1.0',
  dataset: {
    id: 'demo', name: '示范数据集',
    source: '示范来源',
    notes: ['注一', '注二'],
  },
  entity: { idField: 'id', nameField: 'name', groupField: 'group' },
  metrics: [{ key: 'm1', label: '指标一', unit: '个', decimals: 1, missingPolicy: 'skip' }],
  entities: [
    { id: 'a', name: '甲', group: '镇', metrics: { m1: 1 } },
    { id: 'b', name: '乙', group: '镇', metrics: { m1: 2 } },
  ],
  theme: 'tech', defaultShape: 'bar', revealRatio: 0.7, durationMs: 6000,
};
const b2 = normalizeConfig(v2Basic);
ok('v2：dataset.name → title', b2.config.title === '示范数据集', b2.config.title);
ok('v2：source + notes[] → subtitle（顺序 + 分隔符）',
  b2.config.subtitle === '示范来源 · 注一 · 注二', b2.config.subtitle);
ok('v2：metric.decimals → view.fixed（0..6 夹紧）', b2.config.views[0].fixed === 1, String(b2.config.views[0].fixed));
ok('v2：entity[nameField] → item.name；entity.metrics[key] → item.value',
  b2.config.views[0].items.map((i) => `${i.name}=${i.value}`).join(',') === '甲=1,乙=2',
  b2.config.views[0].items.map((i) => `${i.name}=${i.value}`).join(','));
ok('v2：theme/defaultShape/revealRatio/durationMs 透传',
  b2.config.theme === 'tech' && b2.config.defaultShape === 'bar' &&
  b2.config.revealRatio === 0.7 && b2.config.durationMs === 6000, '');
ok('v2：合法模板零告警', b2.warns.length === 0, b2.warns.join(' | '));

// decimals 越界夹紧
const b2d = normalizeConfig({
  ...v2Basic,
  metrics: [
    { key: 'm1', label: 'A', unit: '', decimals: -3, missingPolicy: 'skip' },
    { key: 'm2', label: 'B', unit: '', decimals: 99, missingPolicy: 'skip' },
    { key: 'm3', label: 'C', unit: '', decimals: 'x', missingPolicy: 'skip' },
  ],
  entities: [
    { id: 'a', name: '甲', metrics: { m1: 1, m2: 2, m3: 3 } },
    { id: 'b', name: '乙', metrics: { m1: 4, m2: 5, m3: 6 } },
  ],
});
ok('v2：decimals 越界/非法 → 夹紧至 [0,6]（-3→0, 99→6, 非法→0）',
  b2d.config.views.map((v) => v.fixed).join(',') === '0,6,0',
  b2d.config.views.map((v) => v.fixed).join(','));

// 6.3 enabled:false 默认不生成视图；includeDisabled:true 时生成
const v2Enabled = {
  schemaVersion: '1.0',
  dataset: { id: 'd', name: 'T' },
  metrics: [
    { key: 'on', label: '启用', unit: '个', enabled: true, missingPolicy: 'skip' },
    { key: 'off', label: '禁用', unit: '个', enabled: false, missingPolicy: 'skip' },
    { key: 'def', label: '缺省', unit: '个', missingPolicy: 'skip' },
  ],
  entities: [{ id: 'a', name: '甲', metrics: { on: 1, off: 2, def: 3 } }],
};
const e2 = normalizeConfig(v2Enabled);
ok('v2：enabled:false 默认不生成视图（on + 缺省=启用）',
  e2.config.views.map((v) => v.label).join(',') === '启用,缺省',
  e2.config.views.map((v) => v.label).join(','));
const e2i = normalizeConfig(v2Enabled, { includeDisabled: true });
ok('v2：includeDisabled:true 时禁用视图也被生成',
  e2i.config.views.map((v) => v.label).join(',') === '启用,禁用,缺省',
  e2i.config.views.map((v) => v.label).join(','));

// 6.4 missingPolicy 三态：skip 减条 / zero 补 0 / disable 跳过整视图
const v2Policy = {
  schemaVersion: '1.0',
  dataset: { id: 'd', name: 'T' },
  metrics: [
    { key: 'sk', label: 'SKIP', unit: '个', missingPolicy: 'skip' },
    { key: 'ze', label: 'ZERO', unit: '个', missingPolicy: 'zero' },
    { key: 'di', label: 'DISABLE', unit: '个', missingPolicy: 'disable' },
  ],
  entities: [
    { id: 'a', name: '甲', metrics: { sk: 1, ze: 2, di: 3 } },
    { id: 'b', name: '乙', metrics: { sk: 9, ze: 8 } },           // 缺 di
    { id: 'c', name: '丙', metrics: { } },                         // 全缺
  ],
};
const p2 = normalizeConfig(v2Policy);
const vSk = p2.config.views.find((v) => v.label === 'SKIP');
const vZe = p2.config.views.find((v) => v.label === 'ZERO');
const vDi = p2.config.views.find((v) => v.label === 'DISABLE');
ok('v2 missingPolicy=skip：缺失条目被丢弃（丙 被剔除）',
  vSk.items.length === 2 && !vSk.items.some((i) => i.name === '丙'), vSk.items.map((i) => i.name).join(','));
ok('v2 missingPolicy=zero：缺失补 0（丙=0 保留）',
  vZe.items.length === 3 && vZe.items.find((i) => i.name === '丙')?.value === 0,
  vZe.items.map((i) => `${i.name}=${i.value}`).join(','));
ok('v2 missingPolicy=zero：已有值原样保留',
  vZe.items.find((i) => i.name === '乙')?.value === 8, String(vZe.items.find((i) => i.name === '乙')?.value));
ok('v2 missingPolicy=disable：整视图被跳过（缺 di 者存在 → 该视图不生成）',
  vDi === undefined, vDi ? '仍存在' : '已跳过');

// disable 策略但所有实体都有值 → 视图保留
const p2ok = normalizeConfig({
  schemaVersion: '1.0', dataset: { id: 'd', name: 'T' },
  metrics: [{ key: 'di', label: 'D', unit: '个', missingPolicy: 'disable' }],
  entities: [{ id: 'a', name: '甲', metrics: { di: 1 } }, { id: 'b', name: '乙', metrics: { di: 2 } }],
});
ok('v2 missingPolicy=disable：全员有值 → 视图正常保留',
  p2ok.config.views.length === 1 && p2ok.config.views[0].items.length === 2, `views=${p2ok.config.views.length}`);

// 6.5 非 null 非法值 → 归零 + 告警（沿用旧分支的取值规范）
const v2Bad = normalizeConfig({
  schemaVersion: '1.0', dataset: { id: 'd', name: 'T' },
  metrics: [{ key: 'm', label: 'M', unit: '个', missingPolicy: 'skip' }],
  entities: [
    { id: 'a', name: '甲', metrics: { m: 'abc' } },
    { id: 'b', name: '乙', metrics: { m: NaN } },
    { id: 'c', name: '丙', metrics: { m: Infinity } },
    { id: 'd', name: '丁', metrics: { m: -7 } },
    { id: 'e', name: '戊', metrics: { m: 5 } },
  ],
});
const vBad = v2Bad.config.views[0].items;
ok('v2：非法值(非数字/NaN/Infinity) → 归零',
  vBad.find((i) => i.name === '甲')?.value === 0 &&
  vBad.find((i) => i.name === '乙')?.value === 0 &&
  vBad.find((i) => i.name === '丙')?.value === 0,
  vBad.map((i) => `${i.name}=${i.value}`).join(','));
ok('v2：负值 → 取绝对值', vBad.find((i) => i.name === '丁')?.value === 7,
  String(vBad.find((i) => i.name === '丁')?.value));

// 6.6 highlightEntityId 命中项 highlight:true，其余 false
const v2Hl = normalizeConfig({
  schemaVersion: '1.0',
  dataset: { id: 'd', name: 'T', highlightEntityId: 'b' },
  metrics: [{ key: 'm', label: 'M', unit: '个', missingPolicy: 'skip' }],
  entities: [
    { id: 'a', name: '甲', metrics: { m: 1 } },
    { id: 'b', name: '乙', metrics: { m: 2 } },
    { id: 'c', name: '丙', metrics: { m: 3 } },
  ],
});
const hlItems = v2Hl.config.views[0].items;
ok('v2 highlightEntityId：命中项 highlight=true',
  hlItems.find((i) => i.name === '乙')?.highlight === true,
  hlItems.map((i) => `${i.name}:${i.highlight}`).join(','));
ok('v2 highlightEntityId：非命中项 highlight=false',
  hlItems.find((i) => i.name === '甲')?.highlight === false &&
  hlItems.find((i) => i.name === '丙')?.highlight === false, '');
ok('v2 highlightEntityId：命中项保留 _id 便于表格编辑后复现',
  hlItems.find((i) => i.name === '乙')?._id === 'b', String(hlItems.find((i) => i.name === '乙')?._id));

// highlight 也支持按名称匹配 + opts 覆盖
const hlByName = normalizeConfig({
  schemaVersion: '1.0', dataset: { id: 'd', name: 'T' },
  metrics: [{ key: 'm', label: 'M', unit: '个', missingPolicy: 'skip' }],
  entities: [{ id: 'a', name: '甲', metrics: { m: 1 } }, { id: 'b', name: '乙', metrics: { m: 2 } }],
}, { highlightEntityId: '甲' });
ok('v2 highlight：支持传入 opts.highlightEntityId 且可按名称命中',
  hlByName.config.views[0].items.find((i) => i.name === '甲')?.highlight === true, '');

// 无 highlightEntityId → 全部 false，不报错
const noHl = normalizeConfig(v2Basic);
ok('v2 无 highlightEntityId：默认无高亮',
  noHl.config.views[0].items.every((i) => i.highlight === false), '');

// 6.7 边界：空 entities / 全 metric 禁用 → views.length === 0 且不抛异常
let edgeOk = true, edgeCfg = null;
try {
  edgeCfg = normalizeConfig({ schemaVersion: '1.0', metrics: [], entities: [] });
} catch (err) { edgeOk = false; }
ok('v2 边界：空 entities + 空 metrics → 不抛异常且 views=0',
  edgeOk && edgeCfg.config.views.length === 0, `views=${edgeCfg?.config.views.length}`);

let edge2Ok = true, edge2Cfg = null;
try {
  edge2Cfg = normalizeConfig({
    schemaVersion: '1.0', dataset: { id: 'd', name: 'T' },
    metrics: [{ key: 'a', label: 'A', unit: '', enabled: false, missingPolicy: 'skip' }],
    entities: [{ id: 'x', name: '甲', metrics: { a: 1 } }],
  });
} catch (err) { edge2Ok = false; }
ok('v2 边界：全 metric 禁用 → 不抛异常且 views=0',
  edge2Ok && edge2Cfg.config.views.length === 0, `views=${edge2Cfg?.config.views.length}`);

// 6.8 宽松兜底：缺 metrics[] 但有 entities[].metrics → 推断出视图
const inferred = normalizeConfig({
  schemaVersion: '1.0', dataset: { id: 'd', name: 'T' },
  entities: [
    { id: 'a', name: '甲', metrics: { pop: 10, area: 20 } },
    { id: 'b', name: '乙', metrics: { pop: 30, area: 40 } },
  ],
});
ok('v2 兜底：缺 metrics[] → 从 entities[].metrics 推断视图（2 个）',
  inferred.config.views.length === 2, `views=${inferred.config.views.length}, keys=${inferred.config.views.map((v) => v.key).join(',')}`);
ok('v2 兜底：推断视图条目数量正确',
  inferred.config.views.every((v) => v.items.length === 2),
  inferred.config.views.map((v) => `${v.key}:${v.items.length}`).join(','));

// 6.9 宽松兜底：v2 生成视图经旧分支再次规范化 → 结果稳定（幂等）
const once = normalizeConfig(v2Basic).config;
const twice = normalizeConfig(v2Basic).config;
ok('v2 幂等：同输入两次规范化结果一致',
  JSON.stringify(once) === JSON.stringify(twice), '');

// 6.10 默认数据集：内置 v2 模板可用
const { DEFAULT_CONFIG } = await import('../../src/core/config.js');
ok('默认数据集：内置 v2 模板生成 ≥1 个视图',
  DEFAULT_CONFIG.views.length >= 1, `views=${DEFAULT_CONFIG.views.length}`);
ok('默认数据集：标题非空', typeof DEFAULT_CONFIG.title === 'string' && DEFAULT_CONFIG.title.length > 0, DEFAULT_CONFIG.title);

// ───────────────────────────────────────────────────────────
// 7) v2.6 视频规格：画幅比例（video.js）+ 播放间隔推导
// ───────────────────────────────────────────────────────────

// 7.1 比例表完整性
ok('video：四种比例齐备且顺序固定',
  ASPECT_KEYS.join(',') === '16:9,9:16,1:1,4:3' && ASPECT_KEYS.every((k) => ASPECTS[k]),
  ASPECT_KEYS.join(','));
ok('video：默认为 16:9', DEFAULT_ASPECT === '16:9', DEFAULT_ASPECT);

// 7.2 normalizeAspect：合法 / 像素写法 / 非法
ok('video：normalizeAspect 合法值原样返回', normalizeAspect('9:16') === '9:16' && normalizeAspect('1:1') === '1:1');
ok('video：normalizeAspect 容错「1920x1080」→ 16:9', normalizeAspect('1920x1080') === '16:9', String(normalizeAspect('1920x1080')));
ok('video：normalizeAspect 容错「2160×3840」→ 9:16', normalizeAspect('2160×3840') === '9:16', String(normalizeAspect('2160×3840')));
ok('video：normalizeAspect 非法返回 null', normalizeAspect('7:3') === null && normalizeAspect(null) === null && normalizeAspect(123) === null);
ok('video：ratioOf 非法输入回退 16:9 数值', ratioOf('nope') === 16 / 9, String(ratioOf('nope')));

// 7.3 pixelSizeFor：长边固定 / 偶数 / 比例正确
{
  const cases = [
    ['16:9', 1920, 1080], ['9:16', 1080, 1920], ['1:1', 1920, 1920], ['4:3', 1920, 1440],
  ];
  let allOk = true;
  const detail = [];
  for (const [k, w, h] of cases) {
    const r = pixelSizeFor(k, 1920);
    const okc = r.width === w && r.height === h && r.width % 2 === 0 && r.height % 2 === 0;
    if (!okc) allOk = false;
    detail.push(`${k}→${r.width}×${r.height}`);
  }
  ok('video：pixelSizeFor 长边 1920 且为偶数（四比例）', allOk, detail.join(' '));
}
ok('video：pixelSizeFor 非法比例回退 16:9', pixelSizeFor('xx', 1920).width === 1920, String(pixelSizeFor('xx', 1920).width));
ok('video：pixelSizeFor 长边可配置（1080 → 16:9 = 1080×608）',
  pixelSizeFor('16:9', 1080).width === 1080 && pixelSizeFor('16:9', 1080).height === 608,
  `${pixelSizeFor('16:9', 1080).width}×${pixelSizeFor('16:9', 1080).height}`);

// 7.4 deriveDuration：语义正确 / 边界 / 与 intervalFromDuration 互逆
ok('video：默认间隔为 2000ms', DEFAULT_BAR_INTERVAL_MS === 2000 && INTERVAL_MIN === 200 && INTERVAL_MAX === 20000,
  `${DEFAULT_BAR_INTERVAL_MS}/${INTERVAL_MIN}..${INTERVAL_MAX}`);
{
  const d = deriveDuration(10, 2000, 0.72);
  ok('video：deriveDuration = n×interval/revealRatio', d === Math.round(10 * 2000 / 0.72), String(d));
  ok('video：deriveDuration ≤0 柱数回退 1（不除零）', deriveDuration(0, 2000, 0.72) === Math.round(2000 / 0.72), String(deriveDuration(0, 2000, 0.72)));
  ok('video：deriveDuration 非法间隔回退默认间隔',
    deriveDuration(5, NaN, 0.72) === Math.round(5 * 2000 / 0.72), String(deriveDuration(5, NaN, 0.72)));
  ok('video：deriveDuration 间隔 clamp 上界 20000',
    deriveDuration(1, 999999, 0.72) === Math.round(20000 / 0.72), String(deriveDuration(1, 999999, 0.72)));
  ok('video：deriveDuration 间隔 clamp 下界 200',
    deriveDuration(1, 1, 0.72) === Math.round(200 / 0.72), String(deriveDuration(1, 1, 0.72)));
  ok('video：revealRatio 越大 → 总时长越短（揭示段更短）',
    deriveDuration(10, 2000, 0.5) > deriveDuration(10, 2000, 0.9),
    `${deriveDuration(10, 2000, 0.5)} > ${deriveDuration(10, 2000, 0.9)}`);
  // 互逆：由时长反推的间隔应约等于原间隔
  const back = intervalFromDuration(d, 10, 0.72);
  ok('video：intervalFromDuration 与 deriveDuration 互逆（误差 ≤1ms）', Math.abs(back - 2000) <= 1, `回推=${back}`);
}

// 7.5 normalizeConfig 对新增字段的兜底
{
  const { config: c1 } = normalizeConfig({
    aspect: '9:16', barIntervalMs: 3000, source: 'S', notes: ['a', '', 'b'],
    views: [{ key: 'v', items: [{ name: 'x', value: 1 }, { name: 'y', value: 2 }] }],
  });
  ok('config：aspect 透传并规范化', c1.aspect === '9:16', c1.aspect);
  ok('config：barIntervalMs 透传', c1.barIntervalMs === 3000, String(c1.barIntervalMs));
  ok('config：source 透传', c1.source === 'S', c1.source);
  ok('config：notes 过滤空项', c1.notes.length === 2, c1.notes.join('/'));
  ok('config：未给 durationMs → 由 interval 推导（2×3000/0.72）',
    c1.durationMs === Math.round(2 * 3000 / 0.72) && c1._durationExplicit === false, String(c1.durationMs));
}
{
  const { config: c2 } = normalizeConfig({
    durationMs: 4000, barIntervalMs: 3000, aspect: 'bad',
    views: [{ items: [{ name: 'x', value: 1 }] }],
  });
  ok('config：显式 durationMs 优先（_durationExplicit=true）',
    c2.durationMs === 4000 && c2._durationExplicit === true, String(c2.durationMs));
  ok('config：非法 aspect 回退 16:9 并告警', c2.aspect === '16:9', c2.aspect);
}
{
  // 时长按「最大项数」推导（多视图时以最长一屏为准）
  const { config: c3 } = normalizeConfig({
    barIntervalMs: 1000, revealRatio: 0.5,
    views: [
      { key: 'a', items: [{ name: '1', value: 1 }] },
      { key: 'b', items: [{ name: '1', value: 1 }, { name: '2', value: 2 }, { name: '3', value: 3 }, { name: '4', value: 4 }] },
    ],
  });
  ok('config：多视图时长按最大项数推导（4×1000/0.5）', c3.durationMs === 8000, String(c3.durationMs));
}
{
  // notes 非数组 → 忽略并告警
  const { config: c4, warns: w4 } = normalizeConfig({
    notes: '这不是数组', views: [{ items: [{ name: 'x', value: 1 }] }],
  });
  ok('config：notes 非数组 → 回退空数组并告警',
    Array.isArray(c4.notes) && c4.notes.length === 0 && w4.some((w) => w.includes('notes')), c4.notes.length + '|' + w4.length);
}
{
  // v2 模板内声明 aspect / barIntervalMs → 经 adapt 透传到规范化结果
  const v2 = { schemaVersion: '1.0', dataset: { name: 'T', source: 'SRC', notes: ['N1'] }, aspect: '1:1', barIntervalMs: 4000,
    entities: [{ id: 'a', name: '甲', metrics: { m: 1 } }, { id: 'b', name: '乙', metrics: { m: 2 } }],
    metrics: [{ key: 'm', label: 'M' }] };
  const { config: c5 } = normalizeConfig(v2);
  ok('config：v2 模板 aspect 透传', c5.aspect === '1:1', c5.aspect);
  ok('config：v2 模板 barIntervalMs 透传并推导时长', c5.barIntervalMs === 4000 && c5.durationMs === Math.round(2 * 4000 / 0.72),
    `${c5.barIntervalMs}|${c5.durationMs}`);
  ok('config：v2 模板 source 单独保留（与 subtitle 并存）',
    c5.source === 'SRC' && c5.subtitle.includes('SRC') && c5.notes[0] === 'N1',
    `source=${c5.source} sub=${c5.subtitle} notes=${c5.notes.length}`);
}
{
  // dataset.aspect 也可声明（模板作者两种写法都常见）
  const v2b = { schemaVersion: '1.0', dataset: { name: 'T', aspect: '4:3' }, entities: [{ id: 'a', name: '甲', metrics: { m: 1 } }], metrics: [{ key: 'm' }] };
  const { config: c6 } = normalizeConfig(v2b);
  ok('config：v2 dataset.aspect 亦可识别', c6.aspect === '4:3', c6.aspect);
}
{
  // 内置默认数据集带默认画幅与间隔
  ok('默认数据集：aspect 已定义', typeof DEFAULT_CONFIG.aspect === 'string' && !!ASPECTS[DEFAULT_CONFIG.aspect], DEFAULT_CONFIG.aspect);
  ok('默认数据集：barIntervalMs 已定义', DEFAULT_CONFIG.barIntervalMs === 2000, String(DEFAULT_CONFIG.barIntervalMs));
  ok('默认数据集：总时长由间隔推导（28 项 × 2000 / 0.72）',
    DEFAULT_CONFIG.durationMs === Math.round(28 * 2000 / 0.72), String(DEFAULT_CONFIG.durationMs));
}
{
  // v2.7.1 信息层：buildOverlayModel 的 portrait 口径 = 取景框 w/h < 1
  // （App.vue 的 .viewport.portrait 类与 Canvas 录制层共用该口径，保证预览=出片）
  const base = { config: { title: 'T' }, view: { label: 'L', unit: 'U', fixed: 0 }, active: null,
    theme: { accent: '#35e8ff', ink: '#eaf9ff' } };
  const land = buildOverlayModel({ ...base, size: { w: 1600, h: 900 }, portrait: false });
  const port = buildOverlayModel({ ...base, size: { w: 456, h: 810 }, portrait: true });
  ok('overlay：横构图模型 portrait=false 且含标题', land.portrait === false && land.title === 'T');
  // ★ v2.8.3：用户指令「彻底移除当前目标卡」→ 模型不再携带 target 字段。
  //   断言 `!('target' in model)`：比 `=== null` 更严格，保证字段本身被删除
  //   （若将来有人把它加回来，此断言立刻失败）。
  ok('overlay：模型已无 target 字段（v2.8.3 移除当前目标卡）', !('target' in port) && !('target' in land));
  ok('overlay：竖构图模型 portrait=true', port.portrait === true);
  ok('overlay：竖构图排版度量按取景框宽 clamp', port.m.title <= 30 && port.m.title >= 15, String(port.m.title));
}
{
  // ★ v2.8.0 信息层收敛：overlayMetrics() 是全项目唯一的排版系数来源。
  //   本组断言锁定"字段集合契约" —— App.vue 的 cssVars 注入与 CSS 消费、
  //   paintOverlay 的绘制，全都读这些键名；缺键会导致 CSS 变量变成空值（布局塌陷），
  //   改键名会静默地让 DOM 与 Canvas 漂移。因此逐个键存在性 + 数值合理性都要卡住。
  const M = overlayMetrics(1600, 900);
  const KEYS = ['padX', 'padY', 'title', 'sub', 'subIndent', 'name', 'val', 'panelW',
    'panelPadY', 'panelPadX', 'barGapS', 'chipK', 'chipV', 'chipPadY', 'chipPadKX',
    'chipPadVX', 'rank', 'rankB', 'unit', 'src', 'dot', 'gapS'];
  const missing = KEYS.filter((k) => typeof M[k] !== 'number' || !Number.isFinite(M[k]));
  ok('overlayMetrics：字段集合完整（CSS 与 Canvas 的共用契约）', missing.length === 0, missing.join(','));
  ok('overlayMetrics：全部为有限正数（无 NaN/0/负值）',
    KEYS.every((k) => M[k] > 0), JSON.stringify(M));
  // 单调性：取景框变大 → 度量不减（clamp 区间内应严格增大，触顶后持平）
  const S = overlayMetrics(800, 450), L = overlayMetrics(2400, 1350);
  const nonMono = KEYS.filter((k) => !(L[k] >= S[k]));
  ok('overlayMetrics：随取景框增大单调不减', nonMono.length === 0, nonMono.join(','));
  // clamp 上下限确实生效（极大/极小尺寸都不越界）
  const tiny = overlayMetrics(1, 1), huge = overlayMetrics(1e6, 1e6);
  ok('overlayMetrics：极小尺寸不塌陷（下界生效）',
    tiny.padX >= 14 && tiny.title >= 15 && tiny.src >= 8, JSON.stringify(tiny));
  ok('overlayMetrics：极大尺寸不失控（上界生效）',
    huge.padX <= 44 && huge.title <= 30 && huge.panelW <= 300, JSON.stringify(huge));
  // 同尺寸幂等（同输入必同输出，保证 DOM/Canvas 两次独立调用不漂移）
  const a1 = overlayMetrics(1600, 900), a2 = overlayMetrics(1600, 900);
  ok('overlayMetrics：同输入幂等（DOM/Canvas 两次调用一致）',
    KEYS.every((k) => a1[k] === a2[k]));
}

// ───────────────────────────────────────────────────────────
// A) v2 模板往返无损（v2.10.0「单模板驱动全部动态数据」的地基）
//   主张：内部 config ──toV2Template──▶ v2 模板 ──normalizeConfig──▶ 同一个内部 config。
//   用 JSON.stringify 逐字节比较（比字段逐个断言更严格：顺序、多余键、缺键都能抓到）。
// ───────────────────────────────────────────────────────────
{
  const SAMPLE = JSON.parse(readFileSync(new URL('../../samples/huining-v2.json', import.meta.url), 'utf8'));
  const c1 = normalizeConfig(SAMPLE).config;
  const { template, warns } = toV2Template(c1);
  ok('A1 真实样例导出零告警', warns.length === 0, warns.join(' | '));
  ok('A2 ★ 导出物不含顶层 views（否则会被判成旧格式而丢弃 metrics/entities）',
    !('views' in template), Object.keys(template).join(','));
  ok('A3 导出物仍被识别为 v2', looksLikeV2(template) === true);
  ok('A4 ★ 往返 JSON 逐字节相等（无损核心断言）',
    JSON.stringify(c1) === JSON.stringify(normalizeConfig(template).config));
  ok('A5 维度计数：3 视图 / 28 实体',
    template.metrics.length === 3 && template.entities.length === 28,
    `${template.metrics.length} 视图 / ${template.entities.length} 实体`);
  ok('A6 导出物含 render 段（展示配置集中处）',
    template.render && typeof template.render === 'object' && !Array.isArray(template.render));
  ok('A7 高亮主角已回写（id 优先）', template.dataset.highlightEntityId === 'huishi',
    String(template.dataset.highlightEntityId));
  ok('A8 实体 metrics 与视图 key 一一对应',
    template.entities.every((e) => Object.keys(e.metrics).every((k) => template.metrics.some((m) => m.key === k))));

  // 显式锁定时长：必须原样往返（含内部标记），否则用户锁的时长会被"推导"覆盖
  const c3 = { ...c1, durationMs: 12345, _durationExplicit: true };
  const t3 = toV2Template(c3).template;
  const b3 = normalizeConfig(t3).config;
  ok('A9 显式锁定时 durationMs 写入 render', t3.render.durationMs === 12345, String(t3.render.durationMs));
  ok('A10 显式锁定时 durationExplicit 一并写入', t3.render.durationExplicit === true);
  ok('A11 显式锁定往返：时长与标记都保持',
    b3.durationMs === 12345 && b3._durationExplicit === true,
    `${b3.durationMs} / ${b3._durationExplicit}`);
  ok('A12 显式锁定往返无损', JSON.stringify({ ...c3, views: b3.views }) === JSON.stringify(b3));

  // 未锁定：绝不能写 durationMs（写了下次导入就被当显式值锁死，丢失自动推导能力）
  ok('A13 未锁定时 render 不写 durationMs', !('durationMs' in template.render));
  ok('A14 未锁定时 render 不写 durationExplicit', !('durationExplicit' in template.render));

  // decimals 省略策略：0 值省略（读取端默认即 0），非 0 保留
  ok('A15 decimals 仅在非 0 时写出',
    template.metrics.find((m) => m.key === 'area')?.decimals === 1 &&
    !('decimals' in template.metrics.find((m) => m.key === 'population')),
    JSON.stringify(template.metrics.map((m) => [m.key, m.decimals])));

  // 二次往返稳定（幂等 —— 模板再导一次结果不变）
  const t2 = toV2Template(normalizeConfig(template).config).template;
  ok('A16 toV2Template 幂等（二次导出与首次逐字节相同）',
    JSON.stringify(t2) === JSON.stringify(template));
}

// ───────────────────────────────────────────────────────────
// B) looksLikeV2 判别 + 导出物与旧格式的边界（保护 ?cfg= 契约）
// ───────────────────────────────────────────────────────────
{
  const base = {
    schemaVersion: '1.0',
    dataset: { name: 'x' },
    metrics: [{ key: 'a', label: 'A' }],
    entities: [{ id: 'e1', name: 'E1', metrics: { a: 1 } }],
  };
  ok('B1 纯 v2 形状 → true', looksLikeV2(base) === true);
  // ★ 这条是 A2 的反面证据：只要带 views 就会被判旧格式，metrics/entities 静默丢弃
  ok('B2 ★ v2 形状 + 顶层 views → false（这就是导出物绝不能写 views 的原因）',
    looksLikeV2({ ...base, views: [] }) === false);
  ok('B3 旧格式（仅 views）→ false',
    looksLikeV2({ title: 't', views: [{ key: 'a', items: [{ name: 'n', value: 1 }] }] }) === false);
  ok('B4 render 段不影响判别（判别只看 views/metrics/entities/schemaVersion）',
    looksLikeV2({ ...base, render: { theme: 'tech' } }) === true);
  ok('B5 只有 dataset 外壳 → false（交给旧路径告警"缺 views"）',
    looksLikeV2({ dataset: { name: 'x' } }) === false);
  ok('B6 null / 数组 / 原始值 → false',
    looksLikeV2(null) === false && looksLikeV2([]) === false && looksLikeV2('x') === false);
  ok('B7 半成品 v2（只有 entities）→ true（尽力解析而非丢弃）',
    looksLikeV2({ entities: base.entities }) === true);
}

// ───────────────────────────────────────────────────────────
// C) template.js 工具函数与边界
// ───────────────────────────────────────────────────────────
{
  ok('C1 withDefined 去掉 undefined 但保留 null（null = 明确缺失，语义不同）',
    JSON.stringify(withDefined({ a: 1, b: undefined, c: null, d: '' })) === '{"a":1,"c":null,"d":""}',
    JSON.stringify(withDefined({ a: 1, b: undefined, c: null, d: '' })));
  ok('C2 slugify 保留 ASCII 字母数字并归一分隔符', slugify('Hello World 2026') === 'hello-world-2026',
    slugify('Hello World 2026'));
  ok('C3 slugify 对纯中文返回空串（由调用方回退到名称，不强行音译）', slugify('会师镇') === '', `"${slugify('会师镇')}"`);
  ok('C4 slugify 去首尾连字符且折叠连续分隔符', slugify('  --a  b--  ') === 'a-b', slugify('  --a  b--  '));

  // 缺 _id 的旧格式配置：应能用 name 作主键导出（并给出可读 id）
  const legacy = normalizeConfig({
    title: 'L', views: [{ key: 'v1', label: 'V', unit: '个', fixed: 0,
      items: [{ name: 'A', value: 3 }, { name: 'B', value: 2 }] }],
  }).config;
  const lt = toV2Template(legacy).template;
  ok('C5 旧格式（无 _id）也能导出：按 name 作主键',
    lt.entities.length === 2 && lt.entities.map((e) => e.name).join(',') === 'A,B',
    lt.entities.map((e) => e.id).join(','));
  ok('C6 旧格式导出后仍可被读回为 v2（views/metrics 对齐）',
    looksLikeV2(lt) === true && normalizeConfig(lt).config.views.length === 1 &&
    normalizeConfig(lt).config.views[0].items.length === 2);

  // 空配置：不抛异常，只给告警
  const e1 = toV2Template({ views: [] });
  ok('C7 空视图配置：不抛异常且给出告警', e1.warns.length === 1 && e1.template.metrics.length === 0,
    e1.warns.join('|'));
  const e2 = toV2Template(null);
  ok('C8 非法输入（null）：不抛异常且给出告警', e2.warns.length === 1, e2.warns.join('|'));

  // 多视图同实体：按 _id 归并成一行（这是 pivot 正确性的关键）
  const multi = normalizeConfig({
    views: [
      { key: 'pop', label: '人口', unit: '人', items: [{ name: '甲', value: 10, _id: 'a' }, { name: '乙', value: 5, _id: 'b' }] },
      { key: 'area', label: '面积', unit: 'km²', items: [{ name: '甲', value: 100, _id: 'a' }, { name: '乙', value: 50, _id: 'b' }] },
    ],
  }).config;
  const mt = toV2Template(multi).template;
  ok('C9 多视图 pivot：同 _id 的 2 视图归并为 2 行（不是 4 行）',
    mt.entities.length === 2 && mt.metrics.length === 2, `${mt.entities.length} 行 / ${mt.metrics.length} 列`);
  ok('C10 pivot 后每行同时持有两个维度的值',
    mt.entities.every((e) => e.metrics.pop != null && e.metrics.area != null),
    JSON.stringify(mt.entities));
  ok('C11 多视图往返无损（pivot 未丢任何值）',
    JSON.stringify(multi) === JSON.stringify(normalizeConfig(mt).config));

  // 视图 shape 与顶层 defaultShape 相同时应省略（读取端自然会回退）
  const sh = normalizeConfig({
    defaultShape: 'cylinder',
    views: [{ key: 'v', label: 'V', unit: '', shape: 'cylinder', items: [{ name: 'A', value: 1 }] }],
  }).config;
  const sht = toV2Template(sh).template;
  ok('C12 视图 shape 与 defaultShape 相同时省略，不同时写出',
    sht.metrics[0].shape === undefined, JSON.stringify(sht.metrics[0]));
  // ★ 无损性的适用边界（重要，勿删）：
  //   ① v2 来源的配置（items 带原生 _id）→ 逐字节无损（见 A4）。
  //   ② 旧格式来源（items 无 _id）→ 往返后会**新增** items[]._id（由 slugify(name) 生成）。
  //      这不是缺陷，而是"格式升格"的必然结果：v2 模板的 entities[] 必须有 id，
  //      导出时必须造一个；再导回内部格式时它就落成了 _id（adapt 端本就这么写）。
  //      影响面可控：仅多一个隐藏标识字段，渲染/数值/顺序全不变，且**第二次起稳定**。
  //      因此这里的断言分两层：剥掉 _id 后逐字节相等 + 二次往返完全幂等。
  const stripId = (c) => JSON.stringify({
    ...c,
    views: c.views.map((v) => ({ ...v, items: v.items.map(({ _id, ...r }) => r) })),
  });
  const shBack1 = normalizeConfig(sht).config;
  ok('C13 旧格式往返：shape 经 defaultShape 回退保持一致',
    shBack1.views[0].shape === sh.views[0].shape, `${sh.views[0].shape} → ${shBack1.views[0].shape}`);
  ok('C13b 旧格式往返：剥掉新增的 _id 后逐字节无损',
    stripId(sh) === stripId(shBack1));
  ok('C13c 旧格式往返：_id 由 slugify(name) 生成（稳定可读）',
    shBack1.views[0].items[0]._id === 'a', String(shBack1.views[0].items[0]._id));
  ok('C13d 旧格式往返：第二次起完全幂等（不再漂移）',
    JSON.stringify(shBack1) === JSON.stringify(normalizeConfig(toV2Template(shBack1).template).config));

  // 不支持的字段清单必须非空（README 与文档会引用它）
  ok('C14 不支持的字段清单已声明（供文档/UI 展示）',
    Array.isArray(V2_UNSUPPORTED_FIELDS) && V2_UNSUPPORTED_FIELDS.length >= 3,
    `${V2_UNSUPPORTED_FIELDS.length} 条`);

  // JSON 文本产物可直接 JSON.parse（下载通道用）
  const j = toV2TemplateJSON(legacy);
  let parsed = null;
  try { parsed = JSON.parse(j.text); } catch { /* 下条断言会失败 */ }
  ok('C15 toV2TemplateJSON 产出合法 JSON 文本',
    parsed && parsed.schemaVersion === '1.0' && j.text.endsWith('\n'));
}

console.log(`\n==== 单元测试汇总：${pass}/${pass + fail} 通过 ====`);
// ★ v2.10.0：补上退出码。此前失败也只 exit 0 ⇒ CI / npm run qa:all 会把红色的
//   测试当绿色放行（回归防护形同虚设）。这里显式把失败数映射为退出码。
if (fail > 0) process.exitCode = 1;
