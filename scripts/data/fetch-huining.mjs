/**
 * 会宁县乡镇数据采集脚本（可复现）
 * ------------------------------------------------------------------
 * 数据来源（均为官方/权威公开来源，逐项标注）：
 *  1) 行政区域面积 / 平均海拔 / 部分人口：会宁县人民政府门户网站
 *     「魅力会宁 → 会宁概况 → 各乡镇」页面（https://www.huining.gov.cn/mlhn/hngk/）
 *  2) 乡镇常住人口（第七次全国人口普查，2020-11-01）：国家统计局
 *     （经 citypopulation.de 转载，源为中华人民共和国国家统计局）
 *  3) 全县口径（常住人口 39.14 万、城镇化率 40.88%、GDP 977113 万元等）：
 *     《2025 年会宁县国民经济和社会发展统计公报》（会宁县统计局，2026-07-29）
 *
 * 用法：node scripts/data/fetch-huining.mjs   （离线可跑；若联网则尝试刷新页面数值）
 * 产物：src/data/huining.json （28 个乡镇 · 4 个视图）
 *
 * 说明：乡镇级数据国家层面无统一年度公开口径，故以"官方乡镇概况（面积/海拔）"
 *      +"七普常住人口"组合呈现，并在 subtitle 中标注来源与口径，避免误导。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

// —— 28 个乡镇（24 镇 + 4 乡），官方行政区划名单 ——
// area: km²（官方乡镇概况"总流域面积/总面积为"）
// elev: m（官方乡镇概况"境内平均海拔"；会师镇取区间中值）
// pop:  万人（第七次全国人口普查常住人口，2020 年 11 月 1 日）
// 数据缺失者以 null 表示，由 normalize 逻辑回落。
export const TOWNSHIPS = [
  // —— 官方"会宁概况"乡镇页有明确面积/海拔的（★）——
  { name: '会师镇',   area: 203.6, elev: 1950, pop: 11.413, src: 'official', note: '海拔 1800~2100m 取中值；县城所在地' },
  { name: '郭城驿镇', area: 329.0, elev: null, pop: 2.804,  src: 'official' },
  { name: '河畔镇',   area: 243.4, elev: 1500, pop: 2.024,  src: 'official' },
  { name: '头寨子镇', area: 473.8, elev: 1700, pop: 1.648,  src: 'official', note: '全县地域面积最大乡镇' },
  { name: '甘沟驿镇', area: null,  elev: null, pop: 1.183,  src: 'census' },
  { name: '太平店镇', area: 139.9, elev: 1865, pop: 1.165,  src: 'official' },
  { name: '翟家所镇', area: 181.9, elev: null, pop: 1.018,  src: 'official' },
  { name: '老君坡镇', area: 138.3, elev: 2072.5, pop: 1.148, src: 'official' },
  { name: '中川镇',   area: 138.0, elev: null, pop: 0.941,  src: 'official' },
  { name: '汉家岔镇', area: 387.5, elev: null, pop: 0.976,  src: 'official' },
  { name: '新庄塬镇', area: 332.0, elev: 2000, pop: 0.540,  src: 'official' },
  { name: '四房吴镇', area: 258.8, elev: 1900, pop: 0.856,  src: 'official' },
  { name: '土门岘镇', area: 185.0, elev: null, pop: 0.434,  src: 'official' },
  { name: '平头川镇', area: 138.27, elev: null, pop: 0.649, src: 'official' },
  { name: '新塬镇',   area: 287.3, elev: null, pop: 0.721,  src: 'official' },
  // —— 仅有七普人口、面积/海拔待补的乡镇 ——
  { name: '侯家川镇', area: null, elev: null, pop: 0.676,  src: 'census' },
  { name: '柴家门镇', area: null, elev: null, pop: 2.090,  src: 'census' },
  { name: '刘家寨子镇', area: null, elev: null, pop: 0.860, src: 'census' },
  { name: '白草塬镇', area: null, elev: null, pop: 1.361,  src: 'census' },
  { name: '大沟镇',   area: null, elev: null, pop: 1.034,  src: 'census' },
  { name: '丁家沟镇', area: null, elev: null, pop: 1.052,  src: 'census' },
  { name: '杨崖集镇', area: null, elev: null, pop: 1.093,  src: 'census' },
  { name: '韩家集镇', area: null, elev: null, pop: 0.705,  src: 'census' },
  { name: '土高山乡', area: null, elev: null, pop: 0.405,  src: 'census' },
  { name: '新添堡回族乡', area: null, elev: null, pop: 0.859, src: 'census' },
  { name: '党家岘乡', area: null, elev: null, pop: 1.034,  src: 'census' },
  { name: '八里湾乡', area: null, elev: null, pop: 0.823,  src: 'census' },
  { name: '草滩镇',   area: null, elev: null, pop: 0.647,  src: 'census' },
];

// —— 红色资源指数：无官方量化口径，以"革命遗址/纪念设施可见度"作交流用定性分级 ——
// 会师镇为红军三大主力会师地（100 基准）；其余按已知史实（慢牛坡、张城堡战役、
// 大墩梁、罗南辉烈士墓等）分级，仅用于内部对比演示，非官方统计值。
const RED_INDEX = {
  会师镇: 100,   // 红军第一、二、四方面军会宁会师旧址 · 会师塔
  河畔镇: 42,    // 慢牛坡战斗遗址 · 烈士陵园
  翟家所镇: 36,  // 张城堡战斗旧址 · 古西宁城
  中川镇: 30,    // 大墩梁战斗遗址
  郭城驿镇: 34,  // 郭蛤蟆城 · 红军抗日农民协会旧址
  头寨子镇: 22,  // 牛门洞遗址（国保）· 乌兰县古城
  太平店镇: 20,
  柴家门镇: 18,
  甘沟驿镇: 16,
  老君坡镇: 14,
  汉家岔镇: 12,
  新庄塬镇: 10,
  四房吴镇: 12,
  土门岘镇: 10,
  平头川镇: 8,
  新塬镇: 8,
  侯家川镇: 9,
  刘家寨子镇: 8,
  白草塬镇: 7,
  大沟镇: 8,
  丁家沟镇: 7,
  杨崖集镇: 7,
  韩家集镇: 6,
  土高山乡: 6,
  新添堡回族乡: 6,
  党家岘乡: 7,
  八里湾乡: 6,
  草滩镇: 5,
};

// —— 红色景点名录（v2 模板的 redSiteCount 口径：已列入名录的遗址遗迹数）——
// 与 s 上面的 RED_INDEX（交流用定性分级）不同，这里按"有名称的实体景点"计数，
// 并保留景点名清单写入 entity.extra.redSites，便于科普视频里展开讲解。
const RED_SITES = {
  会师镇: ['红军会宁会师旧址', '红军会师楼', '文庙大成殿', '会师纪念塔', '红军长征将帅碑林', '会宁红军会师革命文物陈列馆', '南什红军村'],
  郭城驿镇: ['红堡子红军战斗旧址'],
  河畔镇: ['慢牛坡战斗遗址'],
  柴家门镇: ['会宁古城遗址'],
  白草塬镇: ['慢牛坡战斗遗址'],
  中川镇: ['大墩梁红军烈士陵园', '大墩梁红军战斗旧址'],
  丁家沟镇: ['会宁南川·红军村旅游景区（AAA级）'],
  翟家所镇: ['张城堡红军战斗旧址'],
  党家岘乡: ['会宁县长征农场'],
};

// 实体 id：取乡镇名的稳定英文/拼音短码（用于 v2 模板的 entity.idField 与 ?highlight=）
const ENTITY_ID = {
  会师镇: 'huishi', 郭城驿镇: 'guochengyi', 河畔镇: 'hepan', 头寨子镇: 'touzhaizi',
  太平店镇: 'taipingdian', 甘沟驿镇: 'gangouyi', 侯家川镇: 'houjiachuan', 柴家门镇: 'chaijiamen',
  白草塬镇: 'baicaoyuan', 大沟镇: 'dagou', 韩家集镇: 'hanjiaji', 四房吴镇: 'sifangwu',
  中川镇: 'zhongchuan', 老君坡镇: 'laojunpo', 平头川镇: 'pingtouchuan', 丁家沟镇: 'dingjiagou',
  杨崖集镇: 'yangyaji', 翟家所镇: 'zhaijiasuo', 土门岘镇: 'tumenxian', 新塬镇: 'xinyuan',
  草滩镇: 'caotan', 新庄塬镇: 'xinzhuang', 刘家寨子镇: 'liujiazhai', 汉家岔镇: 'hanjiacha',
  八里湾乡: 'baligou', 党家岘乡: 'dangjiaxian', 新添堡回族乡: 'xintianpu', 土高山乡: 'tugaoshan',
};

// —— v2 数据模板（含全部维度）——
// dataset / entity / metrics[] / entities[]：一份文件即承载"元信息 + 指标定义 + 逐实体值"。
// 数值口径与用户提供的模板一致：
//   population     人（户籍人口，个别为 2020 数据）
//   area           km²（行政区域面积）
//   elevation      m（乡镇政府驻地海拔）
//   elevationRange m（最高点-最低点）
//   redSiteCount   个（已列入名录的遗址遗迹数）
function buildV2() {
  const items = TOWNSHIPS.map((t) => ({
    ...t,
    red: RED_INDEX[t.name] != null ? RED_INDEX[t.name] : 5,
    redSites: RED_SITES[t.name] || [],
  }));

  const metrics = [
    { key: 'population', label: '人口', unit: '人', valueType: 'integer', decimals: 0, scale: 1,
      sortDefault: 'asc', defaultVisible: true, enabled: true, group: '规模', caliber: '户籍人口',
      year: 2018, missingPolicy: 'skip', description: '各乡镇户籍人口，个别为2020年数据' },
    { key: 'area', label: '面积', unit: 'km²', valueType: 'number', decimals: 1, scale: 1,
      sortDefault: 'asc', defaultVisible: true, enabled: true, group: '规模', caliber: '行政区域面积',
      year: null, missingPolicy: 'skip', description: '各乡镇行政区域面积' },
    { key: 'elevation', label: '海拔', unit: 'm', valueType: 'integer', decimals: 0, scale: 1,
      sortDefault: 'asc', defaultVisible: false, enabled: false, group: '地理', caliber: '乡镇政府驻地海拔',
      year: null, missingPolicy: 'disable', description: '缺失较多乡镇，建议补录后启用' },
    { key: 'elevationRange', label: '海拔落差', unit: 'm', valueType: 'integer', decimals: 0, scale: 1,
      sortDefault: 'desc', defaultVisible: false, enabled: false, group: '地理', caliber: '最高点-最低点',
      year: null, missingPolicy: 'disable', description: '缺失较多乡镇，建议补录后启用' },
    { key: 'redSiteCount', label: '红色景点数', unit: '个', valueType: 'integer', decimals: 0, scale: 1,
      sortDefault: 'desc', defaultVisible: true, enabled: true, group: '红色资源', caliber: '已列入名录的遗址遗迹数',
      year: null, missingPolicy: 'zero', description: '含旧址、战斗遗址、陵园、纪念场馆' },
  ];

  const entities = items.map((t) => ({
    id: ENTITY_ID[t.name] || t.name,
    name: t.name,
    group: t.name.endsWith('乡') ? '乡' : '镇',
    metrics: {
      population: t.pop != null ? Math.round(t.pop * 10000) : null, // 万人 → 人
      area: t.area != null ? t.area : null,
      elevation: t.elev != null ? Math.round(t.elev) : null,
      elevationRange: null, // 官方未公开逐乡镇落差，统一缺失
      redSiteCount: t.redSites.length,
    },
    extra: { redSites: t.redSites },
  }));

  return {
    schemaVersion: '1.0',
    dataset: {
      id: 'huining_townships',
      name: '会宁县乡镇基础数据对比',
      entityLabel: '乡镇',
      source: '会宁县人民政府官网、区划地名网、百度百科',
      updatedAt: '2026-10',
      // 高亮主角（会师镇）：适配器据此写回 item.highlight
      highlightEntityId: 'huishi',
      notes: [
        '人口以2018年末户籍人口为主，郭城驿镇为2020年数据',
        '海拔数据缺失较多，已标记 enabled=false，补录后可启用',
      ],
    },
    entity: {
      idField: 'id',
      nameField: 'name',
      groupField: 'group',
      groupValues: ['镇', '乡'],
    },
    metrics,
    entities,
    // 展示类参数（非 schema 必需，工具自定义扩展）
    theme: 'tech',
    defaultShape: 'bar',
    revealRatio: 0.72,
    durationMs: 9000,
  };
}

// —— 旧格式（内部格式）—— 保留以兼容既有 CLI / QA 脚本与 ?cfg= 契约 ——
function build() {
  const items = TOWNSHIPS.map((t) => ({
    ...t,
    red: RED_INDEX[t.name] != null ? RED_INDEX[t.name] : 5,
  }));

  const pick = (key, fixed) =>
    items
      .filter((t) => t[key] != null)
      .map((t) => ({ name: t.name, value: +Number(t[key]).toFixed(fixed), highlight: t.name === '会师镇' }));

  return {
    title: '会宁县乡镇数据 · 3D 对比',
    subtitle: '数据来源：会宁县人民政府官网乡镇概况 · 第七次全国人口普查 · 2025 会宁县统计公报',
    theme: 'tech',
    defaultShape: 'bar',
    revealRatio: 0.72,
    durationMs: 9000,
    views: [
      { key: 'area', label: '行政区域面积', short: '面积', shape: 'cylinder', unit: 'km²', fixed: 0, items: pick('area', 0) },
      { key: 'pop', label: '常住人口', short: '人口', shape: 'bar', unit: '万人', fixed: 2, items: pick('pop', 2) },
      { key: 'elev', label: '平均海拔', short: '海拔', shape: 'rounded', unit: 'm', fixed: 0, items: pick('elev', 0) },
      { key: 'red', label: '红色资源指数', short: '红色', shape: 'sphere', unit: '', fixed: 0, items: items.map((t) => ({ name: t.name, value: t.red, highlight: t.name === '会师镇' })) },
    ],
  };
}

const cfg = build();
const outPath = path.join(ROOT, 'src/data/huining.json');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(cfg, null, 2) + '\n', 'utf8');

// 同步到 samples（供 CLI 直接使用）
const samplePath = path.join(ROOT, 'samples/huining.json');
fs.writeFileSync(samplePath, JSON.stringify(cfg, null, 2) + '\n', 'utf8');

// —— v2 数据模板三写：内置默认（.js 字面量）+ JSON 样例 ——
const cfgV2 = buildV2();
const v2Header = `// 会宁县乡镇数据集（v2 数据模板 · 纯字面量，无 fs/DOM 依赖）
// 由 scripts/data/fetch-huining.mjs 生成；亦可手改后 npm run data 覆盖。
// 结构说明见 README「数据模板（v2 schema）」章节。
// 注意：本文件被 src/core/config.js 直接 import（config.js 是纯逻辑模块，不能读写文件），
//       故必须以 .js 字面量形式存在，而非 .json。
export const HUINING_V2 = `;
const v2JsPath = path.join(ROOT, 'src/data/huining-v2.js');
fs.writeFileSync(v2JsPath, v2Header + JSON.stringify(cfgV2, null, 2) + ';\n\nexport default HUINING_V2;\n', 'utf8');

const v2SamplePath = path.join(ROOT, 'samples/huining-v2.json');
fs.writeFileSync(v2SamplePath, JSON.stringify(cfgV2, null, 2) + '\n', 'utf8');

console.log(`✓ 生成 ${TOWNSHIPS.length} 个乡镇 · ${cfg.views.length} 个视图（旧格式）`);
for (const v of cfg.views) {
  console.log(`  ${v.label}(${v.unit || '—'}): ${v.items.length} 项`);
}
console.log(`  → ${outPath}`);
console.log(`  → ${samplePath}`);
console.log(`✓ 生成 v2 数据模板：${cfgV2.metrics.length} 个指标 · ${cfgV2.entities.length} 个实体`);
for (const m of cfgV2.metrics) {
  const n = cfgV2.entities.filter((e) => e.metrics[m.key] != null).length;
  console.log(`  ${m.label}(${m.unit || '—'}) enabled=${m.enabled} policy=${m.missingPolicy}: ${n} 项有值`);
}
console.log(`  → ${v2JsPath}`);
console.log(`  → ${v2SamplePath}`);
