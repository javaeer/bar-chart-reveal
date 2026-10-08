// 配置驱动核心：规范化 / base64url 编解码 / 默认与会宁县等价配置
// 本文件为「纯逻辑」：仅依赖浏览器与 Node 都全局可用的
//   TextEncoder / TextDecoder / btoa / atob
// 不 import 任何 DOM / Node 专属模块，确保浏览器与 Node 端均可直接复用。

// ───────────────────────────────────────────────────────────
// 2.1 默认值
// ───────────────────────────────────────────────────────────
const DEFAULTS = {
  title: '',
  subtitle: '',
  theme: 'tech',
  highlightLabel: '重点',
  revealRatio: 0.72,
  durationMs: 7200,
};

// item.name 最大字符数：超出则截断为「前 N 字 + …」。
// 原因：无头环境 / 3D 柱体标签宽度有限，超长名称会把标签挤成竖排或互相重叠。
const NAME_MAX = 12;

// 按「码点」截断（避免把 emoji / 代理对劈成半个字符产生乱码）。
export function truncateName(name, max = NAME_MAX) {
  const s = typeof name === 'string' ? name.trim() : '';
  const chars = Array.from(s); // 码点数组，正确处理 emoji / 生僻字
  if (chars.length <= max) return s;
  return chars.slice(0, max).join('') + '…';
}

// ───────────────────────────────────────────────────────────
// 2.2 normalizeConfig(raw)
//   补齐默认值、过滤非法项、保证每个 view 至少 1 条 items。
//   尽力而为，绝不抛异常；返回 { config, warns }。
// ───────────────────────────────────────────────────────────
export function normalizeConfig(raw) {
  const warns = [];
  const out = {
    title: '',
    subtitle: '',
    theme: 'tech',
    highlightLabel: '重点',
    revealRatio: 0.72,
    durationMs: 7200,
    views: [],
  };

  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    warns.push('配置不是有效对象，已回退到空默认配置');
    return { config: out, warns };
  }

  // —— 顶层字符串字段 ——
  out.title = typeof raw.title === 'string' ? raw.title : DEFAULTS.title;
  out.subtitle = typeof raw.subtitle === 'string' ? raw.subtitle : DEFAULTS.subtitle;
  // theme：字符串（主题名）或对象（内联主题）均可，其它回退默认
  out.theme =
    typeof raw.theme === 'string' || (raw.theme && typeof raw.theme === 'object')
      ? raw.theme
      : DEFAULTS.theme;
  out.highlightLabel =
    typeof raw.highlightLabel === 'string' ? raw.highlightLabel : DEFAULTS.highlightLabel;

  // —— revealRatio（0..1，clamp）——
  let rr = Number(raw.revealRatio);
  if (!Number.isFinite(rr)) {
    warns.push(`revealRatio 非法(${raw.revealRatio})，回退默认 0.72`);
    rr = DEFAULTS.revealRatio;
  }
  out.revealRatio = Math.min(1, Math.max(0.05, rr));

  // —— durationMs（正数）——
  let dm = Number(raw.durationMs);
  if (!Number.isFinite(dm) || dm <= 0) {
    warns.push(`durationMs 非法(${raw.durationMs})，回退默认 7200`);
    dm = DEFAULTS.durationMs;
  }
  out.durationMs = Math.round(dm);

  // —— views ——
  if (!Array.isArray(raw.views)) {
    warns.push('缺少 views 数组，未生成任何视图');
  }
  const rawViews = Array.isArray(raw.views) ? raw.views : [];
  const views = [];

  rawViews.forEach((v, vi) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) {
      warns.push(`views[${vi}] 不是对象，已跳过`);
      return;
    }
    const view = {
      key: typeof v.key === 'string' && v.key ? v.key : `view${vi}`,
      label:
        typeof v.label === 'string' && v.label
          ? v.label
          : typeof v.key === 'string' && v.key
            ? v.key
            : `视图${vi}`,
      short: typeof v.short === 'string' ? v.short : '',
      unit: typeof v.unit === 'string' ? v.unit : '',
      fixed: 0,
      items: [],
    };

    let f = Number(v.fixed);
    if (!Number.isFinite(f) || f < 0) {
      if (v.fixed != null) warns.push(`views[${vi}].fixed 非法，回退 0`);
      f = 0;
    }
    view.fixed = Math.floor(f);

    if (!Array.isArray(v.items)) {
      warns.push(`views[${vi}] 缺少 items 数组`);
    }
    const itemsRaw = Array.isArray(v.items) ? v.items : [];
    const seen = new Set();
    itemsRaw.forEach((it, ii) => {
      // ① 必须是普通对象（排除 null / 数组 / 原始值）
      if (!it || typeof it !== 'object' || Array.isArray(it)) {
        warns.push(`views[${vi}].items[${ii}] 不是对象，已跳过`);
        return;
      }
      // ② name 必须是非空字符串
      const name = typeof it.name === 'string' ? it.name.trim() : '';
      if (!name) {
        warns.push(`views[${vi}].items[${ii}] 缺少有效 name，已跳过`);
        return;
      }
      // ③ value 必须可转为有限数，否则归零（而非整条丢弃，保留条目便于定位脏数据）
      let value = Number(it.value);
      if (!Number.isFinite(value)) {
        warns.push(`views[${vi}].items[${ii}](${name}) value 非法(${it.value})，已归零`);
        value = 0;
      }
      // ④ 负数取绝对值（数值类指标无负向语义，负值多为录入错误）
      if (value < 0) {
        warns.push(`views[${vi}].items[${ii}](${name}) value 为负数(${value})，已取绝对值`);
        value = Math.abs(value);
      }
      // ⑤ 名称去重（同名柱体在标签/排名上会歧义）
      if (seen.has(name)) {
        warns.push(`views[${vi}].items 名称重复(${name})，已跳过`);
        return;
      }
      seen.add(name);
      // ⑥ 超长名称截断（防标签竖排/重叠），去重仍按原始 name 判断
      const display = truncateName(name, NAME_MAX);
      if (display !== name) {
        warns.push(`views[${vi}].items[${ii}](${name}) 名称过长，已截断为「${display}」`);
      }
      view.items.push({ name: display, value, highlight: it.highlight === true });
    });

    // 保证每个 view 至少 1 条 items
    if (view.items.length === 0) {
      warns.push(`views[${vi}](${view.key}) 无有效 items，已丢弃该视图`);
      return;
    }
    views.push(view);
  });

  out.views = views;
  if (out.views.length === 0) {
    warns.push('配置最终无任何有效视图，渲染将无内容');
  }

  return { config: out, warns };
}

