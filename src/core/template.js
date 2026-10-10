// ============================================================
// v2 数据模板「反向序列化」层（内部格式 → v2 模板）
// ------------------------------------------------------------
// 【为什么需要这一层】
//   adapt.js 只做了 v2 → 内部的**单向**适配。用户改完数据/视图/画幅后，
//   没有任何通道把「当前完整状态」变回一份可再次导入的 v2 模板 ——
//   也就是「一个模板搞定所有动态数据」的闭环缺了回来那一半。
//   本模块补上回来那一半，形成 round-trip：
//        v2 模板 ──adaptV2/normalizeConfig──▶ 内部 config ──toV2Template──▶ v2 模板
//
// 【无损性主张】
//   toV2Template 的输出再走一遍 normalizeConfig，必须得到与输入**逐字节等价**
//   的 config（见 scripts/qa/config.test.mjs A 组；对 samples/huining-v2.json
//   实测 JSON.stringify 完全相等）。为此做了两件事：
//     ① entity pivot：v2 的 entities[] 是"行"，metrics[] 是"列"，而内部格式是
//        "每视图一列 items[]"。回转时按 item._id || item.name 作主键把列还原成行，
//        顺序沿用**首次出现**的视图 items 顺序（与 adapt 的 entities 顺序同源）。
//     ② 只写回「内部真正持有的字段」。内部格式里没有 v2 的 entity.groupValues、
//        metric.scale/sortDefault/caliber/year/description、entity.extra 等——
//        它们无法凭空恢复，因此**不写**（写了反而是编造）。这类字段的丢失是
//        已知且被接受的行为，README「不支持字段」清单里逐条列明。
//
// 【关键约束】输出**绝不能带顶层 views 字段**。
//   looksLikeV2() 的判据是"出现顶层 views[] 就当作旧格式"（这是保护 ?cfg= 契约的
//   有意设计）。若这里写出 views，回转物会被判成旧格式，metrics/entities 被**静默丢弃**。
//   实测确认：v2 形状 + 顶层 views ⇒ looksLikeV2 返回 false。见 B 组断言。
//
// 【无损性的适用边界 · 重要】
//   · v2 来源的配置（items 带原生 _id）→ 往返**逐字节无损**（A4 断言）。
//   · 旧格式来源的配置（items 无 _id）→ 往返后 items 会**新增** _id。
//     这不是缺陷，是"格式升格"的必然：v2 模板的 entities[] 必须有 id，导出时必须造一个；
//     再导回内部格式时它就落成 _id（adapt 端本来就这么写）。影响面 = 多一个隐藏标识，
//     渲染/数值/顺序全不变，且第二次往返起完全稳定（幂等，C13d 断言）。
//
// 设计原则（与 adapt.js 对称）：
//   · 纯逻辑，仅依赖全局对象，浏览器 / Node 通用，不 import 任何 DOM/Node 专属模块；
//   · 绝不抛异常：畸形输入降级为"能写多少写多少" + 一条 warn；
//   · 与 config.js 解耦，便于单测。
// ============================================================

// 缺省字段名（与 adapt.js 保持一致，两边写死同一对常量）
const DEF_ID_FIELD = 'id';
const DEF_NAME_FIELD = 'name';

// 内部不持有、因此无法回写的 v2 元字段 —— 集中列在这里，供文档与告警复用。
// 用途：让「哪些字段会在往返中丢失」这件事在代码里有唯一权威来源。
export const V2_UNSUPPORTED_FIELDS = [
  'entity.groupField / entity.groupValues（当前渲染无分组语义）',
  'metric.valueType / scale / sortDefault / caliber / year / group / description（纯元信息）',
  'dataset.id / entityLabel / updatedAt（内部格式未持有）',
  'entity.extra（如 redSites 明细）',
];

// 把任意标量安全转为字符串（null/undefined → ''）
const asStr = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));

// 去掉 value 为 undefined 的键。**必须保留 null**（v2 里 null = 明确缺失，
// 与"未声明该字段"语义不同；adapt 端 missingPolicy 正是按 `== null` 判缺失的）。
function withDefined(o) {
  const r = {};
  Object.keys(o).forEach((k) => { if (o[k] !== undefined) r[k] = o[k]; });
  return r;
}

