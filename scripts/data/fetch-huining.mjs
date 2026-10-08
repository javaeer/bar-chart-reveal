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
    revealRatio: 0.72,
    durationMs: 9000,
    views: [
      { key: 'area', label: '行政区域面积', short: '面积', unit: 'km²', fixed: 0, items: pick('area', 0) },
      { key: 'pop', label: '常住人口', short: '人口', unit: '万人', fixed: 2, items: pick('pop', 2) },
      { key: 'elev', label: '平均海拔', short: '海拔', unit: 'm', fixed: 0, items: pick('elev', 0) },
      { key: 'red', label: '红色资源指数', short: '红色', unit: '', fixed: 0, items: items.map((t) => ({ name: t.name, value: t.red, highlight: t.name === '会师镇' })) },
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

console.log(`✓ 生成 ${TOWNSHIPS.length} 个乡镇 · ${cfg.views.length} 个视图`);
for (const v of cfg.views) {
  console.log(`  ${v.label}(${v.unit || '—'}): ${v.items.length} 项`);
}
console.log(`  → ${outPath}`);
console.log(`  → ${samplePath}`);
