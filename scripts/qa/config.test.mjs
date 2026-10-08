// 纯逻辑单元测试：normalizeConfig 的数据健壮性（任务三）
// 用法：node scripts/qa/config.test.mjs
// 无外部依赖，不需要浏览器 / 字体 / GL——直接以 Node 运行。
import { normalizeConfig, truncateName } from '../../src/core/config.js';

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
ok('兜底：durationMs 非法 → 回退 7200', c6.durationMs === 7200, String(c6.durationMs));

// 极端：正常配置不被误伤（补齐 revealRatio / durationMs，避免触发"缺失即告警"逻辑）
const { config: c7, warns: w7 } = normalizeConfig({
  revealRatio: 0.7,
  durationMs: 6000,
  views: [{ key: 'a', label: 'A', unit: 'u', fixed: 2, items: [{ name: '甲', value: 1 }, { name: '乙', value: 2 }] }],
});
ok('正常配置：零告警通过', w7.length === 0, w7.join(' | '));
ok('正常配置：条目完整保留', c7.views[0].items.length === 2, '');

console.log(`\n==== 单元测试汇总：${pass}/${pass + fail} 通过 ====`);
if (fail) process.exitCode = 1;