/**
 * 由中文（或任意非 ASCII）名称生成 ASCII 风格的稳定 id。
 * 说明：纯中文名 slugify 后为空 —— 这是**可接受**的，因为下游一律用
 *   `item._id || slugify(item.name)` 兜底，空 id 时回落到名称本身。
 *   不为了"看起来像 id"而把中文音译/编码（会引入不稳定、不可读的产物）。
 */
function slugify(s) {
  const base = asStr(s).trim().toLowerCase();
  const ascii = base
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-') // 保留中英数字，其余归一为连字符
    .replace(/[\u4e00-\u9fa5]/g, '')          // 去中文（无法安全转 ASCII）
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  return ascii;
}

/**
 * 内部 config → v2 模板。
 *
 * 输出结构（顺序稳定，便于 diff）：
 *   { schemaVersion, dataset{...}, entity{idField,nameField}, metrics[], entities[], render{...} }
 *
 * render 段是小版本增量：把"与数据无关的展示/规格配置"集中一处。
 *   旧版 v2 模板把 theme/revealRatio/aspect 写在顶层 —— 读取端做**字段级双读**
 *   （render 优先、顶层回退），因此两种位置都能吃，写出统一走 render。
 *
 * @param {object} config  normalizeConfig 产出的内部配置
 * @param {object} opts
 *   · schemaVersion {string} 覆盖输出中的 schemaVersion（默认 '1.0'）
 *   · title/subtitle 不参与（标题来自 config.title）
 * @returns {{ template: object, warns: string[] }}
 */
