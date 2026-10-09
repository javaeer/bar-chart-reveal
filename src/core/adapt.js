// ============================================================
// v2 数据模板适配层（纯逻辑：仅依赖全局对象，浏览器 / Node 通用）
// ------------------------------------------------------------
// 背景：项目原先只认「内部格式」（{ title, views:[{key,label,unit,items:[{name,value}]}]}）。
// 但真实的数据资产通常是一份**含全部维度的规范模板**：
//   { schemaVersion, dataset{...}, entity{...}, metrics:[...], entities:[...] }
// 其中 metrics[] 是"指标维度"（每个指标 = 一个可比视图），entities[] 是"对象维度"
// （每个实体带 id/name/group 与一份 metrics 值字典）。
//
// 本模块把 v2 模板**适配为内部格式**，随后交给 config.js 的 normalizeConfig 做
// 统一兜底规范化（校验 / 截断 / 去重 / 至少一条）——避免两套校验逻辑分叉。
//
// 设计原则：
//   · 绝不抛异常：任何畸形输入都降级为"能拿到多少算多少" + 一条 warn；
//   · 只做**结构映射**，不做数值语义修正（那属于 normalizeConfig 的职责）；
//   · 与 config.js 解耦，便于单测。
// ============================================================

// 缺省字段名（当模板未声明 entity.idField / nameField 时使用）
const DEF_ID_FIELD = 'id';
const DEF_NAME_FIELD = 'name';

// missingPolicy 合法取值；未知值回退 'skip'
const MISSING_POLICIES = ['skip', 'zero', 'disable'];

// 默认指标：当 metric 缺 label 时，用它兜底展示（归一化后仍可能为空 → UI 回落 key）
const MAX_DECIMALS = 6;

/**
 * 宽松判别：这份原始配置「是不是 v2 模板」。
 *
 * 判定优先级（关键：不能误伤旧的 ?cfg= 契约）：
 *   ① 显式带 `views` 数组、且既无 `metrics` 也无 `entities` → 明确旧格式，返回 false；
 *   ② 命中 `metrics` / `entities` / `schemaVersion` 任一 → 视为 v2；
 *   ③ 其余（含 null / 数组 / 原始值）→ false，交给 normalizeConfig 走旧路径兜底。
 *
 * 之所以"宽松"，是因为真实模板常有字段缺失（例如只写 entities 未写 metrics），
 * 这种半成品也应当被识别并尽力解析，而不是当作旧格式丢弃。
 */
export function looksLikeV2(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const hasViews = Array.isArray(raw.views);
  const hasMetrics = Array.isArray(raw.metrics);
  const hasEntities = Array.isArray(raw.entities);
  // ① 出现顶层 `views[]` ⇒ 一律按旧格式处理（视图是旧格式的"根维度"；
  //    真实 v2 模板的视图由 metrics[] 派生，不会自带 views）。这是保护 ?cfg= 契约的关键判据。
  if (hasViews) return false;
  // ② v2 特征命中
  if (hasMetrics || hasEntities || raw.schemaVersion != null) return true;
  // ③ 只有 dataset 一类外壳、既无 views 也无维度 → 交给旧路径（会告警"缺 views"）
  return false;
}

// 把任意标量安全转为字符串（null/undefined → ''）
const asStr = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));

// decimals → fixed：clamp 到 [0, MAX_DECIMALS] 的整数；非法回退 0
function normalizeDecimals(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(MAX_DECIMALS, Math.floor(n)));
}

// 组装 subtitle：source 与 notes[] 用 ' · ' 连接；忽略空项
function buildSubtitle(dataset) {
  const parts = [];
  const src = asStr(dataset && dataset.source).trim();
  if (src) parts.push(src);
  const notes = dataset && Array.isArray(dataset.notes) ? dataset.notes : [];
  notes.forEach((n) => {
    const s = asStr(n).trim();
    if (s) parts.push(s);
  });
  return parts.join(' · ');
}

/**
 * 从 entities 的 metrics 字典**推断**指标清单（宽松兜底）。
 * 用于模板漏写 metrics[] 但仍提供了 entities[].metrics 的情况：
 * 取所有实体 metrics key 的并集（保持首次出现顺序），label 暂用 key。
 */
function inferMetricsFromEntities(entities) {
  const seen = new Map(); // key → metric
  entities.forEach((e) => {
    const m = e && e.metrics;
    if (!m || typeof m !== 'object' || Array.isArray(m)) return;
    Object.keys(m).forEach((k) => {
      if (!seen.has(k)) {
        seen.set(k, { key: k, label: k, unit: '', enabled: true, missingPolicy: 'skip' });
      }
    });
  });
  return Array.from(seen.values());
}

