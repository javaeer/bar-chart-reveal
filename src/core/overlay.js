// ============================================================
// 画面内信息层（overlay）—— 数据模型 + Canvas 绘制
//
// 【为什么需要这个模块】
//   v2.7 把标题/当前视图/当前目标/来源备注移入取景框，成为"视频内容"。
//   但浏览器内【导出 WebM】走的是 `canvas.captureStream()` —— 它**只能捕获
//   WebGL 画布本身**，DOM 覆盖层（HTML 元素）不在其中，实测标题区域在 canvas 里
//   的亮像素为 0 → 导出的视频没有标题与信息面板（本次修复的 bug）。
//
// 【方案】
//   录制时把「WebGL 画布」与「信息层」合成到一张离屏 canvas，再从该合成 canvas
//   取流录制。信息层用 Canvas 2D 原生绘制（与页面 DOM 版共用同一份
//   `buildOverlayModel()` 数据与同一套主题令牌），因此：
//     · 无第三方依赖（不需要 html2canvas）；
//     · 不污染 canvas（不触发跨域 taint，可正常编码）；
//     · 与页面 DOM 覆盖层**数据同源**，不会各自漂移。
//
// 【分层约定】
//   buildOverlayModel() → 纯数据（无 DOM），供 DOM 与 Canvas 两条渲染路径共用；
//   paintOverlay()      → 把该数据画到任意 CanvasRenderingContext2D 上。
// ============================================================

// —— 与 App.vue 里 .vp-overlay 的 CSS 变量保持一致的排版比例 ——
// 键：设计比例（相对取景框宽/高）；值：clamp 上下限（px）。
const CL = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** 取景框尺寸 → 一套排版度量（px）。与 App.vue 中 --ov-* 的定义一一对应。 */
export function overlayMetrics(w, h) {
  return {
    padX: CL(w * 0.030, 14, 44),
    padY: CL(h * 0.038, 12, 34),
    title: CL(w * 0.0146, 15, 30),
    sub: CL(w * 0.0080, 10, 15),
    name: CL(w * 0.0174, 17, 34),
    val: CL(w * 0.0209, 20, 42),
    panelW: CL(w * 0.152, 160, 300),
    chipK: CL(w * 0.0057, 9, 13),
    chipV: CL(w * 0.0073, 11, 17),
    rank: CL(w * 0.0063, 9, 14),
    rankB: CL(w * 0.0078, 11, 18),
    unit: CL(w * 0.0073, 10, 17),
    src: CL(w * 0.0052, 8, 12),
    dot: CL(w * 0.0063, 6, 13),
    gapS: CL(h * 0.009, 4, 10),
  };
}

/**
 * 由配置 + 当前活跃柱构造信息层数据模型（纯数据，无 DOM）。
 * @param {object} o
 * @param {{title,subtitle,source,notes}} o.config
 * @param {{label,unit,fixed}} o.view       当前视图
 * @param {null|{name,value,rank,total,revealed}} o.active  当前目标（可为 null）
 * @param {object} o.theme                  getTheme() 归一化后的主题
 * @param {{w:number,h:number}} o.size      取景框像素尺寸
 * @param {boolean} o.portrait              是否窄画幅（决定目标卡/来源落位）
 */
export function buildOverlayModel(o) {
  const { config, view, active, theme, size, portrait } = o;
  const m = overlayMetrics(size.w, size.h);
  return {
    m, size, portrait,
    col: {
      accent: theme.accent || '#35e8ff',
      ink: theme.ink || '#eaf9ff',
      // 与 CSS 令牌对齐的次级文本色
      muted: '#7f9fb8',
      dim: '#7fa5bf',
      faint: '#4f7288',
      chipK: '#8fb6cf',
      head: '#79a6c4',
      valUnit: '#7fb6d1',
    },
    title: (config && config.title) || '3D 柱状对比',
    subtitle: (config && config.subtitle) || '',
    viewLabel: view ? view.label : '',
    viewUnit: view ? view.unit : '',
    target: active && active.shown ? {
      name: active.name,
      value: active.value,
      fixed: view ? view.fixed : 0,
      unit: view ? view.unit : '',
      rank: active.rank,
      total: active.total,
      revealed: active.revealed,
      progress: active.total ? Math.min(1, Math.max(0, active.revealed / active.total)) : 0,
    } : null,
    source: (config && config.source) || '',
    notes: (config && Array.isArray(config.notes)) ? config.notes.filter(Boolean) : [],
  };
}

