// v2.10.0 回归：单模板驱动全部动态数据（JSON 模板 导出 / 导入 / 可撤销）
// 用法：npm run qa:template
//
// 覆盖三条真实用户路径（全部经由 DOM 真实交互，非内部 API 直调）：
//   ① 导出：点「⤓配置」→ 拦截下载 → 校验产物是合法 v2 模板（含 render 段、不含顶层 views）
//   ② 导入：往 #file 塞一份自定义模板 → 断言 视图/数据/元信息/画幅/主题/形状 全量替换
//   ③ 撤销：点「↩撤销」→ 断言逐字段还原到导入前；且"编辑一次后按钮置灰"
//
// ★ 为什么用 elementHandle.uploadFile() 而不是 new DataTransfer()：
//   Puppeteer 的 uploadFile 走的是真实的 DevTools setFileInputFiles 协议，
//   会真正触发 input 的 change 事件并让 FileReader 读到真实文件内容；
//   而手工构造 DataTransfer 在部分 Chromium 版本里不会触发 change，
//   会让"导入成功"变成假绿。这里要验的是端到端链路，必须走真实路径。
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { resolveChromium, setupDisplay, startServer } from '../lib/capture-core.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'tpl-qa-'));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`✅ ${m}`); } else { fail++; console.log(`❌ ${m}`); } };

// ── 造一份与内置完全不同的模板：4 个乡镇 / 3 个指标 / 竖屏画幅 / 圆柱形状 / 深色主题
const CUSTOM = {
  schemaVersion: '1.0',
  dataset: {
    name: 'QA 测试数据集',
    entityLabel: '测试对象',
    source: 'QA 自动生成',
    highlightEntityId: 'b',
    notes: ['第一条备注', '第二条备注'],
  },
  entity: { idField: 'id', nameField: 'name' },
  metrics: [
    { key: 'pop', label: '人口', unit: '人', decimals: 0 },
    { key: 'area', label: '面积', unit: 'km²', decimals: 1 },
    { key: 'rank', label: '县级排名', unit: '位', decimals: 0 },
  ],
  entities: [
    { id: 'a', name: '测试甲', metrics: { pop: 300, area: 12.5, rank: 4 } },
    { id: 'b', name: '测试乙', metrics: { pop: 200, area: 30.25, rank: 2 } },
    { id: 'c', name: '测试丙', metrics: { pop: 100, area: 7.5, rank: 1 } },
    { id: 'd', name: '测试丁', metrics: { pop: 50, area: 44, rank: 3 } },
  ],
  render: {
    theme: 'sunset',
    highlightLabel: 'C位',
    revealRatio: 0.6,
    barIntervalMs: 900,
    aspect: '9:16',
    defaultShape: 'cylinder',
  },
};
const TPL_PATH = path.join(TMP, 'custom.v2.json');
fs.writeFileSync(TPL_PATH, JSON.stringify(CUSTOM, null, 2), 'utf8');

// 一份 CSV（用于验证"导入通道按内容分派"仍然走 CSV 分支）
const CSV_PATH = path.join(TMP, 'items.csv');
fs.writeFileSync(CSV_PATH, '名称,数值,重点标注\nCSV甲,11,是\nCSV乙,22,否\n', 'utf8');

