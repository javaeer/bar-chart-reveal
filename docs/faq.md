# 常见问题（FAQ）

## 导出的视频没有标题 / 信息层？

信息层（标题 / 当前视图 / 来源备注）位于取景框**内部**，是「视频内容」的一部分：
- 浏览器内「导出 WebM」已合成信息层（v2.7.1 修复）；
- CLI 出片（`npm run render`）逐帧一致包含信息层。

若旧版本导出缺信息层，请升级到最新版后重试。

## WebM 与 MP4 该用哪个？

- **WebM**：浏览器内录制（MediaRecorder + captureStream），零依赖、即时下载；依赖真实浏览器，
  无头环境常抓不到帧。
- **MP4**：通过 CLI `npm run render` 在本地生成，需系统 `chromium` + `ffmpeg`（含 libx264 等编码器），
  确定性最好、适合成片发布。

在线 Demo 的「导出」默认生成 WebM；MP4 请用仓库 CLI 本地生成（见 [docs/cli-reference.md](docs/cli-reference.md)）。

## 画面黑屏 / 提示不支持 WebGL？

浏览器或环境无法创建 WebGL 上下文时，ECharts-GL 会直接黑屏。在线 Demo 已加**挂载时 WebGL 预检**，
不支持时显示友好提示。解决：使用较新的 Chrome / Edge / Firefox，或在浏览器设置中开启硬件加速。

## 如何用自己的数据集？

推荐复制 `samples/huining-v2.json`，改 `dataset`（标题/来源/主角）、`metrics[]`（维度=视图）、
`entities[]`（对象=条目）即可，无需关心内部 `views` 结构。完整字段见 [docs/data-template-v2.md](docs/data-template-v2.md)。

## 在线 Demo 会把我的数据上传吗？

不会。Demo 纯前端运行：配置仅在本地浏览器内解析，**不上传任何服务器、无遥测**。
详见 `App.vue` 的隐私说明与 [SECURITY.md](SECURITY.md)。

## 中文标签出现「逐字竖排 / 换行」？

多为系统字体尚未加载完成导致 Canvas 测量异常；应用已加 `document.fonts.ready` 守卫，
极端情况下刷新一次即可。

## 出片需要哪些系统依赖？

仅出片时需要：系统 `chromium`（或设 `CHROMIUM_PATH`）、`ffmpeg`（含 libx264 / libopenh264 / libvpx-vp9 之一）。
脚本会自动探测浏览器路径、自动选编码器、显示不可用时自动拉起 `Xvfb`。

## 分享链接太长了怎么办？

`?cfg=` 是配置 base64url 深链，数据量大时 URL 会很长，属正常。可用「复制分享链接」按钮一键复制；
如需更短，可把配置存为 `samples/*.json` 文件再用 `--config` 出片。

## 如何参与贡献 / 报告漏洞？

- Bug / 功能建议：见 [CONTRIBUTING.md](CONTRIBUTING.md) 与 Issue 模板；
- 安全漏洞：**勿公开 Issue**，走 [SECURITY.md](SECURITY.md) 的私有报告通道。
