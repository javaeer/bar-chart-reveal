// CSV 导入 / 导出 —— 基于 PapaParse（自动处理引号、逗号、换行、BOM）
// 通用模型：单视图 = [{ name, value, highlight }]，列：名称 / 数值 / 重点标注
import Papa from 'papaparse';

export const CSV_HEADERS = ['名称', '数值', '重点标注'];

function toNum(s) {
  if (s == null) return 0;
  const v = parseFloat(String(s).replace(/[^\d.\-]/g, ''));
  return Number.isFinite(v) ? v : 0;
}
function isHL(s) {
  return /^(是|1|true|yes|重点)$/i.test(String(s ?? '').trim());
}

// 解析 CSV 文本 → { items } 或 { error }
export function parseItemsCSV(text) {
  const result = Papa.parse(text.trim(), {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim(),
  });

  const fatal = (result.errors || []).find((e) => e.type === 'Delimiter' || e.code === 'TooFewFields');
  if (fatal) return { error: 'CSV 解析失败：' + fatal.message };

  const items = [];
  for (const row of result.data) {
    const name = String(row['名称'] ?? row['name'] ?? '').trim();
    if (!name) continue; // 跳过空行 / 无名行
    items.push({
      name,
      value: toNum(row['数值'] ?? row['value']),
      highlight: isHL(row['重点标注'] ?? row['重点'] ?? row['hl']),
    });
  }
  if (!items.length) return { error: '未解析到有效数据行（表头应为：名称,数值,重点标注）' };
  return { items };
}

// 数据行 → 带 BOM 的 CSV 文本（Excel / WPS 打开不乱码）
export function toItemsCSV(items) {
  const data = (items || []).map((it) => ({
    名称: it.name,
    数值: it.value,
    重点标注: it.highlight ? '是' : '否',
  }));
  return '\ufeff' + Papa.unparse({ fields: CSV_HEADERS, data });
}

// 触发浏览器下载
export function downloadText(text, filename, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
