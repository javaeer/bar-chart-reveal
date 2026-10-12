# 示例数据集

本目录存放可直接用于 `bar-chart-reveal` 的示例数据集，既含 **v2 模板格式**
（`metrics[]` / `entities[]` / `schemaVersion`），也保留 **内部 `views` 格式** 作兼容样本。
在 VSCode 中编辑 v2 模板时，可引用根目录 `schema/config-v2.schema.json` 获得校验与补全：

```json
{ "$schema": "./../schema/config-v2.schema.json" }
```

## 数据来源与授权

| 文件 | 主题 | 格式 | 数据来源 | 授权 / 说明 |
|------|------|------|----------|-------------|
| `huining-v2.json` | 会宁县乡镇基础数据对比 | v2 模板 | 会宁县人民政府官网、区划地名网、百度百科 | 公开政务/百科资料整合；海拔等字段缺失较多已标记 `enabled:false`。**如用于正式发布，请二次核实并标注口径。** |
| `huining.json` | 会宁县乡镇数据 · 3D 对比 | 内部 `views` | 会宁县人民政府官网乡镇概况、第七次全国人口普查、2025 会宁县统计公报 | 旧格式兼容样本；与 `huining-v2.json` 同源，供回归对比。 |
| `departments.json` | 某科技公司 · 部门季度产出对比 | 内部 `views` | **示例 / 合成数据** | 明确标注为「非真实企业数据」，仅用于演示工具通用性。 |
| `planets.json` | 太阳系行星 · 基础参数对比 | 内部 `views` | 公开科普资料 | 近似值，标注「非精密测量值」，仅用于演示通用性。 |

## 使用建议

- 引用真实统计数据（如 `huining-v2.json` / `huining.json`）发布视频前，**务必重新核实口径与年份**，并在片尾/副标题注明来源。
- `departments.json` / `planets.json` 为**合成或近似数据**，仅作演示，不应被当作真实事实引用。
- 自定义数据集请遵循 `schema/config-v2.schema.json` 或内部 `views` 结构，详见 `docs/data-template-v2.md`。
