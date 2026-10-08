// —— 主题系统（SPEC 第 3 节）——
// ramp: 值→颜色色阶 [[p, [r,g,b]], ...]，p 递增且范围 0..1
// 所有颜色集中于此，组件内不得写死颜色。

const RGB = /#([0-9a-f]{6})$/i;

function hexToRgb(hex) {
  const m = RGB.exec(String(hex || '').trim());
  if (!m) return [255, 255, 255];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// 色阶规范化：过滤非法项、钳制 p 到 0..1、按 p 升序、首尾补 0/1
function normRamp(raw, fallback) {
  const arr = Array.isArray(raw) ? raw : [];
  const out = [];
  for (const it of arr) {
    if (!Array.isArray(it) || it.length < 2) continue;
    const p = Number(it[0]);
    const c = Array.isArray(it[1]) ? it[1].map((v) => Math.max(0, Math.min(255, Math.round(Number(v) || 0)))) : null;
    if (!isFinite(p) || !c || c.length !== 3) continue;
    out.push([Math.max(0, Math.min(1, p)), c]);
  }
  if (out.length < 2) return fallback.map((it) => [it[0], it[1].slice()]);
  out.sort((a, b) => a[0] - b[0]);
  if (out[0][0] > 0) out.unshift([0, out[0][1].slice()]);
  if (out[out.length - 1][0] < 1) out.push([1, out[out.length - 1][1].slice()]);
  return out;
}

function normRgb3(v, fallback) {
  if (Array.isArray(v) && v.length === 3) {
    const c = v.map((x) => Math.max(0, Math.min(255, Math.round(Number(x) || 0))));
    return c.every(isFinite) ? c : fallback.slice();
  }
  if (typeof v === 'string' && RGB.test(v.trim())) return hexToRgb(v);
  return fallback.slice();
}

// —— 预置主题 ——
export const THEMES = {
  // 科技青蓝：深空底 + 靛→蓝→青霓虹阶
  tech: {
    key: 'tech',
    label: '科技青蓝',
    pageBg: 'radial-gradient(120% 110% at 50% 8%, #0b1a30 0%, #060c18 52%, #02040a 100%)',
    accent: '#35e8ff',
    ink: '#eaf9ff',
    environment: '#050b16',
    ramp: [
      [0.0, [40, 48, 128]],
      [0.3, [38, 100, 224]],
      [0.62, [22, 178, 236]],
      [0.85, [64, 232, 226]],
      [1.0, [158, 255, 236]],
    ],
    highlight: [255, 209, 102],
    gridLine: 'rgba(64,196,255,0.16)',
    labelColor: '#eaf9ff',
    labelBg: 'rgba(5,16,32,0.72)',
    labelBorder: 'rgba(84,214,255,0.45)',
    hud: true,
  },
  // 极光紫：紫→品红→青绿，夜空极光带
  aurora: {
    key: 'aurora',
    label: '极光紫',
    pageBg: 'radial-gradient(120% 110% at 50% 8%, #1b1030 0%, #0e0820 52%, #05030c 100%)',
    accent: '#c084fc',
    ink: '#f3eeff',
    environment: '#0a0616',
    ramp: [
      [0.0, [64, 34, 132]],
      [0.3, [124, 52, 200]],
      [0.58, [196, 72, 190]],
      [0.8, [240, 116, 158]],
      [1.0, [140, 255, 214]],
    ],
    highlight: [255, 216, 102],
    gridLine: 'rgba(184,148,255,0.16)',
    labelColor: '#f6f1ff',
    labelBg: 'rgba(16,8,36,0.72)',
    labelBorder: 'rgba(196,140,255,0.45)',
    hud: true,
  },
  // 暖阳橙：暖褐底 + 赭红→橙→琥珀阶（高亮用青色对比）
  sunset: {
    key: 'sunset',
    label: '暖阳橙',
    pageBg: 'radial-gradient(120% 110% at 50% 8%, #241108 0%, #150a05 52%, #0a0403 100%)',
    accent: '#ffb454',
    ink: '#fff3e4',
    environment: '#140a06',
    ramp: [
      [0.0, [122, 40, 34]],
      [0.3, [188, 72, 38]],
      [0.6, [238, 126, 44]],
      [0.82, [252, 182, 72]],
      [1.0, [255, 234, 152]],
    ],
    highlight: [70, 222, 240],
    gridLine: 'rgba(255,180,84,0.15)',
    labelColor: '#fff3e4',
    labelBg: 'rgba(26,12,6,0.72)',
    labelBorder: 'rgba(255,180,84,0.45)',
    hud: true,
  },
  // 极简石墨：中性灰阶 + 单点琥珀高亮，印刷感
  mono: {
    key: 'mono',
    label: '极简石墨',
    pageBg: 'radial-gradient(120% 110% at 50% 8%, #1a1d21 0%, #101215 52%, #090a0c 100%)',
    accent: '#f5a623',
    ink: '#eceff2',
    environment: '#0f1114',
    ramp: [
      [0.0, [48, 54, 62]],
      [0.35, [86, 96, 108]],
      [0.65, [136, 148, 160]],
      [1.0, [222, 230, 236]],
    ],
    highlight: [245, 166, 35],
    gridLine: 'rgba(255,255,255,0.10)',
    labelColor: '#f2f5f7',
    labelBg: 'rgba(12,14,16,0.68)',
    labelBorder: 'rgba(255,255,255,0.28)',
    hud: false,
  },
};

export function getTheme(nameOrObj) {
  let src = null;
  if (nameOrObj && typeof nameOrObj === 'object') src = nameOrObj;
  else if (typeof nameOrObj === 'string' && THEMES[nameOrObj]) src = THEMES[nameOrObj];
  const base = src && THEMES[src.key] ? THEMES[src.key] : THEMES.tech;
  const t = src || base;

  return {
    key: typeof t.key === 'string' && t.key ? t.key : base.key,
    label: typeof t.label === 'string' && t.label ? t.label : base.label,
    pageBg: typeof t.pageBg === 'string' && t.pageBg ? t.pageBg : base.pageBg,
    accent: typeof t.accent === 'string' && t.accent ? t.accent : base.accent,
    ink: typeof t.ink === 'string' && t.ink ? t.ink : base.ink,
    environment: typeof t.environment === 'string' && t.environment ? t.environment : base.environment,
    ramp: normRamp(t.ramp, base.ramp),
    highlight: normRgb3(t.highlight, base.highlight),
    gridLine: typeof t.gridLine === 'string' && t.gridLine ? t.gridLine : base.gridLine,
    labelColor: typeof t.labelColor === 'string' && t.labelColor ? t.labelColor : base.labelColor,
    labelBg: typeof t.labelBg === 'string' && t.labelBg ? t.labelBg : base.labelBg,
    labelBorder: typeof t.labelBorder === 'string' && t.labelBorder ? t.labelBorder : base.labelBorder,
    hud: t.hud !== false,
  };
}

export function rampColorAt(ramp, ratio) {
  const x = Math.max(0, Math.min(1, Number(ratio) || 0));
  const r = ramp;
  for (let i = 0; i < r.length - 1; i++) {
    const [p0, c0] = r[i];
    const [p1, c1] = r[i + 1];
    if (x >= p0 && x <= p1) {
      const u = (x - p0) / (p1 - p0 || 1);
      const c = c0.map((v, k) => Math.round(v + (c1[k] - v) * u));
      return c;
    }
  }
  return r[r.length - 1][1].slice();
}

export function rgbStr(c) {
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
