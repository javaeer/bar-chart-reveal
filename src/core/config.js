// 配置驱动核心：规范化 / base64url 编解码 / 默认与会宁县等价配置
// 本文件为「纯逻辑」：仅依赖浏览器与 Node 都全局可用的
//   TextEncoder / TextDecoder / btoa / atob
// 不 import 任何 DOM / Node 专属模块，确保浏览器与 Node 端均可直接复用。
//
// 【双格式支持】本模块同时接受两种输入：
//   ① 内部格式（旧）：{ title, views:[{key,label,unit,items:[{name,value}]}] }
//   ② v2 数据模板：  { schemaVersion, dataset, entity, metrics[], entities[] }
//   v2 由 adapt.js 适配为「类内部格式」后，再走本模块统一规范化——
//   因此校验 / 截断 / 去重 / 至少一条 等规则只有一份实现，两种格式行为一致。
import { adaptV2, looksLikeV2 } from './adapt.js';
import { HUINING_V2 } from '../data/huining-v2.js';
import {
  DEFAULT_BAR_INTERVAL_MS,
  INTERVAL_MIN,
  INTERVAL_MAX,
  DEFAULT_ASPECT,
  normalizeAspect,
  deriveDuration,
} from './video.js';

// 重新导出视频规格相关能力，让消费方只需 import config.js 一处即可拿到全套
export {
  deriveDuration,
  intervalFromDuration,
  pixelSizeFor,
  ratioOf,
  normalizeAspect,
  ASPECTS,
  ASPECT_KEYS,
  DEFAULT_ASPECT,
  DEFAULT_BAR_INTERVAL_MS,
} from './video.js';

// ───────────────────────────────────────────────────────────
// 2.0 形状类型（shape）
//   bar      方柱（默认，轻微圆角）
//   cube     立方体（直角截面，正方形底）
//   rounded  圆角柱（较大圆角）
//   cylinder 圆柱（bar3D + 截面完全圆化近似；echarts-gl 无原生圆柱）
//   sphere   球体（走 scatter3D 分支，球径编码数值）
// ───────────────────────────────────────────────────────────
export const SHAPES = ['bar', 'cube', 'cylinder', 'rounded', 'sphere'];
export const SHAPE_LABELS = {
  bar: '方柱',
  cube: '立方体',
  cylinder: '圆柱',
  rounded: '圆角柱',
  sphere: '球体',
};
const DEFAULT_SHAPE = 'bar';

// 把任意输入规范化为合法 shape 名；非法时返回 null（由调用方决定回退与告警）
export function normalizeShape(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  return SHAPES.includes(s) ? s : null;
}