// ───────────────────────────────────────────────────────────
// 2.3 编解码：base64url + UTF-8 安全（浏览器 / Node 通用）
//   编码：JSON → UTF-8 字节 → base64 → 替换 +/ → -_、去 =
//   解码：逆过程
// ───────────────────────────────────────────────────────────
export function encodeConfig(obj) {
  const json = JSON.stringify(obj ?? {});
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeConfig(str) {
  if (!str) return null;
  let b64 = String(str).replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return JSON.parse(new TextDecoder().decode(bytes));
}

// ───────────────────────────────────────────────────────────
// 2.4 DEFAULT_CONFIG：会宁县多视图（area/pop/elev/red）
//   等价于原 dataset.js 的 DEFAULT_DATA + METRICS；会师镇 highlight:true
// ───────────────────────────────────────────────────────────
export const DEFAULT_CONFIG = {
  title: "会宁县乡镇数据 · 3D 对比",
  subtitle: "数据来源：会宁县人民政府官网乡镇概况 · 第七次全国人口普查 · 2025 会宁县统计公报",
  theme: "tech",
  revealRatio: 0.72,
  durationMs: 9000,
  views: [
    {
      key: "area",
      label: "行政区域面积",
      short: "面积",
      unit: "km²",
      fixed: 0,
      items: [
        {
          name: "会师镇",
          value: 204,
          highlight: true
        },
        {
          name: "郭城驿镇",
          value: 329,
          highlight: false
        },
        {
          name: "河畔镇",
          value: 243,
          highlight: false
        },
        {
          name: "头寨子镇",
          value: 474,
          highlight: false
        },
        {
          name: "太平店镇",
          value: 140,
          highlight: false
        },
        {
          name: "翟家所镇",
          value: 182,
          highlight: false
        },
        {
          name: "老君坡镇",
          value: 138,
          highlight: false
        },
        {
          name: "中川镇",
          value: 138,
          highlight: false
        },
        {
          name: "汉家岔镇",
          value: 388,
          highlight: false
        },
        {
          name: "新庄塬镇",
          value: 332,
          highlight: false
        },
        {
          name: "四房吴镇",
          value: 259,
          highlight: false
        },
        {
          name: "土门岘镇",
          value: 185,
          highlight: false
        },
        {
          name: "平头川镇",
          value: 138,
          highlight: false
        },
        {
          name: "新塬镇",
          value: 287,
          highlight: false
        }
      ]
    },
    {
      key: "pop",
      label: "常住人口",
      short: "人口",
      unit: "万人",
      fixed: 2,
      items: [
        {
          name: "会师镇",
          value: 11.41,
          highlight: true
        },
        {
          name: "郭城驿镇",
          value: 2.8,
          highlight: false
        },
        {
          name: "河畔镇",
          value: 2.02,
          highlight: false
        },
        {
          name: "头寨子镇",
          value: 1.65,
          highlight: false
        },
        {
          name: "甘沟驿镇",
          value: 1.18,
          highlight: false
        },
        {
          name: "太平店镇",
          value: 1.17,
          highlight: false
        },
        {
          name: "翟家所镇",
          value: 1.02,
          highlight: false
        },
        {
          name: "老君坡镇",
          value: 1.15,
          highlight: false
        },
        {
          name: "中川镇",
          value: 0.94,
          highlight: false
        },
        {
          name: "汉家岔镇",
          value: 0.98,
          highlight: false
        },
        {
          name: "新庄塬镇",
          value: 0.54,
          highlight: false
        },
        {
          name: "四房吴镇",
          value: 0.86,
          highlight: false
        },
        {
          name: "土门岘镇",
          value: 0.43,
          highlight: false
        },
        {
          name: "平头川镇",
          value: 0.65,
          highlight: false
        },
        {
          name: "新塬镇",
          value: 0.72,
          highlight: false
        },
        {
          name: "侯家川镇",
          value: 0.68,
          highlight: false
        },
        {
          name: "柴家门镇",
          value: 2.09,
          highlight: false
        },
        {
          name: "刘家寨子镇",
          value: 0.86,
          highlight: false
        },
        {
          name: "白草塬镇",
          value: 1.36,
          highlight: false
        },
        {
          name: "大沟镇",
          value: 1.03,
          highlight: false
        },
        {
          name: "丁家沟镇",
          value: 1.05,
          highlight: false
        },
        {
          name: "杨崖集镇",
          value: 1.09,
          highlight: false
        },
        {
          name: "韩家集镇",
          value: 0.7,
          highlight: false
        },
        {
          name: "土高山乡",
          value: 0.41,
          highlight: false
        },
        {
          name: "新添堡回族乡",
          value: 0.86,
          highlight: false
        },
        {
          name: "党家岘乡",
          value: 1.03,
          highlight: false
        },
        {
          name: "八里湾乡",
          value: 0.82,
          highlight: false
        },
        {
          name: "草滩镇",
          value: 0.65,
          highlight: false
        }
      ]
    },
    {
      key: "elev",
      label: "平均海拔",
      short: "海拔",
      unit: "m",
      fixed: 0,
      items: [
        {
          name: "会师镇",
          value: 1950,
          highlight: true
        },
        {
          name: "河畔镇",
          value: 1500,
          highlight: false
        },
        {
          name: "头寨子镇",
          value: 1700,
          highlight: false
        },
        {
          name: "太平店镇",
          value: 1865,
          highlight: false
        },
        {
          name: "老君坡镇",
          value: 2073,
          highlight: false
        },
        {
          name: "新庄塬镇",
          value: 2000,
          highlight: false
        },
        {
          name: "四房吴镇",
          value: 1900,
          highlight: false
        }
      ]
    },
    {
      key: "red",
      label: "红色资源指数",
      short: "红色",
      unit: "",
      fixed: 0,
      items: [
        {
          name: "会师镇",
          value: 100,
          highlight: true
        },
        {
          name: "郭城驿镇",
          value: 34,
          highlight: false
        },
        {
          name: "河畔镇",
          value: 42,
          highlight: false
        },
        {
          name: "头寨子镇",
          value: 22,
          highlight: false
        },
        {
          name: "甘沟驿镇",
          value: 16,
          highlight: false
        },
        {
          name: "太平店镇",
          value: 20,
          highlight: false
        },
        {
          name: "翟家所镇",
          value: 36,
          highlight: false
        },
        {
          name: "老君坡镇",
          value: 14,
          highlight: false
        },
        {
          name: "中川镇",
          value: 30,
          highlight: false
        },
        {
          name: "汉家岔镇",
          value: 12,
          highlight: false
        },
        {
          name: "新庄塬镇",
          value: 10,
          highlight: false
        },
        {
          name: "四房吴镇",
          value: 12,
          highlight: false
        },
        {
          name: "土门岘镇",
          value: 10,
          highlight: false
        },
        {
          name: "平头川镇",
          value: 8,
          highlight: false
        },
        {
          name: "新塬镇",
          value: 8,
          highlight: false
        },
        {
          name: "侯家川镇",
          value: 9,
          highlight: false
        },
        {
          name: "柴家门镇",
          value: 18,
          highlight: false
        },
        {
          name: "刘家寨子镇",
          value: 8,
          highlight: false
        },
        {
          name: "白草塬镇",
          value: 7,
          highlight: false
        },
        {
          name: "大沟镇",
          value: 8,
          highlight: false
        },
        {
          name: "丁家沟镇",
          value: 7,
          highlight: false
        },
        {
          name: "杨崖集镇",
          value: 7,
          highlight: false
        },
        {
          name: "韩家集镇",
          value: 6,
          highlight: false
        },
        {
          name: "土高山乡",
          value: 6,
          highlight: false
        },
        {
          name: "新添堡回族乡",
          value: 6,
          highlight: false
        },
        {
          name: "党家岘乡",
          value: 7,
          highlight: false
        },
        {
          name: "八里湾乡",
          value: 6,
          highlight: false
        },
        {
          name: "草滩镇",
          value: 5,
          highlight: false
        }
      ]
    }
  ]
};

// ───────────────────────────────────────────────────────────
// 2.5 SAMPLE_CONFIGS：内置示例，便于浏览器里演示通用性
//   （与 samples/*.json 内容一致，便于直接引用演示）
// ───────────────────────────────────────────────────────────
export const SAMPLE_CONFIGS = {
  huining: DEFAULT_CONFIG,

  // 某公司部门季度产出（合成/示例数据）
  departments: {
    title: '某科技公司 · 部门季度产出对比',
    subtitle: '示例/合成数据 · 用于演示工具通用性',
    theme: 'aurora',
    highlightLabel: '明星部门',
    revealRatio: 0.72,
    durationMs: 7200,
    views: [
      {
        key: 'q1', label: 'Q1 产出', short: 'Q1', unit: '万元', fixed: 0,
        items: [
          { name: '研发部', value: 320 },
          { name: '市场部', value: 180 },
          { name: '销售部', value: 410, highlight: true },
          { name: '运营部', value: 150 },
          { name: '客服部', value: 90 },
        ],
      },
      {
        key: 'q2', label: 'Q2 产出', short: 'Q2', unit: '万元', fixed: 0,
        items: [
          { name: '研发部', value: 360 },
          { name: '市场部', value: 220 },
          { name: '销售部', value: 470, highlight: true },
          { name: '运营部', value: 170 },
          { name: '客服部', value: 110 },
        ],
      },
      {
        key: 'q3', label: 'Q3 产出', short: 'Q3', unit: '万元', fixed: 0,
        items: [
          { name: '研发部', value: 410 },
          { name: '市场部', value: 260 },
          { name: '销售部', value: 520, highlight: true },
          { name: '运营部', value: 210 },
          { name: '客服部', value: 130 },
        ],
      },
      {
        key: 'q4', label: 'Q4 产出', short: 'Q4', unit: '万元', fixed: 0,
        items: [
          { name: '研发部', value: 480 },
          { name: '市场部', value: 300 },
          { name: '销售部', value: 610, highlight: true },
          { name: '运营部', value: 240 },
          { name: '客服部', value: 160 },
        ],
      },
    ],
  },

  // 太阳系行星基础参数（公认近似值，注明近似）
  planets: {
    title: '太阳系行星 · 基础参数对比',
    subtitle: '近似值 · 用于演示工具通用性（数据取自公开科普资料，非精密测量值）',
    theme: 'sunset',
    highlightLabel: '地球',
    revealRatio: 0.72,
    durationMs: 7200,
    views: [
      {
        key: 'diameter', label: '赤道直径', short: '直径', unit: 'km', fixed: 0,
        items: [
          { name: '水星', value: 4879 },
          { name: '金星', value: 12104 },
          { name: '地球', value: 12742, highlight: true },
          { name: '火星', value: 6779 },
          { name: '木星', value: 139820 },
          { name: '土星', value: 116460 },
          { name: '天王星', value: 50724 },
          { name: '海王星', value: 49244 },
        ],
      },
      {
        key: 'mass', label: '质量（地球=1）', short: '质量', unit: '×地球', fixed: 2,
        items: [
          { name: '水星', value: 0.055 },
          { name: '金星', value: 0.815 },
          { name: '地球', value: 1.0, highlight: true },
          { name: '火星', value: 0.107 },
          { name: '木星', value: 317.8 },
          { name: '土星', value: 95.2 },
          { name: '天王星', value: 14.5 },
          { name: '海王星', value: 17.1 },
        ],
      },
      {
        key: 'orbit', label: '公转周期', short: '周期', unit: '年', fixed: 2,
        items: [
          { name: '水星', value: 0.24 },
          { name: '金星', value: 0.62 },
          { name: '地球', value: 1.0, highlight: true },
          { name: '火星', value: 1.88 },
          { name: '木星', value: 11.86 },
          { name: '土星', value: 29.46 },
          { name: '天王星', value: 84.01 },
          { name: '海王星', value: 164.8 },
        ],
      },
    ],
  },
};

export default DEFAULT_CONFIG;