await setupDisplay();
const srv = await startServer(path.join(root, 'dist'), null);
const browser = await puppeteer.launch({
  executablePath: resolveChromium(), headless: 'new',
  args: ['--no-sandbox', '--disable-gpu-sandbox', '--use-gl=angle', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader', '--hide-scrollbars'],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.goto(`${srv.base}/?debug=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__barRace && !!window.__barRaceDS, { timeout: 30000 });

  // 统一读取"当前工作区状态"的探针。
  // 数据源用 __barRaceDS（App.vue 在 ?debug=1 下挂的只读观测口）：
  //   为什么不用 __barRace：它是 BarRace3D 组件实例，只收 items/unit/theme 等渲染 props，
  //   **不持有完整 config**，测不到标题/来源/画幅/视图清单是否真的被替换。
  // UI 态（下拉选中、按钮禁用）则一律从真实 DOM 读 —— 否则测不到"UI 是否接上了"。
  const probe = () => page.evaluate(() => {
    const cfg = window.__barRaceDS ? window.__barRaceDS.getConfig() : null;
    const ui = window.__barRaceDS ? window.__barRaceDS.getUiState() : {};
    return {
      title: cfg ? cfg.title : '',
      source: cfg ? cfg.source : '',
      notes: cfg ? (cfg.notes || []).join('|') : '',
      viewKeys: cfg ? cfg.views.map((v) => v.key) : [],
      viewLabels: cfg ? cfg.views.map((v) => v.label) : [],
      itemCount: cfg && cfg.views[0] ? cfg.views[0].items.length : 0,
      firstName: cfg && cfg.views[0] && cfg.views[0].items[0] ? cfg.views[0].items[0].name : '',
      aspect: cfg ? cfg.aspect : '',
      interval: cfg ? cfg.barIntervalMs : 0,
      durationMs: cfg ? cfg.durationMs : 0,
      durationExplicit: cfg ? cfg._durationExplicit : null,
      highlight: cfg ? cfg.views
        .flatMap((v) => v.items)
        .filter((i) => i.highlight)
        .map((i) => i.name)
        .filter((n, i, a) => a.indexOf(n) === i) : [],
      // —— UI 态（真实 DOM）——
      // 视图按钮无专属类名，用分组 aria-label 定位（这是模板里写死的稳定锚点）
      viewBtns: [...document.querySelectorAll('.group[aria-label="视图切换"] .seg-btn')]
        .map((b) => b.textContent.trim()),
      activeViewBtn: [...document.querySelectorAll('.group[aria-label="视图切换"] .seg-btn.active')]
        .map((b) => b.textContent.trim()),
      activeTheme: document.querySelector('.seg-btn.theme.active')?.textContent.trim() || '',
      activeShape: document.querySelector('.seg-btn.shape.active')?.textContent.trim() || '',
      activeAspect: document.querySelector('.seg-btn.aspect.active')?.textContent.trim() || '',
      undoDisabled: !!document.querySelector('.seg-btn.undo')?.disabled,
      // 内部状态快照（含 config 之外的 viewKey/themeKey/shapeKey —— 撤销是否完整以它为准）
      uiState: ui,
    };
  });

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // 按 aria-label 分组定位按钮并点击（比全局类名匹配稳，不会误命同类的其它分组）
  const clickGroupBtn = async (groupAria, text) => {
    const handles = await page.$$(`.group[aria-label="${groupAria}"] .seg-btn`);
    for (const h of handles) {
      const t = await h.evaluate((el) => el.textContent.trim());
      if (t === text) { await h.click(); return true; }
    }
    return false;
  };

  // 数据分组按钮：文案含图标前缀（如 "⤓配置"），用 includes 匹配
  const clickDataBtn = async (text) => {
    const handles = await page.$$('.group.data-ui .seg-btn');
    for (const h of handles) {
      const t = await h.evaluate((el) => el.textContent.trim());
      if (t.includes(text)) { await h.click(); return true; }
    }
    return false;
  };

  const before = await probe();
  console.log(`\n───── 导入前基线 ─────`);
  console.log(`  标题=${before.title}｜视图=${before.viewKeys.length}(${before.viewKeys.join('/')})｜` +
    `首视图项数=${before.itemCount}｜画幅=${before.aspect}｜主题=${before.activeTheme}｜形状=${before.activeShape}`);
  // 基线 UiState 快照 —— 撤销是否"完整"以它为准（它含 config 之外的
  // viewKey/themeKey/shapeKey，只还原 config 会留下"数据回去了、下拉框还停在新的"这类错位）
  const beforeUI = { ...before.uiState };
  delete beforeUI.canUndoImport; // 撤销后必然为 false，上面的 button 断言已覆盖

  // ══════════ ① 导入 JSON 模板：全量替换 ══════════
  console.log('\n───── ① 导入 JSON 模板（全量替换） ─────');
  const input = await page.$('#file');
  ok(!!input, '① #file 输入存在（导入通道已接上）');

  await input.uploadFile(TPL_PATH);
  await page.waitForFunction(
    () => {
      const c = window.__barRaceDS && window.__barRaceDS.getConfig();
      return c && c.title === 'QA 测试数据集';
    },
    { timeout: 15000 },
  ).catch(() => {});

  const after = await probe();
  ok(after.title === 'QA 测试数据集', `① 标题已替换 — "${after.title}"`);
  ok(after.source === 'QA 自动生成', `① 来源已替换 — "${after.source}"`);
  ok(after.notes === '第一条备注|第二条备注', `① 备注已替换 — "${after.notes}"`);
  ok(after.viewKeys.join(',') === 'pop,area,rank',
    `① ★ 视图分类已替换 — ${after.viewKeys.join(',')}（导入前 ${before.viewKeys.join(',')}）`);
  ok(after.viewLabels.join(',') === '人口,面积,县级排名', `① 视图标签已替换 — ${after.viewLabels.join(',')}`);
  ok(after.itemCount === 4, `① 首视图柱体数 = ${after.itemCount}（模板 4 行实体）`);
  ok(after.firstName === '测试甲', `① 柱体数据已替换 — 首项 "${after.firstName}"`);
  ok(after.aspect === '9:16', `① ★ 画幅已替换 — ${after.aspect}（导入前 ${before.aspect}）`);
  ok(after.interval === 900, `① 播放间隔已替换 — ${after.interval}ms`);
  ok(after.activeShape === '圆柱', `① 形状已替换 — ${after.activeShape}`);
  ok(after.activeAspect === '9:16', `① 画幅按钮选中态已同步 — ${after.activeAspect}`);
  ok(after.highlight.join(',') === '测试乙', `① 高亮主角已替换 — ${after.highlight.join(',')}`);
  ok(after.activeViewBtn.length === 1, `① 视图下拉选中态唯一 — ${after.activeViewBtn.join(',')}`);
  // ★ 此处必须"零编辑"：切视图 / 改主题 / 改画幅都会触发 invalidateUndo()，
  //   把快照清掉（这正是「编辑后失效」的设计），再点撤销就没东西可撤了。
  //   所以"视图切换可用"的验证挪到 ②（撤销）完成之后再测。
  ok(after.undoDisabled === false, '① 导入后「↩撤销」按钮可用（未被禁用，快照就绪）');

  // ══════════ ② 撤销：逐字段还原 ══════════
  console.log('\n───── ② 撤销导入（仅撤销导入，编辑后失效） ─────');
  const clickedUndo = await clickDataBtn('撤销');
  ok(clickedUndo, '② 能定位并点击「↩撤销」按钮');
  await page.waitForFunction(
    (t) => window.__barRaceDS.getConfig().title === t,
    { timeout: 10000 }, before.title,
  ).catch(() => {});
  const undone = await probe();
  const fields = [
    ['title', before.title, undone.title],
    ['source', before.source, undone.source],
    ['notes', before.notes, undone.notes],
    ['viewKeys', before.viewKeys.join(','), undone.viewKeys.join(',')],
    ['itemCount', before.itemCount, undone.itemCount],
    ['firstName', before.firstName, undone.firstName],
    ['aspect', before.aspect, undone.aspect],
    ['interval', before.interval, undone.interval],
    ['activeShape', before.activeShape, undone.activeShape],
    ['activeTheme', before.activeTheme, undone.activeTheme],
    ['highlight', before.highlight.join(','), undone.highlight.join(',')],
  ].filter(([, a, b]) => String(a) !== String(b));
  ok(fields.length === 0, `② ★ 撤销后逐字段完全复原（${11 - fields.length}/11 项一致）` +
    (fields.length ? ` — 不一致：${fields.map(([n, a, b]) => `${n}(${a}→${b})`).join(' ')}` : ''));
  // ★ 最强证据：config 之外的 UI 内部状态也必须回到基线
  //   （viewKey/themeKey/shapeKey/durationLocked 都不在 config 里，只还原 config 会漏）
  const afterUI = { ...undone.uiState };
  delete afterUI.canUndoImport;
  const uiDiff = Object.keys(beforeUI).filter((k) => String(beforeUI[k]) !== String(afterUI[k]));
  ok(uiDiff.length === 0, `② ★ config 之外的 UI 状态也复原（viewKey/themeKey/shapeKey/durationLocked）` +
    (uiDiff.length ? ` — 不一致：${uiDiff.map((k) => `${k}(${beforeUI[k]}→${afterUI[k]})`).join(' ')}` : ''));
  ok(undone.undoDisabled === true, '② 撤销后按钮置灰（快照已消费，无二次撤销）');

  // 再导入一次 → 编辑 → 撤销应失效
  await (await page.$('#file')).uploadFile(TPL_PATH);
  await page.waitForFunction(
    () => window.__barRaceDS.getConfig().title === 'QA 测试数据集', { timeout: 15000 },
  ).catch(() => {});
  const reimported = await probe();
  ok(reimported.undoDisabled === false, '② 再次导入后按钮重新可用');
  // 视图切换可用（数据真的到位，不是只有标签变了）——此处切换同时也验证"编辑使撤销失效"
  const clickedArea = await clickGroupBtn('视图切换', '面积');
  ok(clickedArea, '② 能定位并点击「面积」视图按钮');
  await page.waitForFunction(
    () => window.__barRaceDS.getUiState().viewKey === 'area', { timeout: 5000 },
  ).catch(() => {});
  const onArea = await probe();
  ok(onArea.activeViewBtn.join(',') === '面积', `② ★ 可切到「面积」视图（导入的视图真的可切换） — ${onArea.activeViewBtn.join(',')}`);
  ok(onArea.uiState.viewKey === 'area', `② 内部 viewKey 已同步 — ${onArea.uiState.viewKey}`);
  ok(onArea.undoDisabled === true, '② ★ 编辑（切换视图）后撤销失效 — 防止误抹掉导入后的手工修改');
  // 还原到基线，避免影响后续断言
  await page.goto(`${srv.base}/?debug=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__barRace && !!window.__barRaceDS, { timeout: 30000 });

  // ══════════ ③ 导出 JSON 模板：产物合法且可回读 ══════════
  console.log('\n───── ③ 导出 JSON 模板（⤓配置） ─────');
  const dlDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tpl-dl-'));
  const cdp = await page.target().createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', {
    behavior: 'allow', downloadPath: dlDir, eventsEnabled: true,
  });
  const clickedExport = await clickDataBtn('配置');
  ok(clickedExport, '③ 能定位并点击「⤓配置」按钮');
  // 等文件落盘
  let dlFile = null;
  for (let i = 0; i < 60; i++) {
    const files = fs.readdirSync(dlDir).filter((f) => f.endsWith('.json'));
    if (files.length) { dlFile = path.join(dlDir, files[0]); break; }
    await sleep(100);
  }
  ok(!!dlFile, `③ 点击「配置」后产生了 .json 下载文件${dlFile ? '：' + path.basename(dlFile) : ''}`);

  if (dlFile) {
    const text = fs.readFileSync(dlFile, 'utf8').replace(/^\uFEFF/, '');
    let tpl = null;
    try { tpl = JSON.parse(text); } catch { /* 下条断言失败 */ }
    ok(!!tpl, '③ 下载产物是合法 JSON');
    ok(tpl && !('views' in tpl), '③ ★ 产物不含顶层 views（否则再导入会被判成旧格式）');
    ok(tpl && tpl.render && typeof tpl.render === 'object', '③ 产物含 render 段（展示配置集中处）');
    ok(tpl && Array.isArray(tpl.metrics) && Array.isArray(tpl.entities), '③ 产物含 metrics[]/entities[]');
    ok(tpl && tpl.metrics.length === (await probe()).viewKeys.length,
      `③ metrics 数与视图数一致 — ${tpl ? tpl.metrics.length : '?'}`);
    ok(tpl && tpl.render.aspect === '16:9', `③ render.aspect 已写出 — ${tpl && tpl.render.aspect}`);
    // 未锁时长时不应写 durationMs（否则下次导入会把推导值当显式值锁死）
    const nowExplicit = (await probe()).durationExplicit;
    ok(!nowExplicit ? !('durationMs' in (tpl || {}).render) : true,
      `③ 未锁时长时 render 不含 durationMs（当前 durationExplicit=${nowExplicit}）`);

    // ★ 闭环：把导出物原样再导入，关键字段必须与导出前一致
    const beforeReimport = await probe();
    await (await page.$('#file')).uploadFile(dlFile);
    await page.waitForFunction(
      (t) => window.__barRaceDS.getConfig().title === t, { timeout: 15000 }, beforeReimport.title,
    ).catch(() => {});
    const closed = await probe();
    ok(closed.title === beforeReimport.title
      && closed.viewKeys.join(',') === beforeReimport.viewKeys.join(',')
      && closed.itemCount === beforeReimport.itemCount
      && closed.firstName === beforeReimport.firstName
      && closed.aspect === beforeReimport.aspect
      && closed.interval === beforeReimport.interval
      && closed.highlight.join(',') === beforeReimport.highlight.join(','),
      '③ ★★ 闭环无损：导出物再导入后 标题/视图/数据/画幅/间隔/高亮 全部保持一致');
  }

  // ══════════ ④ 通道分派：CSV 仍走 CSV 分支（只换当前视图数据行） ══════════
  console.log('\n───── ④ 导入通道分派（CSV vs JSON） ─────');
  await page.goto(`${srv.base}/?debug=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__barRace && !!window.__barRaceDS, { timeout: 30000 });
  const preCsv = await probe();
  await (await page.$('#file')).uploadFile(CSV_PATH);
  await page.waitForFunction(
    () => window.__barRaceDS.getConfig().views[0].items[0].name === 'CSV甲', { timeout: 15000 },
  ).catch(() => {});
  const postCsv = await probe();
  ok(postCsv.firstName === 'CSV甲', `④ CSV 内容被正确解析 — 首项 "${postCsv.firstName}"`);
  ok(postCsv.itemCount === 2, `④ CSV 只替换当前视图数据行 — 项数 ${preCsv.itemCount} → ${postCsv.itemCount}`);
  ok(postCsv.title === preCsv.title, '④ ★ CSV 通道不触碰元信息（标题未被覆盖）');
  ok(postCsv.viewKeys.join(',') === preCsv.viewKeys.join(','),
    `④ ★ CSV 通道不触碰视图分类 — ${postCsv.viewKeys.join(',')}`);

  // ══════════ ⑤ 拖拽导入（DOM 事件级） ══════════
  console.log('\n───── ⑤ 拖拽导入 ─────');
  await page.goto(`${srv.base}/?debug=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__barRace && !!window.__barRaceDS, { timeout: 30000 });
  // 用真实的 DragEvent + DataTransfer 派发到 .group.data-ui（模拟用户拖文件到数据栏）
  // ★ 高亮态不能在同一次 evaluate 里同步读取：Vue 的响应式 DOM 更新在**微任务**里 flush，
  //   读到的是旧 classList。因此拆成两次 evaluate，中间 await 一次宏任务让渲染追上。
  const dropEnv = await page.evaluate((jsonText) => {
    const group = document.querySelector('.group.data-ui');
    if (!group) return { ok: false, why: 'no .group.data-ui' };
    const file = new File([jsonText], 'dropped.v2.json', { type: 'application/json' });
    const dt = new DataTransfer();
    dt.items.add(file);
    // 把 DataTransfer 暂存在 DOM 上，供第二次 evaluate 复用（File 只能从真实 DataTransfer 取）
    window.__qaDT = dt;
    group.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    return { ok: true };
  }, JSON.stringify(CUSTOM));
  await sleep(80); // 让 Vue 把 dropHot=true 落到 DOM
  const hotAfterOver = await page.evaluate(() =>
    document.querySelector('.group.data-ui').classList.contains('drop-hot'));
  const dropResult = await page.evaluate(() => {
    const group = document.querySelector('.group.data-ui');
    group.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: window.__qaDT }));
    delete window.__qaDT;
    return true;
  });
  await page.waitForFunction(
    () => window.__barRaceDS.getConfig().title === 'QA 测试数据集', { timeout: 15000 },
  ).catch(() => {});
  await sleep(80);
  const hotAfterDrop = await page.evaluate(() =>
    document.querySelector('.group.data-ui').classList.contains('drop-hot'));
  const afterDrop = await probe();
  ok(dropEnv.ok && dropResult && afterDrop.title === 'QA 测试数据集',
    `⑤ 拖拽 v2 模板到「数据」栏即完成整表导入 — 标题 "${afterDrop.title}"`);
  ok(hotAfterOver === true, '⑤ dragover 时容器进入 drop-hot 高亮态（可放下反馈）');
  ok(hotAfterDrop === false, '⑤ drop 后高亮态复位');
  ok(afterDrop.viewKeys.join(',') === 'pop,area,rank', '⑤ 拖拽导入的视图分类生效');
  ok(afterDrop.undoDisabled === false, '⑤ 拖拽导入同样可撤销');

  // 拖到 3D 视图区不应劫持（.viewport 不挂 drop）——确认其未带 drop-hot 类
  const vpHijack = await page.evaluate(() => {
    const vp = document.querySelector('.viewport');
    if (!vp) return { exists: false };
    const file = new File(['{}'], 'x.json', { type: 'application/json' });
    const dt = new DataTransfer();
    dt.items.add(file);
    vp.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    return { exists: true, hot: vp.classList.contains('drop-hot') };
  });
  ok(!vpHijack.hot, '⑤ ★ 3D 视图区未被拖拽劫持（不影响拖拽旋转/缩放）');

} finally {
  await browser.close();
  await srv.close();
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* ignore */ }
}

console.log(`\n==== 模板往返测试汇总：${pass}/${pass + fail} 通过 ====`);
if (fail > 0) process.exitCode = 1;
