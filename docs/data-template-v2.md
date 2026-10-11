# 数据模板 v2 Schema（权威详细参考）

> 本文件从 README 抽取，作为 v2 数据模板的完整字段说明。

### 数据模板（v2 schema）— 一份模板涵盖全部维度

上面是**内部格式**（以 `views` 为根）。真实数据资产通常另有一份**含全部维度的规范模板**：
以 `metrics[]` 描述"可比维度"（每个指标 = 一个视图），以 `entities[]` 描述"对象维度"
（每个实体带一份指标值字典）。此类模板可**直接作为配置使用**——工具会自动识别并适配，
无需手工转写成内部格式（`src/core/adapt.js`）。

```jsonc
{
  "schemaVersion": "1.0",
  "dataset": {
    "id": "huining",
    "name": "会宁县乡镇基础数据对比",     // → 标题
    "source": "会宁县统计年鉴",           // ┐
    "notes": ["乡镇行政区划口径", "面积含辖域"], // ┘ → 副标题（source + notes 以 " · " 连接）
    "highlightEntityId": "huishi"        // 可选：把该实体标为高亮主角（也可按显示名匹配）
  },
  "entity": { "idField": "id", "nameField": "name", "groupField": "group" },
  "metrics": [                            // 每个 metric → 一个视图
    { "key": "population", "label": "常住人口", "unit": "人", "decimals": 0, "missingPolicy": "skip" },
    { "key": "area",       "label": "行政区域面积", "unit": "km²", "decimals": 1, "missingPolicy": "skip" },
    { "key": "elevation",  "label": "平均海拔", "unit": "m", "enabled": false, "missingPolicy": "disable" },
    { "key": "redSiteCount", "label": "红色遗址数", "unit": "个", "missingPolicy": "zero" }
  ],
  "entities": [                           // 每个 entity → 一个条目（name + 各指标值）
    { "id": "huishi", "name": "会师镇", "group": "镇", "metrics": { "population": 114130, "area": 88.2, "redSiteCount": 6 } },
    { "id": "guochengyi", "name": "郭城驿镇", "group": "镇", "metrics": { "population": 28040, "area": 288.3, "redSiteCount": 1 } }
  ]
}
```

**字段映射**

| 模板字段 | 内部字段 | 说明 |
|---|---|---|
| `dataset.name` | `title` | 数据集名称 |
| `dataset.source` + `dataset.notes[]` | `subtitle` | 以 ` · ` 连接（空项忽略） |
| `dataset.highlightEntityId` | item `highlight` | 命中实体 `highlight:true`；可用 id 或显示名 |
| `entity.idField` / `nameField` | item `_id` / `name` | 字段名可自定义，缺省 `id` / `name` |
| `metrics[].key` / `label` / `short` / `unit` | view `key` / `label` / `short` / `unit` | 一一对应 |
| `metrics[].decimals` | view `fixed` | 夹紧至 `[0,6]`，非法回退 `0` |
| `metrics[].shape` | view `shape` | 可选，覆盖顶层 `defaultShape` |
| `entities[].metrics[key]` | item `value` | 缺失按 `missingPolicy` 处理 |
| 顶层 `theme` / `defaultShape` / `revealRatio` / `durationMs` | 同名 | 透传 |
| 顶层 `schemaVersion` | — | 仅用于判别，不参与渲染 |

**`metrics[].enabled` 与 `metrics[].missingPolicy`**

| 字段 | 取值 | 语义 |
|---|---|---|
| `enabled` | `true`（默认）/ `false` | `false` = 该指标数据不可用 → **默认整视图跳过**；用 `--include-disabled`（CLI）或 `includeDisabled`（API）强制纳入 |
| `missingPolicy` | `skip`（默认） | 实体缺该指标值 → **不产出该条目**（视图条数变少） |
| | `zero` | 实体缺该指标值 → **补 0** 并保留条目 |
| | `disable` | 只要有实体缺该指标值 → **整视图跳过**（全员有值则正常保留） |
| `defaultVisible` | `false` | 仍生成视图，但**排序到视图列表末尾**（视觉上次要指标靠后） |

**判别规则（双格式自动兼容）**：出现顶层 `views[]` → 一律按**内部格式**处理；否则命中
`metrics[]` / `entities[]` / `schemaVersion` 任一 → 判为 **v2 模板**并自动适配。二者互不干扰，
旧数据文件与 `?cfg=` 契约完全不受影响。适配后的结果会**再次经过 `normalizeConfig`**
（校验 / 截断 / 去重 / 至少一条），因此两套格式共享同一套兜底逻辑。

> 内置默认数据集已切换为 v2 模板：`src/data/huining-v2.js`（会宁县 28 乡镇、5 个指标维度，
> 其中 `elevation`/`elevationRange` 标记 `enabled:false` 默认不生成视图 → 默认出 3 个视图：
> 人口 / 面积 / 红色遗址数，会师镇高亮）。旧格式示例 `samples/huining.json` 保留作兼容样本，
> 另有 `samples/huining-v2.json` 作为 v2 模板的独立可复用样例。