// ───────────────────────────────────────────────────────────
// 2.1 默认值
// ───────────────────────────────────────────────────────────
const DEFAULTS = {
  title: '',
  subtitle: '',
  source: '',
  notes: [],
  theme: 'tech',
  highlightLabel: '重点',
  revealRatio: 0.72,
  durationMs: 7200,
  barIntervalMs: DEFAULT_BAR_INTERVAL_MS,
  aspect: DEFAULT_ASPECT,
  defaultShape: DEFAULT_SHAPE,
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
// 2.2 normalizeConfig(raw, opts)
//   补齐默认值、过滤非法项、保证每个 view 至少 1 条 items。
//   尽力而为，绝不抛异常；返回 { config, warns }。
//   【双格式】若形如 v2 数据模板，先经 adaptV2 适配为内部格式再走下面的规范化，
//   这样两套输入共享同一份校验逻辑（截断/去重/归零/至少一条）。
//   opts（透传给 adaptV2）：
//     · includeDisabled    纳入 enabled:false 的指标（CLI --include-disabled）
//     · onlyDefaultVisible 只保留 defaultVisible!==false 的指标
//     · highlightEntityId  覆盖模板内的高亮主角 id（URL ?highlight=）
// ───────────────────────────────────────────────────────────
export function normalizeConfig(raw, opts = {}) {
  if (looksLikeV2(raw)) {
    const adapted = adaptV2(raw, opts);            // v2 → 类内部格式
    const r = normalizeConfig(adapted.config, opts); // 复用下面的既有规范化
    return { config: r.config, warns: [...adapted.warns, ...r.warns] };
  }

  const warns = [];
  const out = {
    title: '',
    subtitle: '',
    source: '',
    notes: [],
    theme: 'tech',
    highlightLabel: '重点',
    revealRatio: 0.72,
    durationMs: 7200,
    barIntervalMs: DEFAULT_BAR_INTERVAL_MS,
    // durationExplicit 是「内部标记」：表示 durationMs 由用户显式指定，
    // 因此不被 barIntervalMs 推导覆盖（保持老配置的行为完全不变）。
    _durationExplicit: false,
    aspect: DEFAULT_ASPECT,
    defaultShape: DEFAULT_SHAPE,
    views: [],
  };

  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    warns.push('配置不是有效对象，已回退到空默认配置');
    return { config: out, warns };
  }

  // —— 顶层字符串字段 ——
  out.title = typeof raw.title === 'string' ? raw.title : DEFAULTS.title;
  out.subtitle = typeof raw.subtitle === 'string' ? raw.subtitle : DEFAULTS.subtitle;
  // source（来源）：与 subtitle 分开保留，供信息面板独立编辑；缺失时回退 ''
  out.source = typeof raw.source === 'string' ? raw.source : DEFAULTS.source;
  // notes（备注）：字符串数组，过滤空项；非数组回退空数组。
  // 单个字符串也视为非法（notes 语义是多条备注，用数组表达；单条请写 ['...']）。
  if (Array.isArray(raw.notes)) {
    out.notes = raw.notes
      .map((n) => (typeof n === 'string' ? n : n == null ? '' : String(n)))
      .map((s) => s.trim())
      .filter(Boolean);
  } else if (raw.notes != null) {
    warns.push('notes 不是数组，已忽略（单条备注请写为 ["..."]）');
  }
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
  //   v2.6 起支持「由 barIntervalMs 自动推导总时长」：
  //     · 显式给了 durationMs  → 以它为准（老配置行为不变，_durationExplicit=true）；
  //     · 未给 durationMs 但给了 barIntervalMs → 由柱体数量推导；
  //     · 两者都未给 → 保持默认 7200（与旧默认一致）。
  //   推导在统计完 views 后进行（需要柱体数量），此处只先解析用户显式值。
  //   ★ v2.10.0：额外接受 `_durationExplicit`（内部标记）/ `durationExplicit`（v2 模板
  //     render 段写法）。adaptV2 会把 v2 的 render.durationExplicit 映射为 `_durationExplicit`
  //     透传到这里；同时为兼容手写配置，也认 `durationExplicit` 直写字段。
  //     语义：只有**确实带了一个正数 durationMs** 时该标记才有意义（没有值可锁）。
  const durExplicitFlag = raw._durationExplicit === true || raw.durationExplicit === true;
  let dm = Number(raw.durationMs);
  const dmGiven = Number.isFinite(dm) && dm > 0;
  if (raw.durationMs != null && !dmGiven) {
    warns.push(`durationMs 非法(${raw.durationMs})，将按间隔推导`);
  }
  if (dmGiven) {
    out.durationMs = Math.round(dm);
    out._durationExplicit = true;
  } else if (durExplicitFlag) {
    // 带了"显式"标记却没有可用值 → 标记无效，提示一句并保持推导
    warns.push('durationExplicit 为 true 但未提供有效的 durationMs，已按间隔推导');
  }

  // —— barIntervalMs（每根柱子弹出间隔，clamp 到 [0.2s, 20s]）——
  let bi = Number(raw.barIntervalMs);
  if (!Number.isFinite(bi) || bi <= 0) {
    if (raw.barIntervalMs != null) {
      warns.push(`barIntervalMs 非法(${raw.barIntervalMs})，回退默认 ${DEFAULT_BAR_INTERVAL_MS}`);
    }
    bi = DEFAULTS.barIntervalMs;
  }
  out.barIntervalMs = Math.round(Math.min(INTERVAL_MAX, Math.max(INTERVAL_MIN, bi)));

  // —— aspect（画幅比例，预览与导出共用）——
  if (raw.aspect != null) {
    const asp = normalizeAspect(raw.aspect);
    if (asp) out.aspect = asp;
    else warns.push(`aspect 非法(${raw.aspect})，回退默认 ${DEFAULT_ASPECT}`);
  }

  // —— defaultShape（顶层默认形状；视图未指定 shape 时回退到它）——
  if (raw.defaultShape != null) {
    const ds = normalizeShape(raw.defaultShape);
    if (ds) out.defaultShape = ds;
    else warns.push(`defaultShape 非法(${raw.defaultShape})，回退默认 ${DEFAULT_SHAPE}`);
  }

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
      // 形状：视图级优先，缺省回退顶层 defaultShape，再回退 bar；非法值告警并回退
      shape: out.defaultShape,
      fixed: 0,
      items: [],
    };

    if (v.shape != null) {
      const sh = normalizeShape(v.shape);
      if (sh) view.shape = sh;
      else warns.push(`views[${vi}].shape 非法(${v.shape})，回退 ${out.defaultShape}`);
    }

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
      // ⑦ 保留可选的 `_id`（v2 适配器写入的实体 id）：供 ?highlight= 按 id 精确匹配，
      //    旧格式通常没有该字段 → 不写入，保持 items 结构向后兼容。
      //    注意：它不是渲染契约字段，仅作运行时匹配标识，不影响任何图表行为。
      const item = { name: display, value, highlight: it.highlight === true };
      if (typeof it._id === 'string' && it._id) item._id = it._id;
      view.items.push(item);
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

  // —— 总时长收尾：未显式指定时，按「柱体数量 × 每根间隔 / 揭示占比」推导 ——
  //   柱体数量取所有视图中最大者（多视图时以最"长"的一屏为准，保证任何视图都播得完）。
  if (!out._durationExplicit) {
    const maxItems = out.views.reduce((m, v) => Math.max(m, v.items.length), 0) || 1;
    out.durationMs = deriveDuration(maxItems, out.barIntervalMs, out.revealRatio);
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
// 2.4 DEFAULT_CONFIG：会宁县乡镇数据集（v2 数据模板驱动）
//   数据源为 src/data/huining-v2.js（v2 schema 纯字面量），此处经 adaptV2 适配为
//   内部格式——**不再手工维护一份等价的多视图字面量**，避免两处数据漂移。
//   会师镇为高亮主角（dataset.highlightEntityId = 'huishi'）。
//   注意：config.js 是纯逻辑模块（不能 fs 读文件），故数据必须以 .js 字面量形式 import。
//   ★ v2.6：这里必须再过一道 normalizeConfig（而非直接用 adaptV2 的裸输出），
//     否则 durationMs / aspect 等"规范化阶段才补齐或推导"的字段会是 undefined。
// ───────────────────────────────────────────────────────────
export const DEFAULT_CONFIG = normalizeConfig(HUINING_V2).config;

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