/**
 * v2 模板 → 「类内部格式」配置对象。
 *
 * @param {object} raw  v2 原始对象
 * @param {object} opts
 *   · includeDisabled  {boolean} true 时纳入 enabled:false 的指标（默认 false）
 *   · onlyDefaultVisible {boolean} true 时只保留 defaultVisible!==false 的指标（默认 false）
 *   · highlightEntityId {string} 覆盖模板内的 highlightEntityId
 * @returns {{ config: object, warns: string[] }}
 */
export function adaptV2(raw, opts = {}) {
  const warns = [];
  const out = {
    title: '',
    subtitle: '',
    source: undefined,
    notes: undefined,
    theme: undefined,
    highlightLabel: undefined,
    revealRatio: undefined,
    durationMs: undefined,
    barIntervalMs: undefined,
    aspect: undefined,
    defaultShape: undefined,
    views: [],
  };

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    warns.push('v2 模板不是有效对象，已回退为空配置');
    return { config: withDefined(out), warns };
  }

  const dataset = raw.dataset && typeof raw.dataset === 'object' && !Array.isArray(raw.dataset)
    ? raw.dataset
    : {};

  // —— ① 数据集级信息 ——
  out.title = asStr(dataset.name).trim();
  out.subtitle = buildSubtitle(dataset);
  // source / notes 单独透传（信息面板需分别编辑），与合并后的 subtitle 并存；
  // 两者缺失时保持 undefined → 交给 normalizeConfig 兜底为 '' / []。
  const src0 = asStr(dataset.source).trim();
  if (src0) out.source = src0;
  const notes0 = Array.isArray(dataset.notes)
    ? dataset.notes.map((n) => asStr(n).trim()).filter(Boolean)
    : [];
  if (notes0.length) out.notes = notes0;
  // 顶层展示类字段（模板可有可无，缺省交给 normalizeConfig 兜底）
  if (raw.theme != null) out.theme = raw.theme;
  if (raw.highlightLabel != null) out.highlightLabel = raw.highlightLabel;
  if (raw.revealRatio != null) out.revealRatio = raw.revealRatio;
  if (raw.durationMs != null) out.durationMs = raw.durationMs;
  if (raw.barIntervalMs != null) out.barIntervalMs = raw.barIntervalMs;
  // aspect 允许出现在顶层或 dataset 内（模板作者两种写法都常见）
  if (raw.aspect != null) out.aspect = raw.aspect;
  else if (dataset.aspect != null) out.aspect = dataset.aspect;
  if (raw.defaultShape != null) out.defaultShape = raw.defaultShape;

  // —— ② 字段名约定 ——
  const entity = raw.entity && typeof raw.entity === 'object' && !Array.isArray(raw.entity)
    ? raw.entity
    : {};
  const idField = asStr(entity.idField).trim() || DEF_ID_FIELD;
  const nameField = asStr(entity.nameField).trim() || DEF_NAME_FIELD;
  if (Array.isArray(entity.groupValues) && entity.groupValues.length) {
    // 分组仅作元信息：当前 3D 赛跑无分组语义，这里记录一条提示，不参与渲染
    warns.push(`模板声明了分组维度(${entity.groupField || 'group'}: ${entity.groupValues.join('/')})，当前渲染不使用分组`);
  }

  // —— ③ 实体清单 ——
  const entities = Array.isArray(raw.entities) ? raw.entities : [];
  if (!entities.length) {
    warns.push('v2 模板缺少 entities，未生成任何视图');
  }

  // —— ④ 指标清单（缺失时从 entities 推断，兜底）——
  let metrics = Array.isArray(raw.metrics) ? raw.metrics.slice() : [];
  if (!metrics.length && entities.length) {
    metrics = inferMetricsFromEntities(entities);
    if (metrics.length) warns.push(`模板未声明 metrics，已从 entities 推断出 ${metrics.length} 个指标`);
  }

  // —— ⑤ 高亮主角 ——
  const highlightEntityId = asStr(
    opts.highlightEntityId != null
      ? opts.highlightEntityId
      : dataset.highlightEntityId != null
        ? dataset.highlightEntityId
        : raw.highlightEntityId,
  ).trim();

  // —— ⑥ 逐 metric → 逐 view ——
  metrics.forEach((m, mi) => {
    if (!m || typeof m !== 'object' || Array.isArray(m)) {
      warns.push(`metrics[${mi}] 不是对象，已跳过`);
      return;
    }
    const key = asStr(m.key).trim();
    if (!key) {
      warns.push(`metrics[${mi}] 缺少 key，已跳过`);
      return;
    }

    const policy = MISSING_POLICIES.includes(m.missingPolicy) ? m.missingPolicy : 'skip';
    if (m.missingPolicy != null && !MISSING_POLICIES.includes(m.missingPolicy)) {
      warns.push(`metrics[${mi}](${key}) missingPolicy 非法(${m.missingPolicy})，回退 skip`);
    }

    // enabled=false ⇒ 该指标数据不可用（如海拔缺失过多）→ 默认整视图跳过
    if (m.enabled === false && !opts.includeDisabled) {
      warns.push(`metrics[${mi}](${key}) 标记 enabled=false（数据不可用），已跳过（可用 --include-disabled / includeDisabled 强制包含）`);
      return;
    }
    // missingPolicy=disable ⇒ "有任一实体缺数据即禁用整视图"。
    // 关键：只有在**确实存在缺失**时才丢弃；全员有值时应正常保留（否则会把可用维度误杀）。
    const hasMissing = policy === 'disable'
      && entities.some((e) => {
        if (!e || typeof e !== 'object' || Array.isArray(e)) return false;
        const bag = e.metrics && typeof e.metrics === 'object' && !Array.isArray(e.metrics) ? e.metrics : {};
        return bag[key] == null;
      });
    if (hasMissing && !opts.includeDisabled) {
      warns.push(`metrics[${mi}](${key}) missingPolicy=disable 且存在缺失实体，已跳过该视图`);
      return;
    }
    if (hasMissing && opts.includeDisabled) {
      // 即便强制包含，也仅保留"有值实体"，并在告警中说明
      warns.push(`metrics[${mi}](${key}) missingPolicy=disable 但被强制包含，仅保留有值实体`);
    }
    // defaultVisible=false 仍生成视图（便于 CLI 指定出片），仅排序靠后并提示
    if (m.defaultVisible === false && !opts.onlyDefaultVisible) {
      warns.push(`metrics[${mi}](${key}) defaultVisible=false（默认不展示），已保留在视图列表末尾`);
    }
    if (opts.onlyDefaultVisible && m.defaultVisible === false) return;

    // —— 收集该指标下每个实体的值 ——
    const items = [];
    entities.forEach((e, ei) => {
      if (!e || typeof e !== 'object' || Array.isArray(e)) {
        warns.push(`entities[${ei}] 不是对象，已跳过`);
        return;
      }
      const name = asStr(e[nameField]).trim();
      if (!name) {
        warns.push(`entities[${ei}] 缺少 ${nameField}，已跳过`);
        return;
      }
      const bag = e.metrics && typeof e.metrics === 'object' && !Array.isArray(e.metrics)
        ? e.metrics
        : {};
      const rawVal = bag[key];

      // —— 缺失值处理 ——
      if (rawVal == null) {
        if (policy === 'zero') {
          items.push({ name, value: 0, highlight: false });
        } else if (policy === 'disable') {
          // 强制包含 disable 指标时，缺失项按 skip 处理（不编造 0）
        } else {
          // skip（默认）：不产出该条目
        }
        return;
      }

      // —— 非空值：交给 normalizeConfig 做数值校验（这里只透传原始值）——
      const value = typeof rawVal === 'number' ? rawVal : Number(rawVal);
      const eid = asStr(e[idField]).trim();
      // 按 id 或名称命中高亮（URL ?highlight= 传中文名时也能生效）
      const hitHighlight = !!highlightEntityId
        && (eid === highlightEntityId || name === highlightEntityId);
      items.push({
        name,
        value: Number.isFinite(value) ? value : rawVal, // 非数值原样透传，由 normalizeConfig 归零 + 告警
        highlight: hitHighlight,
        _id: eid, // 非契约字段：供 URL ?highlight= 按 id 匹配（可能被 normalize 丢弃）
      });
    });

    if (!items.length) {
      warns.push(`metrics[${mi}](${key}) 无任何有效实体数据，已丢弃该视图`);
      return;
    }

    out.views.push({
      key,
      label: asStr(m.label).trim() || key,
      short: asStr(m.short).trim(),
      unit: asStr(m.unit),
      shape: m.shape != null ? m.shape : undefined,
      fixed: normalizeDecimals(m.decimals),
      items,
    });
  });

  // —— ⑦ defaultVisible=false 的视图排到末尾（视觉上"次要指标靠后"）——
  const dvOrder = new Map();
  metrics.forEach((m, i) => { if (m && m.key != null) dvOrder.set(asStr(m.key).trim(), m); });
  out.views.sort((a, b) => {
    const ma = dvOrder.get(a.key) || {};
    const mb = dvOrder.get(b.key) || {};
    const ra = ma.defaultVisible === false ? 1 : 0;
    const rb = mb.defaultVisible === false ? 1 : 0;
    return ra - rb;
  });

  return { config: withDefined(out), warns };
}

// 去掉 value 为 undefined 的键，避免把显式 undefined 传给下游（normalizeConfig 会正确兜底）
function withDefined(o) {
  const r = {};
  Object.keys(o).forEach((k) => { if (o[k] !== undefined) r[k] = o[k]; });
  return r;
}

export default adaptV2;