// —— 小工具：圆角矩形 / 切角多边形 ——
function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
function hexA(hex, a) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return `rgba(53,232,255,${a})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
// 文本按最大宽度折行（中文按字符断行，英文/数字按空白断行）
function wrapText(ctx, text, maxW) {
  const out = [];
  const paras = String(text).split('\n');
  for (const para of paras) {
    if (!para) { out.push(''); continue; }
    let line = '';
    for (const ch of para) {
      const t = line + ch;
      if (ctx.measureText(t).width > maxW && line) { out.push(line); line = ch; }
      else line = t;
    }
    if (line) out.push(line);
  }
  return out;
}
function font(size, weight = 400) {
  return `${weight} ${size}px "PingFang SC","Microsoft YaHei",system-ui,sans-serif`;
}
// 切角多边形（左上 + 右下切角，与 .metric-chip / .target-panel 一致）
function clipCorners(ctx, x, y, w, h, cut, corners) {
  // corners: 形如 {tl:bool, tr:bool, br:bool, bl:bool}
  ctx.beginPath();
  ctx.moveTo(x + (corners.tl ? cut : 0), y);
  ctx.lineTo(x + w - (corners.tr ? cut : 0), y);
  if (corners.tr) ctx.lineTo(x + w, y + cut);
  ctx.lineTo(x + w, y + h - (corners.br ? cut : 0));
  if (corners.br) ctx.lineTo(x + w - cut, y + h);
  ctx.lineTo(x + (corners.bl ? cut : 0), y + h);
  if (corners.bl) ctx.lineTo(x, y + h - cut);
  ctx.lineTo(x, y + (corners.tl ? cut : 0));
  ctx.closePath();
}

/**
 * 把信息层画到 2D 上下文上（画布尺寸 = 取景框尺寸，坐标直接对应）。
 * 视觉与 App.vue 的 .vp-overlay DOM 版保持一致（同令牌 / 同比例 / 同落位规则）。
 */
export function paintOverlay(ctx, model) {
  const { m, col, size, portrait } = model;
  const { w, h } = size;
  ctx.save();
  ctx.textBaseline = 'alphabetic';

  // ── ① 标题 / 副标题（左上）──
  const maxTitleW = Math.min(w * (portrait ? 0.74 : 0.62), w - m.padX * 2);
  let y = m.padY;
  // 圆点 + 标题同一行
  ctx.font = font(m.title, 700);
  const titleLines = wrapText(ctx, model.title, maxTitleW - m.dot - 8);
  // 圆点基线对齐首行
  ctx.fillStyle = col.accent;
  ctx.shadowColor = col.accent; ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.arc(m.padX + m.dot / 2, y + m.title * 0.42, m.dot / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  // 标题文字
  ctx.fillStyle = col.ink;
  ctx.shadowColor = hexA(col.accent, 0.42); ctx.shadowBlur = 20;
  ctx.font = font(m.title, 700);
  let ty = y + m.title * 0.86;
  for (const ln of titleLines) { ctx.fillText(ln, m.padX + m.dot + 8, ty); ty += m.title * 1.22; }
  ctx.shadowBlur = 0;
  // 副标题
  if (model.subtitle) {
    ctx.font = font(m.sub, 400);
    ctx.fillStyle = col.muted;
    const subX = m.padX + Math.min(m.dot + 8, 26);
    const subMax = maxTitleW - (subX - m.padX);
    const subLines = wrapText(ctx, model.subtitle, subMax);
    let sy = ty - m.title * 1.22 + m.gapS + m.sub;
    for (const ln of subLines) { ctx.fillText(ln, subX, sy); sy += m.sub * 1.5; }
  }

  // ── ② 当前视图徽标（右上）──
  if (model.viewLabel) {
    const kTxt = '当前视图';
    const vTxt = model.viewUnit ? `${model.viewLabel} · ${model.viewUnit}` : model.viewLabel;
    ctx.font = font(m.chipK, 400);
    const kw = ctx.measureText(kTxt).width + m.padX * 0.5;
    ctx.font = font(m.chipV, 700);
    const vw = ctx.measureText(vTxt).width + m.padX * 0.7;
    const cw = kw + vw;
    const chh = m.chipV * 2.3;
    const cx = w - m.padX - cw;
    const cy = m.padY;
    const r = 10;
    // 底板
    clipCorners(ctx, cx, cy, cw, chh, r, { tl: true, br: true });
    ctx.fillStyle = 'rgba(10,18,34,0.72)';
    ctx.fill();
    ctx.strokeStyle = hexA(col.accent, 0.42); ctx.lineWidth = 1; ctx.stroke();
    // 左段底色
    ctx.save();
    ctx.beginPath(); ctx.rect(cx, cy, kw, chh); ctx.clip();
    ctx.fillStyle = hexA(col.accent, 0.42); ctx.fillRect(cx, cy, kw, chh);
    ctx.restore();
    // 左段文字
    ctx.fillStyle = col.chipK; ctx.font = font(m.chipK, 400);
    ctx.textAlign = 'center';
    ctx.fillText(kTxt, cx + kw / 2, cy + chh / 2 + m.chipK * 0.36);
    // 右段文字
    ctx.fillStyle = col.accent; ctx.font = font(m.chipV, 700);
    ctx.shadowColor = hexA(col.accent, 0.42); ctx.shadowBlur = 14;
    ctx.fillText(vTxt, cx + kw + vw / 2, cy + chh / 2 + m.chipV * 0.36);
    ctx.shadowBlur = 0;
    ctx.textAlign = 'left';
  }

  // ── ③ 来源 / 备注（左下；竖屏落右下）──
  const srcLines = [];
  if (model.source) srcLines.push({ t: model.source, c: col.dim });
  for (const n of model.notes) srcLines.push({ t: n, c: col.faint });
  if (srcLines.length) {
    ctx.font = font(m.src, 400);
    const maxW = Math.min(w * (portrait ? 0.56 : 0.58), w - m.padX * 2);
    const wrapped = [];
    for (const s of srcLines) for (const ln of wrapText(ctx, s.t, maxW)) wrapped.push({ t: ln, c: s.c });
    const lh = m.src * 1.55;
    const totalH = wrapped.length * lh;
    const right = portrait;
    const baseX = right ? (w - m.padX) : m.padX;
    ctx.textAlign = right ? 'right' : 'left';
    let sy = h - m.padY - totalH + m.src;
    for (const ln of wrapped) { ctx.fillStyle = ln.c; ctx.fillText(ln.t, baseX, sy); sy += lh; }
    ctx.textAlign = 'left';
  }

  // ── ④ 当前目标卡片（左侧居中；竖屏落左下）──
  if (model.target) {
    const t = model.target;
    const pw = m.panelW;
    const pad = CL(h * 0.016, 9, 19);
    const padXIn = CL(w * 0.012, 10, 24);
    // 预排版行高
    const nameLh = m.name * 1.2;
    const valLh = m.val * 1.15;
    const rankLh = m.rank * 1.4;
    ctx.font = font(m.name, 700);
    const nameLines = wrapText(ctx, t.name, pw - padXIn * 2);
    const innerH = pad * 2 + m.rank * 1.4 /*head*/ + m.gapS + nameLines.length * nameLh + 5
      + valLh + m.gapS + rankLh + m.gapS + 3 /*bar*/ + 4;
    // 定位
    let px = m.padX;
    let py;
    if (portrait) py = h - m.padY - innerH - m.src * 6.2; // 抬到来源之上
    else py = (h - innerH) / 2;
    py = Math.max(m.padY + 40, py);
    const ph = innerH;
    // 底板（左上 + 右下切角）
    clipCorners(ctx, px, py, pw, ph, 14, { tr: true, bl: true });
    ctx.fillStyle = 'rgba(6,14,28,0.85)';
    ctx.fill();
    ctx.strokeStyle = hexA(col.accent, 0.42); ctx.lineWidth = 1; ctx.stroke();
    // 外发光
    ctx.save();
    clipCorners(ctx, px, py, pw, ph, 14, { tr: true, bl: true });
    ctx.clip();
    ctx.shadowColor = col.accent; ctx.shadowBlur = 34;
    ctx.stroke(); ctx.restore();

    let cy = py + pad;
    // head: 小方块 + 当前目标
    ctx.fillStyle = col.accent; ctx.shadowColor = col.accent; ctx.shadowBlur = 9;
    const sq = m.rank * 0.55;
    ctx.fillRect(px + padXIn, cy + m.rank * 0.35, sq, sq);
    ctx.shadowBlur = 0;
    ctx.fillStyle = col.head; ctx.font = font(m.rank * 0.92, 400);
    ctx.fillText('当前目标', px + padXIn + sq + 7, cy + m.rank * 0.95);
    cy += m.rank * 1.4 + m.gapS;
    // 名称
    ctx.fillStyle = col.ink; ctx.font = font(m.name, 700);
    ctx.shadowColor = hexA(col.accent, 0.42); ctx.shadowBlur = 18;
    for (const ln of nameLines) { ctx.fillText(ln, px + padXIn, cy + m.name * 0.9); cy += nameLh; }
    ctx.shadowBlur = 0;
    cy += 5 - nameLh;
    // 数值 + 单位
    const valTxt = Number(t.value).toFixed(t.fixed);
    ctx.fillStyle = col.accent; ctx.font = font(m.val, 800);
    ctx.shadowColor = hexA(col.accent, 0.42); ctx.shadowBlur = 20;
    ctx.fillText(valTxt, px + padXIn, cy + m.val * 0.9);
    const vwpx = ctx.measureText(valTxt).width;
    ctx.shadowBlur = 0;
    if (t.unit) {
      ctx.fillStyle = col.valUnit; ctx.font = font(m.unit, 600);
      ctx.fillText(t.unit, px + padXIn + vwpx + 5, cy + m.val * 0.9);
    }
    cy += valLh;
    // 排名
    ctx.fillStyle = col.dim; ctx.font = font(m.rank, 400);
    const pre = '排名第 ';
    ctx.fillText(pre, px + padXIn, cy + m.rank * 0.95);
    const preW = ctx.measureText(pre).width;
    ctx.fillStyle = col.ink; ctx.font = font(m.rankB, 700);
    const rkTxt = String(t.rank);
    ctx.fillText(rkTxt, px + padXIn + preW, cy + m.rank * 0.95);
    const rkW = ctx.measureText(rkTxt).width;
    ctx.fillStyle = col.dim; ctx.font = font(m.rank, 400);
    ctx.fillText(` / ${t.total}`, px + padXIn + preW + rkW, cy + m.rank * 0.95);
    cy += rankLh + m.gapS;
    // 进度条
    const barW = pw - padXIn * 2;
    ctx.fillStyle = hexA(col.accent, 0.42);
    ctx.fillRect(px + padXIn, cy, barW, 3);
    ctx.fillStyle = col.accent; ctx.shadowColor = col.accent; ctx.shadowBlur = 12;
    ctx.fillRect(px + padXIn, cy, barW * t.progress, 3);
    ctx.shadowBlur = 0;
  }

  ctx.restore();
}