export function toV2Template(config, opts = {}) {
  const warns = [];
  const c = config && typeof config === 'object' && !Array.isArray(config) ? config : {};
  const views = Array.isArray(c.views) ? c.views : [];

  if (!views.length) {
    warns.push('当前配置没有任何视图，导出的模板将不含 entities/metrics');
  }

  // ── ① 实体 pivot：按 item._id || item.name 归并跨视图的同一实体 ──
  // 顺序 = 首次出现顺序。之所以取"首次出现"而不是"最后"：
  //   adapt 端 entities[] 的顺序即模板里行的顺序，而每个视图的 items 都由
  //   同一份 entities 派生 ⇒ 任一视图的 items 顺序都等于 entities 顺序。
  //   用首见顺序可保证回转后 entities 顺序与原文完全一致（无损性依赖于此）。
  const order = [];             // 主键序列
  const rows = new Map();       // 主键 → { id, name, group, metrics:{} }
  const nameOf = new Map();     // 主键 → 展示名

  views.forEach((v) => {
    const key = asStr(v && v.key).trim();
    (Array.isArray(v && v.items) ? v.items : []).forEach((it) => {
      if (!it || typeof it !== 'object') return;
      const name = asStr(it.name).trim();
      if (!name) return;
      const id = asStr(it._id).trim() || slugify(name) || name;
      if (!rows.has(id)) {
        order.push(id);
        rows.set(id, { id, name, group: undefined, metrics: {} });
        nameOf.set(id, name);
      } else {
        // 同一 id 在多视图间展示名必须一致（否则 id 冲突），取首个并提示
        if (nameOf.get(id) !== name) {
          warns.push(`实体 id「${id}」在不同视图中名称不一致（${nameOf.get(id)} / ${name}），已采用首个`);
        }
      }
      if (key) rows.get(id).metrics[key] = it.value;
    });
  });

  // ── ② metric 清单：view → metric 一对一 ──
  // decimals ← fixed（内部视图的小数位数）；unit/label/short 直传。
  // enabled/defaultVisible 不写：默认 true 与"不声明"在读取端等价（adapt 端用
  //   `=== false` / `=== true` 严格判别，缺省即普通指标），因此省略可保持无损。
  const metrics = views.map((v) => {
    const key = asStr(v && v.key).trim();
    const m = {
      key,
      label: asStr(v && v.label).trim() || key,
      unit: asStr(v && v.unit),
      decimals: Number.isFinite(Number(v && v.fixed)) ? Math.max(0, Math.floor(Number(v.fixed))) : 0,
    };
    const short = asStr(v && v.short).trim();
    if (short) m.short = short;
    // 视图级 shape：仅当与顶层 defaultShape 不同才写（相同则读取端自然会回退到顶层）
    const sh = asStr(v && v.shape).trim();
    const dsh = asStr(c.defaultShape).trim();
    if (sh && sh !== dsh) m.shape = sh;
    return m;
  }).filter((m) => {
    if (!m.key) { warns.push('存在缺少 key 的视图，已从模板中剔除'); return false; }
    return true;
  });

  // decimals 若恒为 0 则省略（读取端 normalizeDecimals(undefined) === 0，等价无损）
  metrics.forEach((m, i) => {
    const view = views[i];
    if (!view) return;
    const fixed = Number(view.fixed);
    if (!(Number.isFinite(fixed) && fixed > 0)) delete m.decimals;
  });

  // ── ③ entities：把 pivot 出的行落成数组 ──
  // metrics 字典里**显式写 null** 而不是省略：adapt 端 `bag[key] == null` 判缺失，
  //   两者等价；但保留 null 能让"哪些实体缺该维度"在模板里肉眼可见（可读性更好）。
  //   仅当该视图用 zero 策略且有值时无差别 —— 这里统一写 null 不影响语义。
  const metricKeys = metrics.map((m) => m.key);
  const entities = order.map((id) => {
    const row = rows.get(id);
    const bag = {};
    metricKeys.forEach((k) => {
      bag[k] = Object.prototype.hasOwnProperty.call(row.metrics, k) ? row.metrics[k] : null;
    });
    return withDefined({
      id: row.id,
      [DEF_NAME_FIELD]: row.name,
      metrics: bag,
    });
  });

  // ── ④ dataset：标题 / 来源 / 备注 / 高亮主角 ──
  // 高亮主角从 items[].highlight 反查（高亮是"唯一主角"语义，取第一个命中者）。
  // 优先回写 id（比中文名稳定），与 adapt 端"按 id 或名称命中"的双读兼容。
  let highlightEntityId = '';
  outer:
  for (const v of views) {
    for (const it of (Array.isArray(v && v.items) ? v.items : [])) {
      if (it && it.highlight === true) {
        highlightEntityId = asStr(it._id).trim() || asStr(it.name).trim();
        break outer;
      }
    }
  }

  const notes = Array.isArray(c.notes) ? c.notes.map((s) => asStr(s).trim()).filter(Boolean) : [];
  const dataset = withDefined({
    name: asStr(c.title),
    source: asStr(c.source),
    highlightEntityId: highlightEntityId || undefined,
    notes: notes.length ? notes : undefined,
  });

  // ── ⑤ render：展示 / 规格配置 ──
  // durationMs 只在 **用户显式锁定时** 才写（_durationExplicit === true）。
  //   原因：未锁定时 durationMs 是由「柱体数 × 间隔 / 揭示占比」推导出来的派生值，
  //   把它写进模板会让下次导入时被当成"显式指定"而锁死，反而丢掉了自动推导能力。
  //   仅在确为显式时才写，并在旁标记 durationExplicit 保证回转无损。
  const explicit = c._durationExplicit === true;
  const render = withDefined({
    theme: c.theme,
    highlightLabel: c.highlightLabel,
    revealRatio: Number.isFinite(Number(c.revealRatio)) ? Number(c.revealRatio) : undefined,
    barIntervalMs: Number.isFinite(Number(c.barIntervalMs)) ? Number(c.barIntervalMs) : undefined,
    aspect: c.aspect,
    defaultShape: c.defaultShape,
    durationMs: explicit ? c.durationMs : undefined,
    durationExplicit: explicit ? true : undefined,
  });

  // ★ 绝不输出顶层 views —— 见文件头【关键约束】。
  const template = withDefined({
    schemaVersion: asStr(opts.schemaVersion).trim() || '1.0',
    dataset,
    entity: { idField: DEF_ID_FIELD, nameField: DEF_NAME_FIELD },
    metrics,
    entities,
    render,
  });

  return { template, warns };
}

/** 便捷包装：直接产出可下载的 JSON 文本（缩进 2，UTF-8 友好的中文原样） */
export function toV2TemplateJSON(config, opts = {}) {
  const { template, warns } = toV2Template(config, opts);
  return { text: JSON.stringify(template, null, 2) + '\n', template, warns };
}

/** 由配置推导一个安全的文件名（不含扩展名） */
export function templateFilename(config, fallback = '数据集模板') {
  const name = asStr(config && config.title).trim() || fallback;
  return name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);
}

export { withDefined, slugify };
export default toV2Template;
